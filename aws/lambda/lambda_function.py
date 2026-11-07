import boto3
import hashlib
import json
import urllib.parse
from datetime import datetime, timezone
from botocore.exceptions import ClientError

s3 = boto3.client("s3")


def lambda_handler(event, context):
    results = []

    for record in event["Records"]:
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(
            record["s3"]["object"]["key"]
        )
        version_id = record["s3"]["object"].get("versionId")

        if not key.startswith("uploads/") or key.endswith("/"):
            continue

        if not version_id or version_id == "null":
            raise ValueError("S3 event khong co Version ID hop le")

        result_key = (
            "results/"
            + hashlib.sha256(key.encode("utf-8")).hexdigest()
            + "/"
            + urllib.parse.quote(version_id, safe="")
            + ".json"
        )

        response = s3.get_object(
            Bucket=bucket,
            Key=key,
            VersionId=version_id
        )

        sha256 = hashlib.sha256()

        for chunk in response["Body"].iter_chunks(
            chunk_size=1024 * 1024
        ):
            if chunk:
                sha256.update(chunk)

        result = {
            "bucket": bucket,
            "objectKey": key,
            "versionId": version_id,
            "sha256": sha256.hexdigest(),
            "status": "HASHED",
            "processedAt": datetime.now(timezone.utc).isoformat()
        }

        try:
            s3.put_object(
                Bucket=bucket,
                Key=result_key,
                Body=json.dumps(result, indent=2).encode("utf-8"),
                ContentType="application/json",
                IfNoneMatch="*"
            )

            print("CREATED:", result_key)
            result["writeStatus"] = "CREATED"

        except ClientError as e:
            code = e.response["Error"]["Code"]

            if code in ("PreconditionFailed", "412"):
                existing = s3.get_object(
                    Bucket=bucket,
                    Key=result_key
                )
                saved = json.loads(existing["Body"].read())

                if (
                    saved.get("bucket") != bucket
                    or saved.get("objectKey") != key
                    or saved.get("versionId") != version_id
                    or saved.get("sha256") != result["sha256"]
                    or saved.get("status") != "HASHED"
                ):
                    raise ValueError(
                        "Existing checksum JSON does not match source"
                    )

                print("DUPLICATE SKIPPED:", result_key)
                result = saved.copy()
                result["writeStatus"] = "SKIPPED"

            else:
                raise

        results.append(result)

    return {
        "statusCode": 200,
        "body": json.dumps(results)
    }
