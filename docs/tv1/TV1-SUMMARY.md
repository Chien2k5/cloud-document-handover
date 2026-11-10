# Báo cáo Tổng hợp Công việc TV1 (Hoàng Hải Chiến — Nhóm trưởng & AWS/Vận hành)

- **Thành viên:** Hoàng Hải Chiến (TV1 — Nhóm trưởng)
- **Phạm vi phụ trách theo [`PRINCIPLE.MD`](../../PRINCIPLE.MD) & Kế hoạch 5 tuần:** `infra/`, `deploy/`, `ops/`, Docker Compose giả lập AWS ở local, môi trường AWS, Elastic Beanstalk, IAM, PostgreSQL độc lập, backup/restore S3 và quản lý chi phí (Mã công việc **A01 – A06**, kiểm thử **K05, K07, K11, K12, K13**).
- **Nhánh làm việc:** `task/A01-A06-aws-infra-ops` (tách từ nhánh tích hợp mới nhất `dung`).
- **Tương thích merge:** Toàn bộ file mới của TV1 nằm trong `infra/`, `deploy/`, `ops/`, `docs/tv1/` và `evidence/tv1-local-stack/`. **Không sửa bất kỳ dòng code nào trong `backend/`, `frontend/`, `aws/`, `contracts/` của TV2, TV3, TV4** → Merge `Fast-Forward / 0 conflict` vào `dung` và `main`.

---

## 1. Bảng ánh xạ Mã công việc (A01 – A06) & Sản phẩm bàn giao (Tuần 1 – Tuần 5)

| Mã việc | Tuần | Nội dung công việc theo kế hoạch | File bàn giao trong Repo | Trạng thái kiểm chứng |
| --- | --- | --- | --- | --- |
| **A01** | T1–T2 | Kiểm tra quyền & giới hạn AWS Academy Learner Lab; chốt Region (`us-east-1`), nơi đặt PostgreSQL độc lập (RDS PostgreSQL 17 tách khỏi vòng đời EB) và dự toán ngân sách 5 tuần (`~$14.63 – $39.07` / hạn mức `$50–$100`). | [`ops/aws-lab-permissions-and-cost.md`](../../ops/aws-lab-permissions-and-cost.md) | **ĐẠT (Tài liệu & Dự toán chi tiết)** |
| **A02** | T1–T2 | Môi trường giả lập AWS ở local (`postgres:17` + `localstack:4.4` S3/Lambda + `nginx:stable-alpine` nạp trực tiếp cấu hình EB) và công cụ đóng gói bundle deploy (`eb-release.zip` + `lambda-checksum.zip` kèm manifest SHA-256). | [`infra/local/compose.yml`](../../infra/local/compose.yml), [`infra/local/bootstrap_localstack.py`](../../infra/local/bootstrap_localstack.py), [`deploy/build_eb_bundle.py`](../../deploy/build_eb_bundle.py), [`deploy/build_lambda_zip.py`](../../deploy/build_lambda_zip.py) | **PASS LOCAL EMULATION** |
| **A03** | T1–T3, T5 | Cấu hình S3 Upload Bucket (private, `BlockPublicAccess`, Versioning `Enabled`, mã hóa `AES256`, CORS expose `x-amz-version-id`), sự kiện `s3:ObjectCreated:Put` chỉ trên prefix `uploads/` (không lặp vòng `results/`), và bộ IAM Policy quyền tối thiểu (hỗ trợ cả `LabRole` của Learner Lab và Custom Role). | [`infra/cloudformation/00-storage.yaml`](../../infra/cloudformation/00-storage.yaml), [`infra/iam/backend-instance-s3-policy.json`](../../infra/iam/backend-instance-s3-policy.json), [`infra/iam/lambda-checksum-s3-policy.json`](../../infra/iam/lambda-checksum-s3-policy.json), [`infra/config/s3-cors.json`](../../infra/config/s3-cors.json) | **PASS (`cfn-lint` 0 lỗi/0 cảnh báo + LocalStack E2E)** |
| **A04** | T1–T3, T5 | Cấu hình Elastic Beanstalk Corretto 21 trên AL2023 (`Procfile` với `-Duser.timezone=UTC`, Nginx `99_portal.conf` phục vụ `/portal/` tĩnh và proxy `/api/v1` về cổng `5000`), CloudFront HTTPS miễn phí (`*.cloudfront.net` cùng origin cho `/portal/` và `/api/v1`), RDS PostgreSQL 17 độc lập (`PubliclyAccessible=false`), và script deploy/redeploy giữ nguyên DB. | [`infra/cloudformation/01-rds-beanstalk-cloudfront.yaml`](../../infra/cloudformation/01-rds-beanstalk-cloudfront.yaml), [`deploy/eb/Procfile`](../../deploy/eb/Procfile), [`deploy/eb/.platform/nginx/conf.d/elasticbeanstalk/99_portal.conf`](../../deploy/eb/.platform/nginx/conf.d/elasticbeanstalk/99_portal.conf), [`deploy/deploy_aws.ps1`](../../deploy/deploy_aws.ps1), [`deploy/redeploy_aws.ps1`](../../deploy/redeploy_aws.ps1) | **PASS (`cfn-lint` 0 lỗi/0 cảnh báo + Nginx/JAR E2E)** |
| **A05** | T2–T5 | Thiết lập CloudWatch Logs (retention 14 ngày), 5 CloudWatch Alarms (`Lambda Errors/Throttles/Duration`, `RDS FreeStorageSpace/DatabaseConnections`), S3 Backup Bucket tách quyền (`postgres/`), script sao lưu `pg_dump` lên S3 (`AES256` + `VersionId`) và script restore vào DB đích tách biệt kèm kiểm tra rollback nguyên tử & đối chiếu S3 Version ID. | [`ops/backup_db_to_s3.py`](../../ops/backup_db_to_s3.py), [`ops/restore_db_from_s3.py`](../../ops/restore_db_from_s3.py), [`infra/iam/backup-operator-s3-policy.json`](../../infra/iam/backup-operator-s3-policy.json) | **PASS LOCAL EMULATION (`11/11` bảng, `18/18` FK, S3 cross-check)** |
| **A06** | T4–T5 | Kiểm thử toàn luồng hạ tầng & phục hồi dữ liệu (`verify_tv1_local_stack.py`), rà soát không lộ secret trong repo/log/evidence, lập kế hoạch dọn tài nguyên sau đánh giá và tổng hợp báo cáo để merge. | [`ops/verify_tv1_local_stack.py`](../../ops/verify_tv1_local_stack.py), [`evidence/tv1-local-stack/`](../../evidence/tv1-local-stack/), [`ops/aws-lab-permissions-and-cost.md`](../../ops/aws-lab-permissions-and-cost.md) | **PASS LOCAL EMULATION (`AWS_CLOUD = NOT_RUN`)** |

