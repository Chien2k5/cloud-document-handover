# Nhom 5 - S3 Document Storage

## Cap nhat tich hop backend ngay 09/11/2026

Lambda va Python checksum reader da dong bo voi contract v1 cua backend Java nhanh `dung`, commit `41673cabf1ed4f894312a92d136f36c4355e44ca`. Lambda tiep tuc dung Python; backend goi S3 bang adapter Java. JSON/key la giao dien tich hop. Cac ket qua AWS trong muc 6 ben duoi la thong tin lich su truoc ban sua nay, khong phai luot kiem AWS cho code moi.

### Result key va JSON

```text
results/{sha256hex(UTF8(bucket))}/{sha256hex(UTF8(objectKey))}/{sha256hex(UTF8(versionId))}.json
```

Khong trim/encode lai Version ID. Object key trong event duoc decode dung mot lan. Lambda ghi dung 9 field, khong them writeStatus vao object JSON luu tren S3:

```json
{
  "schemaVersion": 1,
  "bucket": "fixture-bucket",
  "objectKey": "uploads/a +%=.pdf",
  "versionId": "v+/=%",
  "size": 3,
  "status": "SUCCEEDED",
  "actualSha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "errorCode": null,
  "processedAt": "2026-11-09T00:00:00Z"
}
```

Vi du tren la hash cua bytes `abc`. Thanh cong dung SUCCEEDED/actualSha256 thay HASHED/sha256. FAILED co actualSha256=null va errorCode an toan, van du 9 field va size/identity dang tin cay. Backend moi so expected/actual de ket luan VERIFIED/MISMATCH. Schema chuan: [checksum-result.schema.json tren backend dung](https://github.com/Chien2k5/cloud-document-handover/blob/41673cabf1ed4f894312a92d136f36c4355e44ca/contracts/checksum-result.schema.json).

### Duplicate, stream, size/version va timeout

- GET source luon co VersionId; response phai khop version, size la so nguyen duong, stream phai du bytes. Khong ghi SUCCEEDED neu doc thieu/thua, sai version hoac timeout.
- Gioi han file 100 MiB. File qua lon co size dang tin cay duoc ghi FAILED/FILE_TOO_LARGE. Stream source va stream JSON duplicate/reader duoc dong ca khi phat sinh loi.
- Ket qua duoc ghi voi IfNoneMatch `*`. HTTP 412 chi duoc bo qua sau khi kiem JSON da luu khop schema/identity/size/hash/status/errorCode; processedAt phai hop le. JSON sai hoac field trung khong duoc coi la duplicate thanh cong.
- Loi 409, 5xx, quyen hoac timeout duoc nem lai; khong chuyen loi thanh ket qua hash thanh cong. Retry khong ghi de ket qua da co.
- JSON doc toi da 64 KiB. Boto3 connect_timeout=3, read_timeout=3, standard retry total_max_attempts=3. Day la timeout SDK, khong phai deadline tong cho file 100 MiB; can do Lambda timeout/memory tren Lab.
- Lambda response hien tra thong ke `created`/`skipped`. S3 goi bat dong bo; backend doc JSON trong results/, khong dung return value cua ham Lambda.

### Cau hinh khi deploy ban moi

1. Giu handler `lambda_function.lambda_handler`. Lambda package can file `aws/lambda/lambda_function.py` o root cua ZIP. Khong dong goi thu muc tests.
2. Dat bien moi truong **UPLOAD_BUCKET** bang dung bucket backend su dung; xem [lambda/.env.example](lambda/.env.example). Lambda khong tu doc file .env. Credential lay tu IAM role.
3. Trigger chi nhan ObjectCreated:Put duoi uploads/ cho luong single PUT hien tai; khong nhan results/. Role can GetObjectVersion tren uploads/*, PutObject/GetObject tren results/* va quyen Logs. GetObject results phuc vu kiem duplicate.
4. Cung Chien/Nam kiem Versioning, CORS/IAM va thu luong VERIFIED/MISMATCH tren AWS. Ban sua nay chua deploy AWS.

Python POC adapter da doi `get_checksum_result` sang key v1, gioi han doc/close stream va timeout; chan Version ID literal null. Cac ham presign/HEAD latest van la POC hien co. Luong Spring Boot su dung presigner Java; khong doi backend sang goi Python adapter.

### Test truoc khi push

Chay tu repo root, khong can AWS credentials hoac boto3 cho unit tests:

```powershell
python -m unittest discover -s aws/tests -v
python -m compileall -q aws
```

Kiem truc tiep JSON Python voi parser/result-key Java production (can JDK 21+ va JAR backend da build):

```powershell
python aws/tests/check_java_contract.py --backend-jar "DUONG_DAN/backend/target/document-handover-0.1.0-SNAPSHOT.jar"
```

Java checker nap class/thu vien tu JAR trong thu muc tam, khong khoi dong Spring context, DB hoac AWS. Kiem 2 payload thanh cong va 10 payload FAILED/sai schema/identity/size/time/field. [Bang chung test](verification-2026-11-09.json) ghi ket qua thuc te cua ban sua nay. Ket qua fake/mock va Java consumer check khong thay ket qua AWS E2E.

---

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
  .env.example

tests/
  test_checksum_lambda.py
  test_checksum_adapter.py
  check_java_contract.py
  ChecksumContractCheck.java

## 4. S3 Adapter

Cac ham da trien khai:

- create_upload_url
- create_download_url
- list_versions
- get_checksum_result

Python adapter nay phuc vu POC/test rieng. Backend Spring Boot
su dung Java StoragePort adapter tren nhanh dung; checksum writer/reader
dung chung JSON va result key v1 nhu muc cap nhat o tren.

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

Thong tin lich su duoi day duoc giu tu source truoc ngay 09/11/2026.
Chua chay lai AWS voi schema/key v1 trong luot sua nay.

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
