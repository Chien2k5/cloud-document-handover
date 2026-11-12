# Báo cáo Tổng hợp Công việc TV1 (Hoàng Hải Chiến — Nhóm trưởng & AWS/Vận hành)

- **Thành viên:** Hoàng Hải Chiến (TV1 — Nhóm trưởng)
- **Phạm vi phụ trách theo [`PRINCIPLE.MD`](../../PRINCIPLE.MD) & Kế hoạch 5 tuần:** `infra/`, `deploy/`, `ops/`, Docker Compose giả lập AWS ở local, môi trường AWS, Elastic Beanstalk, IAM, PostgreSQL độc lập, backup/restore S3 và quản lý chi phí (Mã công việc **A01 – A06**, kiểm thử **K05, K07, K11, K12, K13**).
- **Nhánh hiện tại:** `review/chien-aws`. Nhánh `task/A01-A06-aws-infra-ops` là thông tin bàn giao lịch sử.
- **Giới hạn kết luận:** Các kết quả local lịch sử không chứng minh current HEAD, merge readiness hay AWS runtime. Xem [hiệu chỉnh F012](F012-claim-map.md) và [current state](../../evidence/tv1-local-stack/00-summary.json).

---

## 1. Bảng ánh xạ Mã công việc (A01 – A06) & Sản phẩm bàn giao (Tuần 1 – Tuần 5)

| Mã việc | Tuần | Nội dung công việc theo kế hoạch | File bàn giao trong Repo | Trạng thái kiểm chứng |
| --- | --- | --- | --- | --- |
| **A01** | T1–T2 | Đối chiếu inventory và lập dự toán demo personal account us-east-1; phân biệt Academy Lab, credit/budget chưa xác minh. Demo 48h khoảng $5.51, giữ 35 ngày khoảng $46.43 gross theo assumptions F013, chưa phải actual bill/cap. | [`ops/aws-lab-permissions-and-cost.md`](../../ops/aws-lab-permissions-and-cost.md) | **ESTIMATED (F013); account credit/budget UNVERIFIED** |
| **A02** | T1–T2 | Môi trường giả lập AWS ở local (`postgres:17` + `localstack:4.4` S3/Lambda + `nginx:stable-alpine` nạp trực tiếp cấu hình EB) và công cụ đóng gói bundle deploy (`eb-release.zip` + `lambda-checksum.zip` kèm manifest SHA-256). | [`infra/local/compose.yml`](../../infra/local/compose.yml), [`infra/local/bootstrap_localstack.py`](../../infra/local/bootstrap_localstack.py), [`deploy/build_eb_bundle.py`](../../deploy/build_eb_bundle.py), [`deploy/build_lambda_zip.py`](../../deploy/build_lambda_zip.py) | **HISTORICAL / PARTIAL; current E2E NOT_RUN** |
| **A03** | T1–T3, T5 | Cấu hình S3 Upload Bucket (private, `BlockPublicAccess`, Versioning `Enabled`, mã hóa `AES256`, CORS expose `x-amz-version-id`), sự kiện `s3:ObjectCreated:Put` chỉ trên prefix `uploads/` (không lặp vòng `results/`), và bộ IAM Policy quyền tối thiểu (hỗ trợ cả `LabRole` của Learner Lab và Custom Role). | [`infra/cloudformation/00-storage.yaml`](../../infra/cloudformation/00-storage.yaml), [`infra/iam/backend-instance-s3-policy.json`](../../infra/iam/backend-instance-s3-policy.json), [`infra/iam/lambda-checksum-s3-policy.json`](../../infra/iam/lambda-checksum-s3-policy.json), [`infra/config/s3-cors.json`](../../infra/config/s3-cors.json) | **HISTORICAL / PARTIAL; current E2E NOT_RUN** |
| **A04** | T1–T3, T5 | Cấu hình Elastic Beanstalk Corretto 21 trên AL2023 (`Procfile` với `-Duser.timezone=UTC`, Nginx `99_portal.conf` phục vụ `/portal/` tĩnh và proxy `/api/v1` về cổng `5000`), CloudFront viewer HTTPS bằng default certificate (`*.cloudfront.net` cùng origin; usage/transfer vẫn có thể tính phí), RDS PostgreSQL 17 độc lập (`PubliclyAccessible=false`), và script deploy/redeploy giữ nguyên DB. | [`infra/cloudformation/01-rds-beanstalk-cloudfront.yaml`](../../infra/cloudformation/01-rds-beanstalk-cloudfront.yaml), [`deploy/eb/Procfile`](../../deploy/eb/Procfile), [`deploy/eb/.platform/nginx/conf.d/elasticbeanstalk/99_portal.conf`](../../deploy/eb/.platform/nginx/conf.d/elasticbeanstalk/99_portal.conf), [`deploy/deploy_aws.ps1`](../../deploy/deploy_aws.ps1), [`deploy/redeploy_aws.ps1`](../../deploy/redeploy_aws.ps1) | **HISTORICAL / PARTIAL; current E2E NOT_RUN** |
| **A05** | T2–T5 | CloudWatch Logs (Lambda/EB retention 14 ngày; RDS export retention chưa pin), 5 CloudWatch Alarms (`Lambda Errors/Throttles/Duration`, `RDS FreeStorageSpace/DatabaseConnections`), S3 Backup Bucket tách quyền (`postgres/`), script sao lưu `pg_dump` lên S3 (`AES256` + `VersionId`) và script restore vào DB đích tách biệt kèm kiểm tra rollback nguyên tử & đối chiếu S3 Version ID. | [`ops/backup_db_to_s3.py`](../../ops/backup_db_to_s3.py), [`ops/restore_db_from_s3.py`](../../ops/restore_db_from_s3.py), [`infra/iam/backup-operator-s3-policy.json`](../../infra/iam/backup-operator-s3-policy.json) | **HISTORICAL / PARTIAL; current E2E NOT_RUN** |
| **A06** | T4–T5 | Kiểm thử toàn luồng hạ tầng & phục hồi dữ liệu (`verify_tv1_local_stack.py`), rà soát không lộ secret trong repo/log/evidence, lập kế hoạch dọn tài nguyên sau đánh giá và tổng hợp báo cáo để merge. | [`ops/verify_tv1_local_stack.py`](../../ops/verify_tv1_local_stack.py), [`evidence/tv1-local-stack/`](../../evidence/tv1-local-stack/), [`ops/aws-lab-permissions-and-cost.md`](../../ops/aws-lab-permissions-and-cost.md) | **HISTORICAL / PARTIAL; current E2E NOT_RUN** |

