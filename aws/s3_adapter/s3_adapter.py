import boto3
import hashlib
import json
from botocore.config import Config

BUCKET = "nhom5-document-storage-2026-dang"
REGION = "ap-southeast-2"

s3 = boto3.client(
    "s3",
    region_name=REGION,
    endpoint_url=f"https://s3.{REGION}.amazonaws.com",
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "virtual"}
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
    if not isinstance(version_id, str) or not version_id.strip():
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


def get_checksum_result(key, version_id):
    validate_key(key)
    validate_version_id(version_id)

    key_hash = hashlib.sha256(key.encode("utf-8")).hexdigest()
    result_key = f"results/{key_hash}/{version_id}.json"

    response = s3.get_object(
        Bucket=BUCKET,
        Key=result_key
    )

    return json.loads(response["Body"].read())
