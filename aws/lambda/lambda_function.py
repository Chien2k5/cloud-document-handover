"""S3 checksum Lambda using the backend checksum schema v1."""
import hashlib
import json
import os
import re
from contextlib import closing
from datetime import datetime, timezone
from urllib.parse import unquote_plus

MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_RESULT_BYTES = 64 * 1024
CHUNK_BYTES = 1024 * 1024
RESULT_FIELDS = frozenset({
    "schemaVersion", "bucket", "objectKey", "versionId", "size", "status",
    "actualSha256", "errorCode", "processedAt",
})
_client = None


def result_key(bucket, key, version_id):
    # Identity must be identical to Java S3StorageAdapter.resultKey.
    parts = [hashlib.sha256(value.encode("utf-8")).hexdigest()
             for value in (bucket, key, version_id)]
    return "results/" + "/".join(parts) + ".json"


def hash_version(s3, bucket, key, version_id):
    response = s3.get_object(Bucket=bucket, Key=key, VersionId=version_id)
    with closing(response["Body"]) as body:
        size = response.get("ContentLength")
        if response.get("VersionId") != version_id:
            raise ValueError("Unexpected source version")
        if type(size) is not int or not 1 <= size <= 9223372036854775807:
            raise ValueError("Invalid source size")
        if size > MAX_FILE_BYTES:
            return size, None, "FILE_TOO_LARGE"
        digest = hashlib.sha256()
        count = 0
        while chunk := body.read(CHUNK_BYTES):
            count += len(chunk)
            if count > size:
                raise ValueError("Source stream exceeded reported size")
            digest.update(chunk)
        if count != size:
            raise ValueError("Incomplete source stream")
        return size, digest.hexdigest(), None


def _unique_fields(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("Duplicate JSON field")
        result[name] = value
    return result


def verify_existing_result(s3, bucket, key, expected):
    response = s3.get_object(Bucket=bucket, Key=key)
    with closing(response["Body"]) as body:
        data = body.read(MAX_RESULT_BYTES + 1)
        if len(data) > MAX_RESULT_BYTES:
            raise ValueError("Existing checksum document is too large")
        saved = json.loads(data, object_pairs_hook=_unique_fields)
    if not isinstance(saved, dict) or set(saved) != RESULT_FIELDS:
        raise ValueError("Existing checksum document has an incompatible schema")
    for name in RESULT_FIELDS - {"processedAt"}:
        if type(saved[name]) is not type(expected[name]) or saved[name] != expected[name]:
            raise ValueError("Existing checksum result does not match source")
    timestamp = saved["processedAt"]
    if not isinstance(timestamp, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:[0-5]\d)", timestamp, re.ASCII):
        raise ValueError("Invalid checksum timestamp")
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.utcoffset() is None or abs(parsed.utcoffset().total_seconds()) > 18 * 3600:
        raise ValueError("Checksum timestamp requires a Java-compatible timezone")


def process_records(event, s3, expected_bucket):
    if not isinstance(expected_bucket, str) or not expected_bucket.strip():
        raise ValueError("UPLOAD_BUCKET is required")
    created = skipped = 0
    for record in event.get("Records", []):
        if record.get("eventSource") != "aws:s3":
            continue
        if not record.get("eventName", "").startswith("ObjectCreated:"):
            continue
        source = record["s3"]
        bucket = source["bucket"]["name"]
        key = unquote_plus(source["object"]["key"], encoding="utf-8", errors="strict")
        if bucket != expected_bucket or not key.startswith("uploads/") or key.endswith("/"):
            continue
        version = source["object"].get("versionId")
        if not isinstance(version, str) or not version.strip() or version == "null":
            raise ValueError("Upload event requires an S3 Version ID")

        # Storage failures propagate to Lambda. Never fabricate a successful hash.
        size, actual, error_code = hash_version(s3, bucket, key, version)
        result = {
            "schemaVersion": 1,
            "bucket": bucket,
            "objectKey": key,
            "versionId": version,
            "size": size,
            "status": "FAILED" if error_code else "SUCCEEDED",
            "actualSha256": actual,
            "errorCode": error_code,
            "processedAt": datetime.now(timezone.utc).isoformat(),
        }
        destination = result_key(bucket, key, version)
        data = json.dumps(result, ensure_ascii=False).encode("utf-8")
        if len(data) > MAX_RESULT_BYTES:
            raise ValueError("Checksum document is too large")
        try:
            s3.put_object(Bucket=bucket, Key=destination, Body=data,
                          ContentType="application/json", IfNoneMatch="*")
            created += 1
        except s3.exceptions.ClientError as error:
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status != 412:
                raise  # Includes 409 conflicts and temporary storage failures.
            verify_existing_result(s3, bucket, destination, result)
            skipped += 1
    return {"created": created, "skipped": skipped}


def lambda_handler(event, context):
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config

        _client = boto3.client("s3", config=Config(
            connect_timeout=3, read_timeout=3,
            retries={"mode": "standard", "total_max_attempts": 3},
        ))
    return process_records(event, _client, os.environ["UPLOAD_BUCKET"])
