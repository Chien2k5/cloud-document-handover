# Đóng gói & Triển khai AWS Elastic Beanstalk / Lambda 

Thư mục `deploy/` chứa toàn bộ cấu hình nền tảng Elastic Beanstalk (Amazon Linux 2023 Corretto 21), script đóng gói tạo manifest SHA-256 và script triển khai/redeploy tự động theo đúng runbook bàn giao [`docs/integration/aws-deployment-handover.md`](../docs/integration/aws-deployment-handover.md).

## 1. Cấu trúc thư mục

| Đường dẫn | Mã việc | Mô tả |
| --- | --- | --- |
| [`eb/Procfile`](eb/Procfile) | A04 | Khai báo tiến trình `web: java -XX:MaxRAMPercentage=70 -jar app.jar` (UTF-8, LF) cho nền tảng Elastic Beanstalk Java SE. |
| [`eb/.platform/nginx/conf.d/elasticbeanstalk/99_portal.conf`](eb/.platform/nginx/conf.d/elasticbeanstalk/99_portal.conf) | A04 | Cấu hình Nginx mở rộng trên AL2023: chuyển hướng `/` và `/portal` sang `/portal/`, phục vụ tĩnh `frontend/dist/` tại `/portal/` (`index.html` có `Cache-Control: no-store`, `/portal/assets/` có `immutable`), giữ nguyên proxy mặc định `/api/v1/**` về Spring Boot cổng `5000`. |
| [`build_eb_bundle.py`](build_eb_bundle.py) | A02, A04 | Đóng gói `output/eb-release.zip` và tạo `output/eb-release.manifest.json` (ghi commit Git và SHA-256 từng file). Tự động kiểm tra `frontend/dist/index.html` đã được build với `--base=/portal/` và từ chối đóng gói nếu phát hiện file `.env` hay secret. |
| [`build_lambda_zip.py`](build_lambda_zip.py) | A03 | Đóng gói `aws/lambda/lambda_function.py` thành `output/lambda-checksum.zip` (chỉ có duy nhất `lambda_function.py` ở gốc ZIP, không kèm test) và tạo `output/lambda-checksum.manifest.json`. |
| [`deploy_aws.ps1`](deploy_aws.ps1) | A03, A04 | Script triển khai toàn bộ hệ thống lên AWS (build -> đóng gói -> đẩy S3 artifact -> deploy stack `00-storage.yaml` -> deploy stack `01-rds-beanstalk-cloudfront.yaml` -> cập nhật CORS `PortalOrigin` theo domain HTTPS CloudFront). |
| [`redeploy_aws.ps1`](redeploy_aws.ps1) | A04, A06, K13 | Script redeploy phiên bản ứng dụng mới lên Elastic Beanstalk mà **không ảnh hưởng dữ liệu PostgreSQL độc lập** và giữ nguyên các gói bàn giao đã phát hành (kiểm thử **K13**). |

## 2. Cách đóng gói & kiểm tra bundle tại Local

```powershell
# 1. Build Backend JAR (Java 21 target)
cd backend
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-25'
.\mvnw.cmd -B -ntp package -DskipTests
cd ..

# 2. Build Frontend với base /portal/
cd frontend
npm ci --no-audit --no-fund
npx vite build --base=/portal/
cd ..

# 3. Tạo gói eb-release.zip và lambda-checksum.zip kèm manifest SHA-256
python deploy/build_eb_bundle.py
python deploy/build_lambda_zip.py
```

Cấu trúc `output/eb-release.zip` được tạo ra ở đúng root của file ZIP:

```text
app.jar
Procfile
.platform/nginx/conf.d/elasticbeanstalk/99_portal.conf
frontend/dist/index.html
frontend/dist/assets/...
```

## 3. Preflight cho demo personal account (không phải xác nhận deploy thành công)

Đích hiện tại là **personal AWS account**. Kiểm [inventory/cost/billing/cleanup
F013](../ops/aws-lab-permissions-and-cost.md) và chọn budget owner chấp nhận trước
khi triển khai. Credit, Free Tier và quyền account vẫn UNVERIFIED; không dùng
quota/budget/TTL của Academy Lab như facts của personal account.

Operator phải kiểm đúng account/Region us-east-1, VPC/subnets/routes hiện có,
EC2/DB platform-version availability và quyền CloudFormation/EC2/RDS/S3/Lambda/
CloudFront/Logs/SNS/CreateRole/PassRole tương ứng. `UseLabRole=false` yêu cầu
BackupOperatorPrincipalArn hợp lệ, độc lập backend; script dùng EB service role
`aws-elasticbeanstalk-service-role` nên phải xác nhận role đã có và dùng được.
Không mặc định quyền hoặc đường operator tới RDS private đã tồn tại.

