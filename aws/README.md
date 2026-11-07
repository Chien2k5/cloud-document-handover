# Nhom 5 - S3 Document Storage

## 1. Tong quan

Module luu tru tai lieu tren AWS S3, su dung:
- S3 Versioning de quan ly phien ban tai lieu.
- Presigned PUT/GET de upload/download.
- AWS Lambda de tinh SHA-256.
- JSON checksum de luu ket qua.
- Idempotency de tranh ghi trung ket qua.

## 2. AWS Configuration

Region: ap-southeast-2

S3 Bucket:
nhom5-document-storage-2026-dang

Lambda:
nhom5-sha256-lambda

## 3. Cau truc thu muc

s3_adapter/
  s3_adapter.py

lambda/
  lambda_function.py
  lambda-week3-fixed.zip

## 4. S3 Adapter

Cac ham da trien khai:

- create_upload_url
- create_download_url
- list_versions
- get_checksum_result

Backend su dung S3 Adapter de tao Presigned URL,
liet ke phien ban va truy van ket qua checksum.

Can cau hinh AWS credentials va IAM permissions
phu hop voi moi truong backend.

## 5. Lambda SHA-256

Khi upload file vao uploads/, S3 kich hoat Lambda.

Lambda:
1. Nhan S3 event.
2. Lay Object Key va Version ID.
3. Doc dung phien ban file.
4. Tinh SHA-256.
5. Ghi JSON vao results/.
6. Bo qua neu ket qua da ton tai.

## 6. Ket qua kiem thu

PASS:
- S3 Versioning V1/V2.
- SHA-256 khop voi file goc.
- Xu ly su kien sai thu tu.
- Chong ghi trung JSON.
- CREATED -> SKIPPED.
- Tu choi event thieu Version ID.

Version ID khong ton tai:
- Lambda tu choi xu ly.
- AWS tra AccessDenied do IAM chua co s3:ListBucket.
- Chua xac nhan nhanh loi NoSuchVersion.

Chua kiem thu rieng truong hop ghi dong thoi.

## 7. Luu y tich hop

- Khong hardcode AWS access key.
- Su dung IAM Role hoac credentials duoc quan ly an toan.
- Backend can co quyen S3 phu hop.
- Khong commit secrets, credentials hoac file .env.
- Can kiem tra giao dien ham va tham so trong
  s3_adapter.py truoc khi tich hop.
