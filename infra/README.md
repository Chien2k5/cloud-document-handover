# Hạ tầng AWS & Giả lập Local (TV1 — Hoàng Hải Chiến | A01, A02, A03)

Thư mục `infra/` chứa toàn bộ cấu hình Infrastructure-as-Code (CloudFormation), chính sách IAM quyền tối thiểu, cấu hình CORS S3 và bộ giả lập AWS trên Docker (PostgreSQL 17 + LocalStack S3/Lambda + Nginx EB) do **TV1 (Hoàng Hải Chiến)** phụ trách theo `PRINCIPLE.MD`.

## 1. Cấu trúc thư mục

| Đường dẫn | Mã việc | Mô tả |
| --- | --- | --- |
| [`cloudformation/00-storage.yaml`](cloudformation/00-storage.yaml) | A03, A05, K05, K12 | S3 Upload Bucket (private, Versioning `Enabled`, mã hóa `AES256`, CORS, chỉ trigger Lambda trên prefix `uploads/`), Lambda SHA-256 (`python3.12`), S3 Backup Bucket tách quyền (`postgres/`), CloudWatch Logs (retention 14 ngày) & 3 CloudWatch Alarms (`Errors`, `Throttles`, `Duration`). Hỗ trợ cả **AWS Academy Learner Lab** (`UseLabRole=true`, dùng `LabRole`/`LabInstanceProfile`) và tài khoản AWS thường (`UseLabRole=false`, tự tạo IAM Role quyền tối thiểu). |
| [`cloudformation/01-rds-beanstalk-cloudfront.yaml`](cloudformation/01-rds-beanstalk-cloudfront.yaml) | A01, A03, A04, A05, K12, K13 | RDS PostgreSQL 17 độc lập vòng đời Elastic Beanstalk (`PubliclyAccessible=false`, chỉ nhận kết nối TCP 5432 từ Security Group của EB), Elastic Beanstalk Corretto 21 trên AL2023 (`SingleInstance`, port `5000`, health check `/api/v1/health`), CloudFront HTTPS (`*.cloudfront.net` phục vụ cùng origin cho `/portal/` và `/api/v1`), và CloudWatch Alarms cho RDS. |
| [`iam/backend-instance-s3-policy.json`](iam/backend-instance-s3-policy.json) | A03, K12 | Chính sách IAM quyền tối thiểu cho EC2 Instance Profile của Backend (`s3:PutObject`, `s3:GetObjectVersion` trên `uploads/*`; `s3:GetObject` trên `results/*`; `s3:ListBucket` trên upload bucket để phân biệt `404 NoSuchKey/NoSuchVersion` với `403 AccessDenied`). Không cấp `s3:DeleteObject*` và không truy cập được Backup Bucket. |
| [`iam/lambda-checksum-s3-policy.json`](iam/lambda-checksum-s3-policy.json) | A03, K05, K12 | Chính sách IAM quyền tối thiểu cho Lambda SHA-256 (`s3:GetObjectVersion` trên `uploads/*`, `s3:PutObject`/`s3:GetObject` trên `results/*`, `s3:ListBucket`, CloudWatch Logs). |
| [`iam/backup-operator-s3-policy.json`](iam/backup-operator-s3-policy.json) | A05, K11, K12 | Chính sách IAM tách riêng cho tác vụ backup/restore PostgreSQL (`s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion` trên `s3://<backup-bucket>/postgres/*` và quyền đọc đối chiếu `uploads/*`, `results/*` khi kiểm tra sau restore). |
| [`config/s3-cors.json`](config/s3-cors.json) | A03 | Cấu hình CORS chuẩn cho S3 Upload Bucket: cho phép `PUT`, `GET`, `HEAD` từ origin của Portal, cho phép header `content-type`, `if-none-match` và expose `x-amz-version-id`, `etag`. |
| [`local/compose.yml`](local/compose.yml) | A02 | Docker Compose giả lập môi trường AWS ở local: `postgres:17` (cổng `15432`), `localstack/localstack:4.4` (S3 + Lambda, cổng `4566`), và `nginx:stable-alpine` (cổng `8088`, nạp trực tiếp file `99_portal.conf` của Beanstalk). |
| [`local/bootstrap_localstack.py`](local/bootstrap_localstack.py) | A02, A03 | Script khởi tạo tự động trên LocalStack đúng theo thiết kế của `00-storage.yaml` (2 bucket Versioning + Encryption + BlockPublicAccess, CORS, đóng gói và tạo hàm Lambda `aws/lambda/lambda_function.py`, gắn S3 notification chỉ cho prefix `uploads/`). |

## 2. Kiểm tra hợp lệ template CloudFormation (`cfn-lint`)

```powershell
python -c "import sys; from cfnlint.runner import main; sys.argv=['cfn-lint','infra/cloudformation/00-storage.yaml','infra/cloudformation/01-rds-beanstalk-cloudfront.yaml']; main()"
```

Cả 2 template đều đạt **0 lỗi, 0 cảnh báo** (`exit code 0`).

## 3. Chạy môi trường giả lập AWS ở Local

```powershell
docker compose -f infra/local/compose.yml up -d
python infra/local/bootstrap_localstack.py
```