---

## 2. Hiệu chỉnh phạm vi evidence (F012)

**Current LocalStack E2E: NOT_RUN. AWS E2E (V001): NOT_RUN.** Không dùng
PASS của bản summary trước F012 như trạng thái lần chạy hiện tại. Các con số
11 bảng/18 FK và trạng thái PASS trong manifest/report cũ là kết quả lịch sử,
thiếu source-byte provenance; không có kết luận evidence bị giả mạo.

[Claim-to-assertion mapping đầy đủ](F012-claim-map.md) ghi original wording,
source, command, assertion, evidence, giới hạn và trạng thái hiệu chỉnh.
[Bản summary gốc được lưu](../../evidence/tv1-local-stack/historical/pre-f012/00-summary.json);
[historical index](../../evidence/tv1-local-stack/historical-index.json) không
backfill source hashes cho lần chạy cũ.

| Nhóm | Claim runner mới có thể chứng minh khi thực thi | Không suy ra |
|---|---|---|
| Nginx | HTTP redirect, GET index chứa asset reference + no-store, API health UP | Tải JS/CSS, browser rendering |
| K03/K04 | Python upload/complete quan sát Version ID; VERIFIED/MISMATCH theo assertion | Browser CORS, AWS runtime |
| K05 | Một duplicate invocation trả created=0, skipped=1 | Không có notification loop trong mọi tình huống |
| K07 | Tạo gói sau v2 rồi chọn/tải đúng bytes v1 | Gói đã phát hành giữ nguyên khi upload v2 sau đó |
| K11 | Restore report + 11 tables/18 FK/rollback/reference preservation | Mọi file đều VERIFIED; current source đã chạy E2E |
| K12 | Các nhánh IAM, bucket policy, secret scan: NOT_RUN trong runner này | Security verification PASS |
| K13 | Restart cùng JAR trên DB restore, login/confirmed/download v1 | Deploy/redeploy script hoặc application-version update |

RUNNING được ghi trước setup; FAIL được ghi khi exception/cleanup lỗi và lỗi
được truyền ra ngoài. Mỗi run có UUID, timestamp, HEAD/dirty status, hashes source
và artifacts, tool versions và assertions. Overall PARTIAL không được coi là PASS;
exit 0 chỉ có nghĩa các kiểm tra đã chạy không lỗi, không phải full acceptance.

F012 trước đây chưa thẩm định chi phí/Lab; F013 hiện đã hiệu chỉnh tài liệu
[demo/cost/cleanup](../../ops/aws-lab-permissions-and-cost.md). Public rates được
kiểm ngày 2026-11-12, usage là ESTIMATED, credit/Free Tier/budget vẫn UNVERIFIED.
Đích AWS là personal account, không tự áp dụng hạn chế Learner Lab. F010 giữ FIXED_LOCAL_PENDING_AWS_VERIFICATION;
F005/F006 giữ BLOCKED.

---

## 3. Hướng dẫn tích hợp lịch sử (không phải thao tác đã được thực hiện)

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
3. **Chạy LocalStack E2E riêng khi đã có dependencies và build artifacts:**
   ```powershell
   # Cần boto3, JAR, frontend dist, Java, local Docker và các image đã có sẵn.
   # Runner tạo tài nguyên disposable riêng; không dùng DB/shared compose để thử.
   python ops/verify_tv1_local_stack.py
   ```
