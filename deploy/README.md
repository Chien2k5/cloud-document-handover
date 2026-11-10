# Đóng gói & Triển khai AWS Elastic Beanstalk / Lambda (TV1 — Hoàng Hải Chiến | A02, A04, A06)

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

## 3. Cách triển khai lên AWS Academy Learner Lab (hoặc tài khoản AWS thường)

Khi có phiên AWS Academy Learner Lab đang chạy (đã nạp `aws_access_key_id`, `aws_secret_access_key`, `aws_session_token` vào `~/.aws/credentials`):

```powershell
.\deploy\deploy_aws.ps1 `
    -ProjectName "nhom5-handover" `
    -Region "us-east-1" `
    -UseLabRole "true" `
    -VpcId "vpc-xxxxxxxx" `
    -AppSubnetIdsCsv "subnet-aaaa,subnet-bbbb" `
    -DbSubnetIdsCsv "subnet-cccc,subnet-dddd"
```

Để redeploy bản cập nhật mới và kiểm chứng **K13** (giữ nguyên DB và các gói bàn giao):

```powershell
.\deploy\redeploy_aws.ps1 -ProjectName "nhom5-handover" -Region "us-east-1"
```
