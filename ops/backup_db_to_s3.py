"""TV1 (A05/K11/K12) - Backup PostgreSQL database to the dedicated S3 backup bucket.

- Runs pg_dump --format=custom --no-owner --no-acl (via local pg_dump or postgres:17 container).
- Computes all table digests and pg_dump using one exported REPEATABLE READ snapshot.
- Uploads the dump to s3://<backup-bucket>/postgres/<run-id>/portal.dump with SSE-S3 (AES256)
  and records the S3 VersionId.
- Stores the binary dump ONLY under backups/ (git-ignored, contains password hashes) and writes
  a secret-free manifest JSON to the specified --evidence-out path.
"""
import argparse
from contextlib import contextmanager
import queue
import re
import threading
import uuid
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


def pg_environment(password):
    env = os.environ.copy()
    env.update(PGPASSWORD=password, PGCLIENTENCODING="UTF8", PGTZ="UTC")
    return env


def pg_command(tool, pg_container, host, port, user, dbname, arguments):
    connection = ["--no-password", "-U", user, "-d", dbname]
    if pg_container:
        return ["docker", "exec", "-i", "-e", "PGPASSWORD", "-e", "PGCLIENTENCODING", "-e", "PGTZ",
                pg_container, tool, *connection, *arguments]
    return [tool, "-h", host, "-p", str(port), *connection, *arguments]


def checked_snapshot_id(snapshot_id):
    if not isinstance(snapshot_id, str) or not re.fullmatch(r"[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+", snapshot_id):
        raise ValueError("Invalid PostgreSQL exported snapshot identifier")
    return snapshot_id


@contextmanager
def exported_snapshot(pg_container, host, port, user, dbname, password):
    command = pg_command("psql", pg_container, host, port, user, dbname,
                         ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"])
    env = pg_environment(password)
    env["PGAPPNAME"] = "tv1-backup-exporter-" + uuid.uuid4().hex
    # PGAPPNAME is diagnostic only; the open process/transaction owns the snapshot.
    if pg_container:
        command[3:3] = ["-e", "PGAPPNAME"]
    proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, encoding="utf-8", env=env)
    try:
        proc.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n")
        proc.stdin.flush()
        answer = queue.Queue(maxsize=1)
        reader = threading.Thread(target=lambda: answer.put(proc.stdout.readline()), daemon=True)
        reader.start()
        try:
            snapshot_id = checked_snapshot_id(answer.get(timeout=15).strip())
        except (queue.Empty, ValueError):
            raise RuntimeError("Could not acquire PostgreSQL backup snapshot") from None
        yield snapshot_id
        if proc.poll() is not None:
            raise RuntimeError("PostgreSQL snapshot exporter ended before backup completed")
    finally:
        try:
            proc.communicate("ROLLBACK;\n" if proc.poll() is None else None, timeout=10)
        except (subprocess.TimeoutExpired, BrokenPipeError):
            if proc.poll() is None:
                proc.kill()
            proc.communicate()


def run_psql_query(pg_container: str | None, host: str, port: int, user: str, dbname: str, password: str, sql: str, snapshot_id=None) -> str:
    if snapshot_id is not None:
        snapshot_id = checked_snapshot_id(snapshot_id)
        sql = f"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '{snapshot_id}'; {sql} COMMIT;"
    cmd = pg_command("psql", pg_container, host, port, user, dbname,
                     ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql])
    proc = subprocess.run(cmd, env=pg_environment(password), capture_output=True, text=True, encoding="utf-8")
    if proc.returncode:
        raise RuntimeError(f"PostgreSQL psql failed (exit {proc.returncode})")
    return proc.stdout.strip()


def snapshot_tables(pg_container: str | None, host: str, port: int, user: str, dbname: str, password: str, snapshot_id=None) -> dict:
    snap = {}
    for table in TABLES:
        order_col = "installed_rank" if table == "flyway_schema_history" else "handover_id, file_version_id" if table == "handover_items" else "1, 2"
        sql = f"SELECT row_to_json(t)::text FROM (SELECT * FROM {table} ORDER BY {order_col}) t;"
        rows_raw = run_psql_query(pg_container, host, port, user, dbname, password, sql, snapshot_id=snapshot_id)
        lines = [line for line in rows_raw.splitlines() if line.strip()]
        canonical = "\n".join(lines).encode("utf-8")
        snap[table] = {"rowCount": len(lines), "canonicalSha256": hashlib.sha256(canonical).hexdigest()}
    return snap


