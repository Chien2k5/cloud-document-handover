import boto3
import hashlib
import json
from contextlib import closing
from botocore.config import Config

BUCKET = "nhom5-document-storage-2026-dang"
REGION = "ap-southeast-2"

s3 = boto3.client(
    "s3",
    region_name=REGION,
    endpoint_url=f"https://s3.{REGION}.amazonaws.com",
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "virtual"},
        connect_timeout=3,
        read_timeout=3,
        retries={"mode": "standard", "total_max_attempts": 3}
    )
)


def validate_key(key):
    if not isinstance(key, str) or not key.startswith("uploads/"):
        raise ValueError("Object Key phai nam trong uploads/")

    if key.endswith("/") or chr(92) in key:
        raise ValueError("Object Key khong hop le")

    parts = key.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("Object Key chua thanh phan khong an toan")


def validate_version_id(version_id):
    if not isinstance(version_id, str) or not version_id.strip() or version_id == "null":
        raise ValueError("Version ID khong duoc de trong")


def validate_expires(expires):
    if type(expires) is not int or not 1 <= expires <= 3600:
        raise ValueError("expires phai tu 1 den 3600 giay")


def create_upload_url(key, expires=300):
    validate_key(key)
    validate_expires(expires)
    return s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=expires,
        HttpMethod="PUT"
    )


def create_download_url(key, version_id, expires=300):
    validate_key(key)

    validate_version_id(version_id)
    validate_expires(expires)

    return s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": BUCKET,
            "Key": key,
            "VersionId": version_id
        },
        ExpiresIn=expires,
        HttpMethod="GET"
    )


def get_latest_version(key):
    validate_key(key)
    response = s3.head_object(
        Bucket=BUCKET,
        Key=key
    )
    return response["VersionId"]


def list_versions(key):
    validate_key(key)
    paginator = s3.get_paginator("list_object_versions")
    versions = []

    for page in paginator.paginate(Bucket=BUCKET, Prefix=key):
        for version in page.get("Versions", []):
            if version["Key"] == key:
                versions.append({
                    "versionId": version["VersionId"],
                    "isLatest": version["IsLatest"],
                    "size": version["Size"]
                })

    return versions


def checksum_result_key(bucket, key, version_id):
    parts = [hashlib.sha256(value.encode("utf-8")).hexdigest()
             for value in (bucket, key, version_id)]
    return "results/" + "/".join(parts) + ".json"


def _unique_json_fields(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("Duplicate checksum JSON field")
        result[name] = value
    return result


def get_checksum_result(key, version_id):
    validate_key(key)
    validate_version_id(version_id)

    result_key = checksum_result_key(BUCKET, key, version_id)

    response = s3.get_object(
        Bucket=BUCKET,
        Key=result_key
    )

    with closing(response["Body"]) as body:
        data = body.read(65537)
        if len(data) > 65536:
            raise ValueError("Checksum JSON exceeds 64 KiB")
        return json.loads(data, object_pairs_hook=_unique_json_fields)