Sau khi khởi tạo, có thể chạy toàn bộ kịch bản kiểm thử tích hợp của TV1 (Nginx + Spring Boot + S3 Presigned PUT/GET + Lambda SHA-256 + Backup S3 + Restore DB tách biệt + Redeploy):

```powershell
python ops/verify_tv1_local_stack.py
```

## F003 custom-mode operator boundary

Custom mode (`UseLabRole=false`) requires `BackupOperatorPrincipalArn`, an existing
IAM user/role independent of backend credentials. The template rule rejects a missing
value. Root, STS session and wildcard principals are rejected. The deploy script
validates before AWS calls and forwards the parameter on both storage updates.
An administrator must confirm the real identity and authorize `sts:AssumeRole` on
the exact backup-role output ARN as required by its account/policies. Authenticate
through that operator's own CLI profile/federated session and pass `--assume-role-arn`
to the backup/restore scripts. No real principal is assumed to exist in local tests.

Backend has no Allow to assume backup and has an explicit Deny for that target ARN.
Backup trust excludes backend even if supplied accidentally as operator principal.
The deterministic target ARN avoids a CloudFormation circular dependency. S3/Lambda
Allow permissions and bucket policies remain unchanged; no new delete/wildcard Allow.
The existing operator lacks ListBucket on the upload bucket: missing-result S3 calls
may return 403, which restore must report as permission/indeterminate, not VERIFIED.
This existing diagnostic limitation needs an AWS permissions decision, not a silent
permission expansion in this fix.

Lab mode still requires no operator ARN and creates no IAM resources. A shared
LabRole is not an independently verified least-privilege boundary. Actual policies,
SCPs, principal existence and effective access remain `AWS_VERIFICATION_PENDING`.
`IAM_EFFECTIVE_PERMISSIONS_ON_AWS: NOT_RUN`. Local tests evaluate only the explicit
CloudFormation/IAM subset, not AWS effective permissions.

```powershell
& infra/tests.venv/Scripts/python.exe -B infra/tests/test_backup_iam.py F003
& infra/tests.venv/Scripts/cfn-lint.exe infra/cloudformation/00-storage.yaml infra/cloudformation/01-rds-beanstalk-cloudfront.yaml
```

## F010 RDS alarm notifications (offline-configured; AWS delivery pending)

Both RDS alarms reuse the storage stack's existing `AlarmTopic` export. There is
one SNS topic, only when storage `AlarmEmail` is nonempty, with an email subscription
and a CloudWatch publish policy bounded to the same account/Region and that topic.
RDS `AlarmActions` imports the topic only when `EnableRdsAlarmNotifications=true`;
manual mode sets `ActionsEnabled=false` and omits actions without importing an empty
ARN. Only ALARM actions are added; recovery/insufficient-data actions are unchanged.

New stacks default to manual monitoring. The deployment script accepts optional
`-AlarmEmail`: a supplied nonempty address is forwarded to both storage updates
(including CORS) and enables RDS notifications on the app stack. A supplied empty
string is rejected before native calls: cross-stack imports must be removed first.
Omitting this parameter sends no notification overrides, preserving
existing stack parameters; on a new stack the template defaults apply. No personal
recipient or account ID is hardcoded. Existing Lambda alarm definitions are retained.

For separate template usage: create/update storage with a valid nonempty AlarmEmail
first, then enable RDS notification on the app stack using that StorageStackName.
Do not enable it against an absent/empty topic export. Keeping RDS notifications
false while Lambda notifications use the topic is supported. The application output
`RdsAlarmNotificationMode` describes configuration, not successful delivery.

To disable an existing configuration, update the app stack first with
`EnableRdsAlarmNotifications=false` and wait for that update to finish. Verify that
no other stacks import the storage `AlarmTopic` export. Only then clear storage
`AlarmEmail` if the topic is no longer needed (this also disables Lambda email
notifications). CloudFormation cannot change/delete an export while it is imported.
The combined storage-first deployment script deliberately refuses explicit empty
`-AlarmEmail`; omit it to preserve configuration, or use these ordered stack updates.
These are future operator steps, not AWS operations executed by the offline tests.

An email subscription declaration is not confirmation. The owner must later confirm
the recipient subscription, verify topic policy/permissions in the target personal AWS account,
and test a controlled alarm notification and receipt before claiming delivery PASS.
No AWS deployment or delivery test was run for this change. No Learner Lab restriction
is assumed for the personal account. Manual mode is an explicit opt-out/backward-
compatible default, not a claim that SNS is unavailable. If SNS is not configured,
keep manual mode and assign an operator to check both RDS alarms in CloudWatch during
operation and record follow-up; this mode does not send email automatically.

Offline tests (existing venv only; no AWS calls):

```powershell
& infra/tests.venv/Scripts/python.exe -B -m unittest discover -s infra/tests -p test_rds_alarm_notifications.py -v
& infra/tests.venv/Scripts/cfn-lint.exe infra/cloudformation/00-storage.yaml infra/cloudformation/01-rds-beanstalk-cloudfront.yaml
```

Status: `FIXED_LOCAL_PENDING_AWS_VERIFICATION` only after local gates pass.
`SNS_SUBSCRIPTION_CONFIRMED: PENDING_AWS_VERIFICATION`;
`NOTIFICATION_DELIVERY: PENDING_AWS_VERIFICATION`.