def run_pg_dump(pg_container: str | None, host: str, port: int, user: str, dbname: str, password: str, out_file: Path, snapshot_id=None):
    out_file.parent.mkdir(parents=True, exist_ok=True)
    arguments = ["--format=custom", "--no-owner", "--no-acl"]
    if snapshot_id is not None:
        arguments.append("--snapshot=" + checked_snapshot_id(snapshot_id))
    command = pg_command("pg_dump", pg_container, host, port, user, dbname, arguments)
    # Exclusive creation prevents a failed run from ever uploading a stale archive.
    with out_file.open("xb") as output:
        try:
            proc = subprocess.run(command, env=pg_environment(password), stdout=output, stderr=subprocess.PIPE)
            if proc.returncode:
                raise RuntimeError(f"PostgreSQL pg_dump failed (exit {proc.returncode})")
        except BaseException:
            output.close()
            out_file.unlink(missing_ok=True)  # Only this invocation's exclusively created file.
            raise


def validate_dump(pg_container, dump_file):
    if not dump_file.is_file() or dump_file.stat().st_size < 5:
        raise RuntimeError("Backup archive is missing or empty")
    with dump_file.open("rb", buffering=0) as source:
        if source.read(5) != b"PGDMP":
            raise RuntimeError("Backup archive is not a PostgreSQL custom dump")
        source.seek(0)
        command = ["pg_restore", "--list"]
        if pg_container:
            command = ["docker", "exec", "-i", pg_container, *command]
        proc = subprocess.run(command, stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if proc.returncode:
            raise RuntimeError("PostgreSQL could not read the backup archive")


def main(argv=None):
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
    args = parser.parse_args(argv)

    if args.evidence_out and args.evidence_out.exists():
        raise RuntimeError("Evidence path already exists; choose a new path for this backup run")

    password = os.environ.get("PGPASSWORD") or os.environ.get("LOCAL_PG_PASSWORD", "local-only-not-a-secret")
    pg_container = args.pg_container.strip() or None
    endpoint_url = args.endpoint_url.strip() or None
    role_arn = args.assume_role_arn.strip() or None

    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", args.label):
        parser.error("label must contain only letters, digits, underscore or hyphen (1..64)")
    run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + f"-{args.label}-" + uuid.uuid4().hex
    local_dump = ROOT / "backups" / run_id / "portal.dump"

    t0 = time.perf_counter()
    with exported_snapshot(pg_container, args.host, args.port, args.user, args.dbname, password) as snapshot_id:
        table_snapshot = snapshot_tables(pg_container, args.host, args.port, args.user, args.dbname, password, snapshot_id=snapshot_id)
        t_snap = time.perf_counter()
        run_pg_dump(pg_container, args.host, args.port, args.user, args.dbname, password, local_dump, snapshot_id=snapshot_id)
        t_dump = time.perf_counter()
    validate_dump(pg_container, local_dump)

    dump_bytes = local_dump.read_bytes()
    dump_sha256 = hashlib.sha256(dump_bytes).hexdigest()

    s3 = s3_client(endpoint_url, args.region, role_arn)
    dump_key = f"postgres/{run_id}/portal.dump"
    meta_key = f"postgres/{run_id}/portal.dump.meta.json"

    try:
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
    except Exception:
        raise RuntimeError("Dump upload failed; backup incomplete") from None
    t_upload = time.perf_counter()
    s3_version_id = put_resp.get("VersionId")
    if not isinstance(s3_version_id, str) or not s3_version_id.strip() or s3_version_id == "null":
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

    try:
        s3.put_object(
            Bucket=args.backup_bucket,
            Key=meta_key,
            Body=json.dumps(manifest, indent=2).encode("utf-8"),
            ContentType="application/json",
            ServerSideEncryption="AES256",
        )
    except Exception:
        raise RuntimeError(f"Dump uploaded at VersionId {s3_version_id}; manifest upload failed; backup incomplete") from None

    if args.evidence_out:
        args.evidence_out.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(json.dumps(manifest, indent=2))
    return manifest


if __name__ == "__main__":
    main()
