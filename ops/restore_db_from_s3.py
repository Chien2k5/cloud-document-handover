"""TV1 (A05/K11) - Restore a PostgreSQL backup from the dedicated S3 backup bucket
into a brand-new isolated target database and verify:

1. Exact S3 VersionId download + SHA-256 verification of portal.dump before touching PostgreSQL.
2. Atomic rollback check: restoring into a sentinel database with a conflicting table fails and
   rolls back completely (--single-transaction --exit-on-error) without partial tables.
3. Clean restore into a fresh target database (never overwrites or drops the source database).
4. All 11 tables match pre-backup row counts and canonical SHA-256 digests.
5. All 18 foreign keys in V1 schema are present and validated.
6. S3 <-> DB cross-check (K11): every AVAILABLE file_version in the restored DB still exists in
    the S3 upload bucket at its exact VersionId and its checksum result JSON in results/ matches
   actual_sha256.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import boto3
from botocore.config import Config

from backup_db_to_s3 import ROOT, TABLES, git_head, run_psql_query, s3_client, snapshot_tables


def result_key(bucket: str, key: str, version_id: str) -> str:
    parts = [hashlib.sha256(v.encode("utf-8")).hexdigest() for v in (bucket, key, version_id)]
    return "results/" + "/".join(parts) + ".json"


def create_fresh_db(pg_container: str | None, host: str, port: int, user: str, admin_db: str, password: str, new_db: str):
    sql = f"CREATE DATABASE {new_db};"
    run_psql_query(pg_container, host, port, user, admin_db, password, sql)


def run_pg_restore(pg_container: str | None, host: str, port: int, user: str, target_db: str, password: str, dump_file: Path) -> subprocess.CompletedProcess:
    if pg_container:
        in_container = "/tmp/tv1_portal_restore.dump"
        subprocess.check_call(["docker", "cp", str(dump_file), f"{pg_container}:{in_container}"])
        proc = subprocess.run([
            "docker", "exec", "-e", f"PGPASSWORD={password}", pg_container,
            "pg_restore", "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction",
            "-U", user, "-d", target_db, in_container,
        ], capture_output=True, text=True)
        subprocess.run(["docker", "exec", pg_container, "rm", "-f", in_container], check=False)
        return proc
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    return subprocess.run([
        "pg_restore", "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction",
        "-h", host, "-p", str(port), "-U", user, "-d", target_db, str(dump_file),
    ], env=env, capture_output=True, text=True)


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


def cross_check_s3_objects(s3, pg_container: str | None, host: str, port: int, user: str, target_db: str, password: str) -> dict:
    sql = (
        "SELECT id, bucket, object_key, s3_version_id, size_bytes, expected_sha256, actual_sha256, "
        "upload_status, integrity_status FROM file_versions WHERE upload_status='AVAILABLE' ORDER BY created_at;"
    )
    raw = run_psql_query(pg_container, host, port, user, target_db, password, sql)
    checked = []
    for line in [l for l in raw.splitlines() if l.strip()]:
        fid, bucket, key, ver, size_s, exp_sha, act_sha, up_st, int_st = line.split("|")
        size = int(size_s)
        head = s3.head_object(Bucket=bucket, Key=key, VersionId=ver)
        head_ok = (head.get("VersionId") == ver) and (int(head.get("ContentLength", -1)) == size)
        rkey = result_key(bucket, key, ver)
        res_obj = s3.get_object(Bucket=bucket, Key=rkey)
        res_doc = json.loads(res_obj["Body"].read().decode("utf-8"))
        json_ok = (
            res_doc.get("schemaVersion") == 1
            and res_doc.get("bucket") == bucket
            and res_doc.get("objectKey") == key
            and res_doc.get("versionId") == ver
            and res_doc.get("size") == size
            and res_doc.get("actualSha256") == act_sha
        )
        checked.append({
            "fileVersionId": fid,
            "bucket": bucket,
            "objectKey": key,
            "s3VersionId": ver,
            "sizeBytes": size,
            "uploadStatus": up_st,
            "integrityStatus": int_st,
            "expectedSha256": exp_sha,
            "actualSha256": act_sha,
            "headExactVersionMatched": head_ok,
            "checksumResultJsonMatched": json_ok,
        })
    all_ok = all(item["headExactVersionMatched"] and item["checksumResultJsonMatched"] for item in checked)
    return {"checkedCount": len(checked), "allMatched": all_ok, "items": checked}


def main():
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
    args = parser.parse_args()

    password = os.environ.get("PGPASSWORD") or os.environ.get("LOCAL_PG_PASSWORD", "local-only-not-a-secret")
    pg_container = args.pg_container.strip() or None
    endpoint_url = args.endpoint_url.strip() or None
    role_arn = args.assume_role_arn.strip() or None

    s3 = s3_client(endpoint_url, args.region, role_arn)
    t0 = time.perf_counter()

    meta_key = args.backup_key + ".meta.json"
    expected_meta = json.loads(s3.get_object(Bucket=args.backup_bucket, Key=meta_key)["Body"].read().decode("utf-8"))

    get_kwargs = {"Bucket": args.backup_bucket, "Key": args.backup_key}
    if args.backup_version_id:
        get_kwargs["VersionId"] = args.backup_version_id
    elif expected_meta.get("backupS3VersionId"):
        get_kwargs["VersionId"] = expected_meta["backupS3VersionId"]

    dump_obj = s3.get_object(**get_kwargs)
    dump_bytes = dump_obj["Body"].read()
    t_dl = time.perf_counter()

    actual_dump_sha256 = hashlib.sha256(dump_bytes).hexdigest()
    if actual_dump_sha256 != expected_meta["dumpSha256"]:
        sys.exit(f"Dump SHA-256 mismatch! Expected {expected_meta['dumpSha256']}, got {actual_dump_sha256}")

    stamp = time.strftime("%Y%m%d_%H%M%S", time.gmtime())
    target_db = args.target_db or f"handover_s3restore_{stamp}_dst"
    rollback_db = f"handover_s3restore_{stamp}_rollback"

    local_dump = ROOT / "backups" / f"restore-{stamp}" / "portal.dump"
    local_dump.parent.mkdir(parents=True, exist_ok=True)
    local_dump.write_bytes(dump_bytes)

    rollback_check = verify_atomic_rollback(pg_container, args.host, args.port, args.user, password, local_dump, rollback_db)
    if not rollback_check["passed"]:
        sys.exit(f"Atomic rollback check failed: {rollback_check}")
    t_rb = time.perf_counter()

    create_fresh_db(pg_container, args.host, args.port, args.user, "postgres", password, target_db)
    restore_proc = run_pg_restore(pg_container, args.host, args.port, args.user, target_db, password, local_dump)
    if restore_proc.returncode != 0:
        sys.exit(f"pg_restore into {target_db} failed:\n{restore_proc.stderr}")
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


if __name__ == "__main__":
    main()