Template/script giữ default UseLabRole=true để tương thích; **personal account
phải truyền false rõ ràng**. Ví dụ dưới đây chỉ để owner chạy trong đợt AWS được
cho phép riêng, sau khi thay mọi placeholder và kiểm các blocker:

```powershell
.\deploy\deploy_aws.ps1 `
    -ProjectName "nhom5-handover" `
    -Region "us-east-1" `
    -UseLabRole "false" `
    -BackupOperatorPrincipalArn "<existing-dedicated-backup-operator-IAM-ARN>" `
    -VpcId "<existing-vpc>" `
    -AppSubnetIdsCsv "<existing-app-subnet-a>,<existing-app-subnet-b>" `
    -DbSubnetIdsCsv "<existing-db-subnet-a>,<existing-db-subnet-b>"
```

AlarmEmail omitted giữ cấu hình notification hiện có (new stacks default manual);
muốn bật phải truyền địa chỉ owner kiểm soát và confirm subscription/receipt sau.
Không ghi credentials/password vào tài liệu/log. Redeploy dùng script hiện có và
cần kiểm version/health/DB preservation thật, không suy ra từ restart local.

Nếu chuyển sang **Academy Lab**, chỉ chọn UseLabRole=true sau khi xác nhận các
LabRole/LabInstanceProfile, allowed Region/services, TTL và balance theo course
hiện tại. Không tạo role chỉ để thử quyền Lab; không khẳng định TTL 4h/budget
$50–$100 hay quyền bị chặn giống nhau giữa mọi Lab.

F005 origin HTTPS và F006 DB credential/provisioning vẫn BLOCKED; F010 delivery
PENDING_AWS_VERIFICATION; V001 NOT_RUN. F013 chỉ sửa docs/tests, không tạo resources
hoặc đóng các blocker. Sau demo, follow cleanup app-before-storage và kiểm retained
snapshots/S3 versions/EIP/EBS/logs/artifacts trong cost guide; stop EC2 không đủ.

## F011 PostgreSQL server identity verification

The EB DB_URL uses `sslmode=verify-full` and
`sslrootcert=/var/app/current/certs/rds-global-bundle.pem`. pgJDBC validates both
certificate chain and endpoint hostname. No SSL factory or trust bypass is used.
The RDS CA identifier is explicit (`rds-ca-rsa2048-g1` by default); confirm support
for the selected PostgreSQL engine/version and region before any real deployment.

The public RDS global bundle is vendored under `deploy/eb/certs/`, with source URL,
download timestamp and SHA-256 provenance. A scoped Git attribute preserves LF
for this public PEM even on Windows checkouts, keeping the pinned bytes stable. Bundle creation is offline and fails
if this file is missing, malformed or differs from the reviewed SHA-256. The EB ZIP
contains `certs/rds-global-bundle.pem` with mode 0644, never a private key. No runtime
network download or system truststore mutation is needed. The path survives app
restart and must be present in every redeployed bundle, including old release tooling.

For CA rotation: retrieve a fresh global bundle over verified HTTPS from the official
RDS truststore, review its certificates/provenance, update the pinned builder SHA,
run the TLS/bundle/negative/startup tests and deploy the new trust material before
changing the RDS CA. Do not replace an endpoint hostname to mask a certificate error.
A missing/unreadable trust file must fail startup. Do not reuse old release bundles
that omit the CA. The actual RDS leaf certificate and EB Linux runtime need AWS
verification; local fixture certificates are not evidence of RDS AWS verification.

TLS integration uses a fresh PostgreSQL 17 container, ephemeral fixture CA/server
keys, the actual pgJDBC from a fresh offline build of unchanged backend source, and
Spring Boot/Flyway startup. TLS is required for its TCP connections. Host runtime
paths are mapped to temporary fixture paths; fixture CA is used for local server
handshakes, while the deployment ZIP is separately checked against the official RDS
bundle hash. Test private keys remain in scoped temporary directories and are deleted.
The tests do not claim F006 DB privilege separation; that provisioning decision is
still blocked independently.

```powershell
& ops/tests/.venv/Scripts/python.exe -m pip install -r deploy/tests/requirements-security.txt
& ops/tests/.venv/Scripts/python.exe -B deploy/tests/test_database_tls.py
```

Tests require an installed JDK 21 (or `WAVE3_JAVA_HOME`), Docker's already-present PostgreSQL 17 image and a
working offline Maven distribution/dependency cache. No AWS credentials are used.