---

## 2. Kết quả Kiểm thử Hạ tầng & Vận hành trên Môi trường Giả lập AWS Local (`evidence/tv1-local-stack/`)

> **Phân biệt rõ môi trường (theo trang 8 & 10 kế hoạch):**
> Toàn bộ kết quả dưới đây là **chạy thật trên stack Docker local** (`PostgreSQL 17` + `LocalStack 4.4 S3/Lambda` + `Nginx stable-alpine` + `Spring Boot JAR` + `React /portal/ dist`). Trạng thái triển khai trên tài khoản AWS Cloud thật được ghi nhận trung thực là **`NOT_RUN`** (chờ tài khoản AWS Academy Learner Lab của nhóm chạy lệnh `.\deploy\deploy_aws.ps1`).

| Mã kiểm thử | Nội dung kiểm chứng | Kết quả (Local AWS Emulation) | Bằng chứng lưu tại |
| --- | --- | --- | --- |
| **Nginx & EB Routing (A04)** | `GET /` → `302 /portal/`; `GET /portal/` → `200 OK` (`Cache-Control: no-store`); `GET /api/v1/health` → `200 {"status":"UP"}`. | **PASS** | [`evidence/tv1-local-stack/00-summary.json`](../../evidence/tv1-local-stack/00-summary.json) |
| **K03 & K04 (S3 + Lambda SHA-256)** | Presigned PUT trực tiếp lên S3 với `content-type` và `if-none-match: *`, đọc `x-amz-version-id`, gọi `/complete`, S3 tự động kích hoạt Lambda `handover-checksum-local` tính SHA-256 ghi vào `results/...json`: file đúng hash → `VERIFIED`, file cố tình gửi sai `expectedSha256` → `MISMATCH`. | **PASS** | [`evidence/tv1-local-stack/00-summary.json`](../../evidence/tv1-local-stack/00-summary.json) |
| **K05 (Prefix `uploads/` & Idempotency)** | S3 Notification chỉ lọc prefix `uploads/` (ghi `results/` không kích hoạt lại Lambda). Gửi lặp lại cùng sự kiện S3 `ObjectCreated:Put` của `v1` → Lambda kiểm tra JSON hiện có qua `IfNoneMatch: *` (HTTP 412) và trả về `{"created": 0, "skipped": 1}`. | **PASS** | [`evidence/tv1-local-stack/01-localstack-bootstrap.json`](../../evidence/tv1-local-stack/01-localstack-bootstrap.json), [`00-summary.json`](../../evidence/tv1-local-stack/00-summary.json) |
| **K07 (Ghim đúng phiên bản `v1` khi có `v2`)** | Tạo `architecture-spec.pdf` `v1` (`VERIFIED`), sau đó tải lên `v2` (`VERIFIED`, `VersionId` khác). Tạo gói bàn giao ghim `v1`, phát hành `READY`, người nhận (`viewer@example.test`) tải file từ gói → nhận đúng nội dung và SHA-256 của `v1`, sau đó xác nhận `CONFIRMED`. | **PASS** | [`evidence/tv1-local-stack/00-summary.json`](../../evidence/tv1-local-stack/00-summary.json) |
| **K11 (Backup S3 → Restore DB tách biệt → Đối chiếu S3)** | `backup_db_to_s3.py` dump DB `handover` lên `s3://handover-backups-local/postgres/.../portal.dump` (`AES256`, có `VersionId`). `restore_db_from_s3.py` kiểm tra rollback nguyên tử trên DB `_rollback`, khôi phục vào DB đích mới `handover_s3restore_*_dst`, đối chiếu khớp **11/11 bảng** (số dòng + SHA-256 canonical), **18/18 khóa ngoại**, và đối chiếu tất cả bản ghi `AVAILABLE` với `head_object` + `results/` trên S3. | **PASS** | [`evidence/tv1-local-stack/02-s3-backup-manifest.json`](../../evidence/tv1-local-stack/02-s3-backup-manifest.json), [`evidence/tv1-local-stack/03-s3-restore/restore-report.md`](../../evidence/tv1-local-stack/03-s3-restore/restore-report.md) |
| **K12 (An toàn cấu hình & Không lộ secret)** | Cả 2 bucket S3 bật `BlockPublicAccess` (4 cờ `true`), mã hóa `AES256`, bucket policy chặn HTTP thường (`aws:SecureTransport=false`), RDS `PubliclyAccessible=false`. Không có mật khẩu, khóa AWS hay file `.dump` trong Git. | **PASS** | [`infra/cloudformation/00-storage.yaml`](../../infra/cloudformation/00-storage.yaml), [`01-rds-beanstalk-cloudfront.yaml`](../../infra/cloudformation/01-rds-beanstalk-cloudfront.yaml) |
| **K13 (Redeploy giữ nguyên DB & gói bàn giao)** | Khởi động lại `app.jar` trỏ vào database đã restore (`LOCAL_DEMO_PASSWORD=""`, không seed lại user), đăng nhập bằng tài khoản `viewer@example.test` đã phục hồi, truy vấn gói `CONFIRMED` và tải lại đúng file `v1` từ S3. | **PASS** | [`evidence/tv1-local-stack/00-summary.json`](../../evidence/tv1-local-stack/00-summary.json) |

---

## 3. Hướng dẫn cho AI hoặc Thành viên Nhóm khi Merge

1. **Merge nhánh của TV1 vào nhánh tích hợp `dung` (hoặc `main`):**
   ```powershell
   git checkout dung
   git pull origin dung
   git merge --no-ff origin/task/A01-A06-aws-infra-ops -m "Merge TV1 (Chien): AWS CloudFormation, EB/Lambda packaging, S3 backup/restore & local stack verification"
   git push origin dung
   ```
2. **Đưa toàn bộ dự án đã tích hợp từ `dung` lên `main` (khi khóa bản nộp cuối):**
   ```powershell
   git checkout main
   git merge --no-ff dung -m "Release final integrated project (TV1 + TV2 + TV3 + TV4) to main"
   git push origin main
   ```
3. **Chạy lại kiểm thử của TV1 bất kỳ lúc nào (chỉ cần Docker + Python + JDK 21+):**
   ```powershell
   docker compose -f infra/local/compose.yml up -d
   python ops/verify_tv1_local_stack.py
   ```
