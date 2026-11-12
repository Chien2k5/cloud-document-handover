"""TV1 (A05/K11) - Restore a PostgreSQL backup from the dedicated S3 backup bucket
into a brand-new isolated target database and verify:

1. Exact S3 VersionId download + SHA-256 verification of portal.dump before touching PostgreSQL.
2. Atomic rollback check: restoring into a sentinel database with a conflicting table fails and
   rolls back completely (--single-transaction --exit-on-error) without partial tables.
3. Clean restore into a fresh target database (never overwrites or drops the source database).
4. All 11 tables match pre-backup row counts and canonical SHA-256 digests.
5. All 18 foreign keys in V1 schema are present and validated.
6. Read-only, state-aware exact S3 version and strict checksum contract cross-check.
   A preserved pending/failed state never implies full file integrity verification.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import tempfile
import uuid
import subprocess
import sys
import time
from pathlib import Path

import boto3
from botocore.config import Config

from backup_db_to_s3 import ROOT, TABLES, git_head, pg_command, pg_environment, run_psql_query, s3_client, snapshot_tables


def result_key(bucket: str, key: str, version_id: str) -> str:
    parts = [hashlib.sha256(v.encode("utf-8")).hexdigest() for v in (bucket, key, version_id)]
    return "results/" + "/".join(parts) + ".json"


def create_fresh_db(pg_container: str | None, host: str, port: int, user: str, admin_db: str, password: str, new_db: str):
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", new_db):
        raise ValueError("Target database must be a lowercase PostgreSQL identifier (maximum 63 bytes)")
    run_psql_query(pg_container, host, port, user, admin_db, password, f'CREATE DATABASE "{new_db}";')


def run_pg_restore(pg_container: str | None, host: str, port: int, user: str, target_db: str, password: str, dump_file: Path) -> subprocess.CompletedProcess:
    command = pg_command("pg_restore", pg_container, host, port, user, target_db,
                         ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"])
    # Stream this invocation's archive; no shared /tmp name and no password in argv.
    with dump_file.open("rb", buffering=0) as archive:
        return subprocess.run(command, stdin=archive, env=pg_environment(password),
                              capture_output=True, text=True, encoding="utf-8")


def verify_atomic_rollback(pg_container: str | None, host: str, port: int, user: str, password: str, dump_file: Path, rollback_db: str) -> dict:
    create_fresh_db(pg_container, host, port, user, "postgres", password, rollback_db)
    # Create a conflicting table 'handovers' with incompatible schema so pg_restore fails mid-way
    run_psql_query(
        pg_container, host, port, user, rollback_db, password,
        "CREATE TABLE handovers (sentinel_only INT PRIMARY KEY); INSERT INTO handovers VALUES (42);",
    )
    proc = run_pg_restore(pg_container, host, port, user, rollback_db, password, dump_file)
    tables_after = run_psql_query(
        pg_container, host, port, user, rollback_db, password,
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;",
    ).splitlines()
    sentinel_val = run_psql_query(
        pg_container, host, port, user, rollback_db, password,
        "SELECT sentinel_only FROM handovers;",
    ).strip()
    passed = (proc.returncode != 0) and (tables_after == ["handovers"]) and (sentinel_val == "42")
    return {
        "rollbackDatabase": rollback_db,
        "restoreExitCode": proc.returncode,
        "remainingPublicTables": tables_after,
        "sentinelPreserved": sentinel_val == "42",
        "passed": passed,
    }


MAX_RESULT_BYTES = 65536
CHECKSUM_FIELDS = {"schemaVersion", "bucket", "objectKey", "versionId", "size", "status",
                   "actualSha256", "errorCode", "processedAt"}
SHA256 = re.compile(r"[0-9a-f]{64}")
TIMESTAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-5][0-9])")


def _unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def validate_checksum_document(data: bytes, bucket: str, key: str, version: str, size: int) -> dict:
    """Contract v1 plus the Java consumer's strict integer/JSON/time constraints."""
    if len(data) > MAX_RESULT_BYTES:
        raise ValueError("Checksum result exceeds 65536 bytes")
    try:
        doc = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_fields,
                         parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Non-JSON number")))
    except (UnicodeError, ValueError, RecursionError) as error:
        raise ValueError("Invalid checksum JSON") from error
    if type(doc) is not dict or set(doc) != CHECKSUM_FIELDS:
        raise ValueError("Checksum fields do not match contract v1")
    if type(doc["schemaVersion"]) is not int or doc["schemaVersion"] != 1:
        raise ValueError("Unsupported checksum schemaVersion")
    for field, expected in (("bucket", bucket), ("objectKey", key), ("versionId", version)):
        if type(doc[field]) is not str or doc[field] != expected:
            raise ValueError("Checksum identity mismatch")
    if not bucket or not key.startswith("uploads/") or not version or version == "null":
        raise ValueError("Invalid checksum object identity")
    if type(doc["size"]) is not int or not 1 <= doc["size"] <= 2**63 - 1 or doc["size"] != size:
        raise ValueError("Checksum size mismatch")
    if doc["status"] == "SUCCEEDED":
        if type(doc["actualSha256"]) is not str or not SHA256.fullmatch(doc["actualSha256"]) or doc["errorCode"] is not None:
            raise ValueError("Invalid SUCCEEDED checksum result")
    elif doc["status"] == "FAILED":
        if doc["actualSha256"] is not None or type(doc["errorCode"]) is not str or not doc["errorCode"]:
            raise ValueError("Invalid FAILED checksum result")
    else:
        raise ValueError("Invalid checksum status")
    timestamp = doc["processedAt"]
    if type(timestamp) is not str or not TIMESTAMP.fullmatch(timestamp):
        raise ValueError("Invalid processedAt")
    try:
        parsed = datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if abs(parsed.utcoffset().total_seconds()) > 18 * 3600:
            raise ValueError("Offset exceeds Java OffsetDateTime range")
    except ValueError as error:
        raise ValueError("Invalid processedAt") from error
    return doc


