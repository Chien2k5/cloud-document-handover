"""TV1 (A05/K11/K12) - Backup PostgreSQL database to the dedicated S3 backup bucket.

- Runs pg_dump --format=custom --no-owner --no-acl (via local pg_dump or postgres:17 container).
- Snapshots row counts and canonical SHA-256 digests of all 11 portal tables before dump.
- Uploads the dump to s3://<backup-bucket>/postgres/<run-id>/portal.dump with SSE-S3 (AES256)
  and records the S3 VersionId.
- Stores the binary dump ONLY under backups/ (git-ignored, contains password hashes) and writes
  a secret-free manifest JSON to the specified --evidence-out path.
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

ROOT = Path(__file__).resolve().parents[1]
TABLES = [
    "flyway_schema_history",
    "app_users",
    "projects",
    "memberships",
    "file_metadata",
    "file_versions",
    "upload_sessions",
    "handovers",
    "handover_items",
    "handover_recipients",
    "audit_events",
]


def s3_client(endpoint_url: str | None, region: str, role_arn: str | None):
    cfg = Config(retries={"mode": "standard", "max_attempts": 5})
    if endpoint_url:
        if not endpoint_url.startswith(("http://localhost", "http://127.0.0.1", "http://s3.localhost.localstack.cloud", "https://s3.localhost.localstack.cloud")):
            sys.exit("Refusing non-local custom endpoint_url")
        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=region,
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "test"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
            config=cfg,
        )
    if role_arn:
        sts = boto3.client("sts", region_name=region, config=cfg)
        creds = sts.assume_role(RoleArn=role_arn, RoleSessionName="tv1-postgres-backup")["Credentials"]
        return boto3.client(
            "s3",
            region_name=region,
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
            config=cfg,
        )
    return boto3.client("s3", region_name=region, config=cfg)


def git_head() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "unknown"


def run_psql_query(pg_container: str | None, host: str, port: int, user: str, dbname: str, password: str, sql: str) -> str:
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    if pg_container:
        cmd = [
            "docker", "exec", "-e", f"PGPASSWORD={password}", pg_container,
            "psql", "-X", "-A", "-t", "-U", user, "-d", dbname, "-c", sql,
        ]
    else:
        cmd = ["psql", "-X", "-A", "-t", "-h", host, "-p", str(port), "-U", user, "-d", dbname, "-c", sql]
    return subprocess.check_output(cmd, env=env, text=True).strip()


def snapshot_tables(pg_container: str | None, host: str, port: int, user: str, dbname: str, password: str) -> dict:
    snap = {}
    for table in TABLES:
        order_col = "installed_rank" if table == "flyway_schema_history" else "1, 2"
        sql = f"SELECT row_to_json(t)::text FROM (SELECT * FROM {table} ORDER BY {order_col}) t;"
        rows_raw = run_psql_query(pg_container, host, port, user, dbname, password, sql)
        lines = [line for line in rows_raw.splitlines() if line.strip()]
        canonical = "\n".join(lines).encode("utf-8")
        snap[table] = {
            "rowCount": len(lines),
            "canonicalSha256": hashlib.sha256(canonical).hexdigest(),
        }
    return snap


def run_pg_dump(pg_container: str | None, host: str, port: int, user: str, dbname: str, password: str, out_file: Path):
    out_file.parent.mkdir(parents=True, exist_ok=True)
    if pg_container:
        in_container = "/tmp/tv1_portal_backup.dump"
        subprocess.check_call([
            "docker", "exec", "-e", f"PGPASSWORD={password}", pg_container,
            "pg_dump", "--format=custom", "--no-owner", "--no-acl",
            "-U", user, "-d", dbname, "--file", in_container,
        ])
        subprocess.check_call(["docker", "cp", f"{pg_container}:{in_container}", str(out_file)])
        subprocess.check_call(["docker", "exec", pg_container, "rm", "-f", in_container])
    else:
        env = os.environ.copy()
        env["PGPASSWORD"] = password
        subprocess.check_call([
            "pg_dump", "--format=custom", "--no-owner", "--no-acl",
            "-h", host, "-p", str(port), "-U", user, "-d", dbname, "--file", str(out_file),
        ], env=env)


def main():
    parser = argparse.ArgumentParser(description="Backup PostgreSQL DB to dedicated S3 bucket.")
    parser.add_argument("--pg-container", default="handover-local-aws-postgres-1",
                        help="Docker container name for local PostgreSQL 17 (set '' to use host pg_dump/psql).")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=15432)
    parser.add_argument("--user", default="handover")
    parser.add_argument("--dbname", default="handover")
    parser.add_argument("--backup-bucket", default="handover-backups-local")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--endpoint-url", default=os.environ.get("LOCALSTACK_ENDPOINT", ""))
    parser.add_argument("--assume-role-arn", default="")
    parser.add_argument("--label", default="manual")
    parser.add_argument("--evidence-out", type=Path, default=None)
    args = parser.parse_args()

    password = os.environ.get("PGPASSWORD") or os.environ.get("LOCAL_PG_PASSWORD", "local-only-not-a-secret")
    pg_container = args.pg_container.strip() or None
    endpoint_url = args.endpoint_url.strip() or None
    role_arn = args.assume_role_arn.strip() or None

    run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + f"-{args.label}"
    local_dump = ROOT / "backups" / run_id / "portal.dump"

    t0 = time.perf_counter()
    table_snapshot = snapshot_tables(pg_container, args.host, args.port, args.user, args.dbname, password)
    t_snap = time.perf_counter()

    run_pg_dump(pg_container, args.host, args.port, args.user, args.dbname, password, local_dump)
    t_dump = time.perf_counter()

    dump_bytes = local_dump.read_bytes()
    dump_sha256 = hashlib.sha256(dump_bytes).hexdigest()

    s3 = s3_client(endpoint_url, args.region, role_arn)
    dump_key = f"postgres/{run_id}/portal.dump"
    meta_key = f"postgres/{run_id}/portal.dump.meta.json"

    put_resp = s3.put_object(
        Bucket=args.backup_bucket,
        Key=dump_key,
        Body=dump_bytes,
        ContentType="application/octet-stream",
        ServerSideEncryption="AES256",
        Metadata={
            "sha256": dump_sha256,
            "source-db": args.dbname,
            "git-commit": git_head()[:12],
        },
    )
    t_upload = time.perf_counter()
    s3_version_id = put_resp.get("VersionId")
    if not s3_version_id or s3_version_id == "null":
        sys.exit("Backup bucket does not have Versioning Enabled (missing VersionId)")

    manifest = {
        "schemaVersion": 1,
        "runId": run_id,
        "label": args.label,
        "environment": "localstack-emulation" if endpoint_url else "aws",
        "gitCommit": git_head(),
        "sourceDatabase": args.dbname,
        "backupBucket": args.backup_bucket,
        "backupKey": dump_key,
        "backupS3VersionId": s3_version_id,
        "dumpSizeBytes": len(dump_bytes),
        "dumpSha256": dump_sha256,
        "serverSideEncryption": put_resp.get("ServerSideEncryption", "AES256"),
        "timingsMs": {
            "tableSnapshotMs": round((t_snap - t0) * 1000, 1),
            "pgDumpMs": round((t_dump - t_snap) * 1000, 1),
            "s3UploadMs": round((t_upload - t_dump) * 1000, 1),
            "totalMs": round((t_upload - t0) * 1000, 1),
        },
        "tables": table_snapshot,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    s3.put_object(
        Bucket=args.backup_bucket,
        Key=meta_key,
        Body=json.dumps(manifest, indent=2).encode("utf-8"),
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )

    if args.evidence_out:
        args.evidence_out.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
