"""TV1 (A02/A03) - provision the LocalStack emulation with the same settings as
infra/cloudformation/00-storage.yaml:

* upload bucket: private (Block Public Access), Versioning Enabled, SSE-S3, CORS
* checksum Lambda (aws/lambda/lambda_function.py, python3.12, handler unchanged)
* S3 -> Lambda notification: s3:ObjectCreated:Put, prefix uploads/ ONLY (never results/)
* backup bucket: private, Versioning Enabled, SSE-S3, separate from the upload bucket

LOCAL EMULATION ONLY. Uses LocalStack dummy credentials; never point it at real AWS.
Usage:  python infra/local/bootstrap_localstack.py [--origin http://localhost:8088]
"""
import argparse
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[2]
ENDPOINT = os.environ.get("LOCALSTACK_ENDPOINT", "http://localhost:4566")
REGION = "us-east-1"
LAMBDA_NAME = "handover-checksum-local"
CORS_FILE = ROOT / "infra" / "config" / "s3-cors.json"


def client(service):
    if not ENDPOINT.startswith("http://localhost") and not ENDPOINT.startswith("http://127.0.0.1"):
        sys.exit("Refusing: LOCALSTACK_ENDPOINT must be a loopback LocalStack endpoint")
    return boto3.client(service, endpoint_url=ENDPOINT, region_name=REGION,
                        aws_access_key_id="test", aws_secret_access_key="test",
                        config=Config(retries={"mode": "standard", "max_attempts": 5}))


def lambda_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(ROOT / "aws" / "lambda" / "lambda_function.py", "lambda_function.py")
    return buf.getvalue()


def ensure_bucket(s3, name):
    try:
        s3.create_bucket(Bucket=name)
    except s3.exceptions.BucketAlreadyOwnedByYou:
        pass
    s3.put_public_access_block(Bucket=name, PublicAccessBlockConfiguration={
        "BlockPublicAcls": True, "IgnorePublicAcls": True,
        "BlockPublicPolicy": True, "RestrictPublicBuckets": True})
    s3.put_bucket_versioning(Bucket=name, VersioningConfiguration={"Status": "Enabled"})
    s3.put_bucket_encryption(Bucket=name, ServerSideEncryptionConfiguration={
        "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload-bucket", default="handover-uploads-local")
    parser.add_argument("--backup-bucket", default="handover-backups-local")
    parser.add_argument("--origin", default="http://localhost:8088",
                        help="browser origin allowed by S3 CORS (the Nginx/portal origin)")
    args = parser.parse_args()

    s3, lam = client("s3"), client("lambda")
    ensure_bucket(s3, args.upload_bucket)
    ensure_bucket(s3, args.backup_bucket)

    cors = json.loads(CORS_FILE.read_text(encoding="utf-8"))
    for rule in cors["CORSRules"]:
        rule["AllowedOrigins"] = [args.origin]
    s3.put_bucket_cors(Bucket=args.upload_bucket, CORSConfiguration=cors)

    code = lambda_zip()
    try:
        lam.get_function(FunctionName=LAMBDA_NAME)
        lam.update_function_code(FunctionName=LAMBDA_NAME, ZipFile=code)
        lam.get_waiter("function_updated_v2").wait(FunctionName=LAMBDA_NAME)
        lam.update_function_configuration(FunctionName=LAMBDA_NAME,
                                          Environment={"Variables": {"UPLOAD_BUCKET": args.upload_bucket}})
    except lam.exceptions.ResourceNotFoundException:
        lam.create_function(
            FunctionName=LAMBDA_NAME, Runtime="python3.12", Handler="lambda_function.lambda_handler",
            Role="arn:aws:iam::000000000000:role/LabRole", Code={"ZipFile": code},
            Timeout=120, MemorySize=512,
            Environment={"Variables": {"UPLOAD_BUCKET": args.upload_bucket}})
    lam.get_waiter("function_active_v2").wait(FunctionName=LAMBDA_NAME)
    fn_arn = lam.get_function(FunctionName=LAMBDA_NAME)["Configuration"]["FunctionArn"]
    try:
        lam.add_permission(FunctionName=LAMBDA_NAME, StatementId="s3-invoke-uploads",
                           Action="lambda:InvokeFunction", Principal="s3.amazonaws.com",
                           SourceArn=f"arn:aws:s3:::{args.upload_bucket}", SourceAccount="000000000000")
    except lam.exceptions.ResourceConflictException:
        pass

    s3.put_bucket_notification_configuration(Bucket=args.upload_bucket, NotificationConfiguration={
        "LambdaFunctionConfigurations": [{
            "Id": "checksum-uploads-only",
            "LambdaFunctionArn": fn_arn,
            "Events": ["s3:ObjectCreated:Put"],
            "Filter": {"Key": {"FilterRules": [{"Name": "prefix", "Value": "uploads/"}]}},
        }]})

    # Read back and print the effective configuration (evidence, no secrets).
    summary = {
        "endpoint": ENDPOINT,
        "uploadBucket": args.upload_bucket,
        "backupBucket": args.backup_bucket,
        "versioning": {b: s3.get_bucket_versioning(Bucket=b).get("Status")
                       for b in (args.upload_bucket, args.backup_bucket)},
        "encryption": s3.get_bucket_encryption(Bucket=args.upload_bucket)[
            "ServerSideEncryptionConfiguration"]["Rules"][0]["ApplyServerSideEncryptionByDefault"],
        "publicAccessBlock": s3.get_public_access_block(Bucket=args.upload_bucket)[
            "PublicAccessBlockConfiguration"],
        "cors": s3.get_bucket_cors(Bucket=args.upload_bucket)["CORSRules"],
        "notification": s3.get_bucket_notification_configuration(Bucket=args.upload_bucket)[
            "LambdaFunctionConfigurations"],
        "lambda": {k: lam.get_function(FunctionName=LAMBDA_NAME)["Configuration"][k]
                   for k in ("FunctionName", "Runtime", "Handler", "Timeout", "MemorySize", "State")},
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