def classify_s3_error(error: Exception) -> str:
    response = getattr(error, "response", {})
    code = response.get("Error", {}).get("Code", "")
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    if code in {"AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"} or status == 403:
        return "PERMISSION_DENIED"
    if code in {"NoSuchKey", "NoSuchVersion", "NotFound", "404"} or status == 404:
        return "MISSING"
    return "UNAVAILABLE"


def valid_db_state(row: dict) -> bool:
    upload, integrity = row["upload_status"], row["integrity_status"]
    actual, expected, version = row["actual_sha256"], row["expected_sha256"], row["s3_version_id"]
    if upload in {"PENDING", "FAILED", "EXPIRED"}:
        return integrity == "INTEGRITY_PENDING" and actual is None and version is None
    if upload != "AVAILABLE" or type(version) is not str or not version.strip() or version == "null":
        return False
    if integrity in {"INTEGRITY_PENDING", "FAILED"}:
        return actual is None
    if type(actual) is not str or not SHA256.fullmatch(actual):
        return False
    return (integrity == "VERIFIED" and actual == expected) or (integrity == "MISMATCH" and actual != expected)


def cross_check_s3_objects(s3, pg_container: str | None, host: str, port: int, user: str, target_db: str, password: str) -> dict:
    # JSON transports SQL NULL and keys containing pipes/newlines without lossy delimiters.
    sql = ("SELECT row_to_json(t)::text FROM (SELECT id, bucket, object_key, s3_version_id, "
           "size_bytes, expected_sha256, actual_sha256, upload_status, integrity_status "
           "FROM file_versions ORDER BY id) t;")
    raw = run_psql_query(pg_container, host, port, user, target_db, password, sql)
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    checked = []
    for row in rows:
        bucket, key, version, size = (row[k] for k in ("bucket", "object_key", "s3_version_id", "size_bytes"))
        state_ok = valid_db_state(row)
        eligible = row["upload_status"] == "AVAILABLE"
        item = dict(fileVersionId=row["id"], bucket=bucket, objectKey=key, s3VersionId=version,
                    sizeBytes=size, uploadStatus=row["upload_status"], integrityStatus=row["integrity_status"],
                    expectedSha256=row["expected_sha256"], actualSha256=row["actual_sha256"],
                    databaseStateValid=state_ok, eligible=eligible, headExactVersionMatched=False,
                    checksumResultJsonMatched=False, objectStatus="NOT_APPLICABLE",
                    checksumContractStatus="NOT_APPLICABLE", integrityVerificationStatus="UNVERIFIED",
                    preservationPassed=state_ok)
        if eligible and state_ok:
            try:
                head = s3.head_object(Bucket=bucket, Key=key, VersionId=version)
                matched = (head.get("VersionId") == version and type(head.get("ContentLength")) is int
                           and head["ContentLength"] == size and not head.get("DeleteMarker", False))
                item["headExactVersionMatched"] = matched
                item["objectStatus"] = "EXACT_VERSION_MATCHED" if matched else "METADATA_MISMATCH"
            except Exception as error:
                item["objectStatus"] = classify_s3_error(error)
            item["preservationPassed"] = item["headExactVersionMatched"]
            doc = None
            try:
                obj = s3.get_object(Bucket=bucket, Key=result_key(bucket, key, version))
                body = obj["Body"]
                try:
                    data = body.read(MAX_RESULT_BYTES + 1)
                finally:
                    body.close()
                try:
                    doc = validate_checksum_document(data, bucket, key, version, size)
                    item["checksumContractStatus"] = "VALID"
                except ValueError:
                    item["checksumContractStatus"] = "INVALID"
            except Exception as error:
                item["checksumContractStatus"] = classify_s3_error(error)
            terminal = row["integrity_status"] in {"VERIFIED", "MISMATCH"}
            if doc is not None:
                # A valid producer failure is evidence of failure, never a verified checksum.
                agrees = (not terminal or (doc["status"] == "SUCCEEDED" and doc["actualSha256"] == row["actual_sha256"]))
                item["checksumResultJsonMatched"] = agrees
                item["preservationPassed"] &= agrees
                if terminal and agrees and item["headExactVersionMatched"]:
                    item["integrityVerificationStatus"] = row["integrity_status"]
                elif not terminal:
                    item["integrityVerificationStatus"] = "AWAITING_RECONCILIATION" if doc["status"] == "SUCCEEDED" else "PROCESSING_FAILED"
            elif item["checksumContractStatus"] != "MISSING" or terminal:
                item["preservationPassed"] = False
        if not state_ok:
            item["integrityVerificationStatus"] = "INVALID_DATABASE_STATE"
        checked.append(item)
    eligible_items = [item for item in checked if item["eligible"]]
    count = lambda predicate: sum(bool(predicate(item)) for item in checked)
    counts = {
        "pendingChecksumCount": count(lambda x: x["eligible"] and x["integrityStatus"] == "INTEGRITY_PENDING"),
        "verifiedCount": count(lambda x: x["integrityVerificationStatus"] == "VERIFIED"),
        "mismatchCount": count(lambda x: x["integrityStatus"] == "MISMATCH"),
        "failedCount": count(lambda x: x["integrityStatus"] == "FAILED" or x["uploadStatus"] == "FAILED"),
        "missingObjectCount": count(lambda x: x["objectStatus"] == "MISSING"),
        "invalidResultCount": count(lambda x: x["checksumContractStatus"] == "INVALID"),
        "unverifiedCount": count(lambda x: x["integrityVerificationStatus"] != "VERIFIED"),
        "indeterminateCount": count(lambda x: x["objectStatus"] in {"PERMISSION_DENIED", "UNAVAILABLE"} or x["checksumContractStatus"] in {"PERMISSION_DENIED", "UNAVAILABLE"}),
    }
    object_status = ("NOT_APPLICABLE" if not eligible_items else
                     "PASS" if all(x["headExactVersionMatched"] for x in eligible_items) else "FAIL")
    contract_status = ("NOT_APPLICABLE" if not eligible_items else
                       "FAIL" if any(x["checksumContractStatus"] in {"INVALID", "PERMISSION_DENIED", "UNAVAILABLE"} for x in eligible_items) else
                       "INCOMPLETE" if any(x["checksumContractStatus"] == "MISSING" for x in eligible_items) else "PASS")
    full = bool(eligible_items) and len(eligible_items) == len(checked) and counts["verifiedCount"] == len(checked)
    return {"checkedCount": len(eligible_items), "totalFileVersions": len(checked),
            "coverage": {"eligibleCount": len(eligible_items), "verifiedCount": counts["verifiedCount"]},
            "allMatched": all(x["preservationPassed"] for x in checked),
            "fullIntegrityVerified": full, "objectVerificationStatus": object_status,
            "checksumContractStatus": contract_status,
            "integrityVerificationStatus": "VERIFIED" if full else "NOT_APPLICABLE" if not eligible_items else "INCOMPLETE",
            **counts, "items": checked}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Restore PostgreSQL DB from S3 backup into isolated target DB.")
    parser.add_argument("--pg-container", default="handover-local-aws-postgres-1")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=15432)
    parser.add_argument("--user", default="handover")
    parser.add_argument("--backup-bucket", default="handover-backups-local")
    parser.add_argument("--backup-key", required=True, help="e.g. postgres/<run-id>/portal.dump")
    parser.add_argument("--backup-version-id", default="")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--endpoint-url", default=os.environ.get("LOCALSTACK_ENDPOINT", ""))
    parser.add_argument("--assume-role-arn", default="")
    parser.add_argument("--target-db", default="")
    parser.add_argument("--evidence-dir", type=Path, default=ROOT / "evidence" / "week-04" / "tv1-s3-restore")
    args = parser.parse_args(argv)

    password = os.environ.get("PGPASSWORD") or os.environ.get("LOCAL_PG_PASSWORD", "local-only-not-a-secret")
    pg_container = args.pg_container.strip() or None
    endpoint_url = args.endpoint_url.strip() or None
    role_arn = args.assume_role_arn.strip() or None

    s3 = s3_client(endpoint_url, args.region, role_arn)
    t0 = time.perf_counter()

    meta_key = args.backup_key + ".meta.json"
    meta_body = s3.get_object(Bucket=args.backup_bucket, Key=meta_key)["Body"]
    try:
        expected_meta = json.loads(meta_body.read().decode("utf-8"), object_pairs_hook=_unique_fields)
    finally:
        meta_body.close()

    pinned_version = expected_meta.get("backupS3VersionId")
    if (type(expected_meta.get("schemaVersion")) is not int or expected_meta["schemaVersion"] != 1
            or expected_meta.get("backupBucket") != args.backup_bucket
            or expected_meta.get("backupKey") != args.backup_key or type(pinned_version) is not str
            or not pinned_version.strip() or pinned_version == "null"):
        raise ValueError("Backup manifest identity/version is invalid")
    if args.backup_version_id and args.backup_version_id != pinned_version:
        raise ValueError("Requested backup VersionId does not match manifest")
    get_kwargs = {"Bucket": args.backup_bucket, "Key": args.backup_key, "VersionId": pinned_version}
    dump_obj = s3.get_object(**get_kwargs)
    body = dump_obj["Body"]
    try:
        dump_bytes = body.read()
    finally:
        body.close()
    t_dl = time.perf_counter()
    actual_dump_sha256 = hashlib.sha256(dump_bytes).hexdigest()
    if (dump_obj.get("VersionId") != pinned_version or dump_obj.get("ContentLength") != len(dump_bytes)
            or expected_meta.get("dumpSizeBytes") != len(dump_bytes)
            or actual_dump_sha256 != expected_meta.get("dumpSha256")):
        raise ValueError("Backup exact version, size or SHA-256 verification failed before database creation")

    stamp = time.strftime("%Y%m%d_%H%M%S", time.gmtime()) + "_" + uuid.uuid4().hex[:12]
    target_db = args.target_db or f"handover_s3restore_{stamp}_dst"
    rollback_db = f"handover_s3restore_{stamp}_rollback"

    # Only the fresh test/restore databases persist for inspection; the local dump is scoped.
    with tempfile.TemporaryDirectory(prefix="tv1-restore-") as temporary:
        local_dump = Path(temporary) / "portal.dump"
        local_dump.write_bytes(dump_bytes)
        rollback_check = verify_atomic_rollback(pg_container, args.host, args.port, args.user, password, local_dump, rollback_db)
        if not rollback_check["passed"]:
            raise RuntimeError("Atomic rollback verification failed")
        t_rb = time.perf_counter()
        create_fresh_db(pg_container, args.host, args.port, args.user, "postgres", password, target_db)
        restore_proc = run_pg_restore(pg_container, args.host, args.port, args.user, target_db, password, local_dump)
        if restore_proc.returncode != 0:
            raise RuntimeError(f"pg_restore into fresh target failed (exit {restore_proc.returncode}); target retained for inspection")
        t_restore = time.perf_counter()

    restored_snapshot = snapshot_tables(pg_container, args.host, args.port, args.user, target_db, password)
    table_diff = {}
    all_tables_match = True
    for tbl in TABLES:
        src_info = expected_meta["tables"][tbl]
        dst_info = restored_snapshot[tbl]
        matched = (src_info["rowCount"] == dst_info["rowCount"]) and (src_info["canonicalSha256"] == dst_info["canonicalSha256"])
        if not matched:
            all_tables_match = False
        table_diff[tbl] = {
            "sourceRowCount": src_info["rowCount"],
            "restoredRowCount": dst_info["rowCount"],
            "canonicalSha256Matched": matched,
        }

    fk_count = int(run_psql_query(
        pg_container, args.host, args.port, args.user, target_db, password,
        "SELECT count(*) FROM pg_constraint WHERE contype='f' AND convalidated;",
    ))
    handover_counts = run_psql_query(
        pg_container, args.host, args.port, args.user, target_db, password,
        "SELECT status || ':' || access_status || '=' || count(*) FROM handovers GROUP BY status, access_status ORDER BY 1;",
    ).splitlines()

    s3_check = cross_check_s3_objects(s3, pg_container, args.host, args.port, args.user, target_db, password)
    t_done = time.perf_counter()

    overall_pass = (
        rollback_check["passed"]
        and all_tables_match
        and fk_count == 18
        and s3_check["allMatched"]
    )

    result = {
        "status": "PASS" if overall_pass else "FAIL",
        "verificationScope": "DATABASE_RESTORE_AND_REFERENCE_PRESERVATION",
        "databaseRestoreStatus": "PASS",
        "tableVerificationStatus": "PASS" if all_tables_match else "FAIL",
        "foreignKeyVerificationStatus": "PASS" if fk_count == 18 else "FAIL",
        "s3ExactVersionVerificationStatus": s3_check["objectVerificationStatus"],
        "checksumContractVerificationStatus": s3_check["checksumContractStatus"],
        "fullIntegrityVerified": s3_check["fullIntegrityVerified"],
        "environment": "localstack-emulation" if endpoint_url else "aws",
        "gitCommit": git_head(),
        "backupBucket": args.backup_bucket,
        "backupKey": args.backup_key,
        "backupS3VersionId": get_kwargs.get("VersionId"),
        "dumpSha256Verified": True,
        "sourceDatabase": expected_meta["sourceDatabase"],
        "restoredDatabase": target_db,
        "atomicRollbackCheck": rollback_check,
        "all11TablesMatched": all_tables_match,
        "validatedForeignKeyCount": fk_count,
        "handoverStateSummary": handover_counts,
        "tables": table_diff,
        "s3VersionCrossCheck": s3_check,
        "timingsMs": {
            "s3DownloadAndVerifyMs": round((t_dl - t0) * 1000, 1),
            "atomicRollbackTestMs": round((t_rb - t_dl) * 1000, 1),
            "pgRestoreIsolatedDbMs": round((t_restore - t_rb) * 1000, 1),
            "dbAndS3VerificationMs": round((t_done - t_restore) * 1000, 1),
            "totalMs": round((t_done - t0) * 1000, 1),
        },
        "completedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    (args.evidence_dir / "restore-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    report_md = f"""# Biên bản Backup S3 & Restore DB tách biệt (TV1 - A05 / K11)

- **Trạng thái**: `{result['status']}` (`{result['environment']}`)
- **Commit**: `{result['gitCommit']}`
- **Thời điểm hoàn tất**: `{result['completedAt']}`
- **Nguồn backup S3**: `s3://{args.backup_bucket}/{args.backup_key}` (VersionId: `{result['backupS3VersionId']}`)
- **DB nguồn**: `{result['sourceDatabase']}` -> **DB đích tách biệt**: `{result['restoredDatabase']}`
- **Kiểm tra rollback nguyên tử (`_rollback`)**: `PASS={rollback_check['passed']}` (exit code `{rollback_check['restoreExitCode']}`, giữ nguyên bảng sentinel)
- **Đối chiếu 11 bảng (row count + canonical SHA-256)**: `allMatched={all_tables_match}`
- **Khóa ngoại đã xác thực (`convalidated`)**: `{fk_count}/18`
- **Đối chiếu liên kết DB <-> S3 (`file_versions` AVAILABLE -> exact S3 VersionId + `results/` JSON)**: `{s3_check['checkedCount']} phiên bản, allMatched={s3_check['allMatched']}`
- **Full file integrity verified**: `{result["fullIntegrityVerified"]}`; checksum contract: `{s3_check["checksumContractStatus"]}`; pending/verified/mismatch/failed: `{s3_check["pendingChecksumCount"]}/{s3_check["verifiedCount"]}/{s3_check["mismatchCount"]}/{s3_check["failedCount"]}`
- **Thời gian đo thực tế**:
  - Tải dump từ S3 & kiểm SHA-256: `{result['timingsMs']['s3DownloadAndVerifyMs']} ms`
  - Kiểm tra rollback nguyên tử: `{result['timingsMs']['atomicRollbackTestMs']} ms`
  - `pg_restore` vào DB đích mới: `{result['timingsMs']['pgRestoreIsolatedDbMs']} ms`
  - Đối chiếu 11 bảng + 18 FK + S3 VersionId: `{result['timingsMs']['dbAndS3VerificationMs']} ms`
  - Tổng cộng: `{result['timingsMs']['totalMs']} ms`
"""
    (args.evidence_dir / "restore-report.md").write_text(report_md, encoding="utf-8")
    print(json.dumps(result, indent=2))
    if not overall_pass:
        sys.exit(1)
    return result


if __name__ == "__main__":
    main()
