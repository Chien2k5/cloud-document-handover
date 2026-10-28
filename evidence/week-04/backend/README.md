# Bằng chứng C06 local tuần 4

Ngày 29/10/2026, nhánh dung trên nền a44a78a + thay đổi tuần 4. Windows, Java Temurin 25 target 21, Maven Wrapper 3.9.12, PostgreSQL 17.9. DB fixture riêng `week4_junit_20261029` trong cluster 127.0.0.1:55434, không dùng DB chung/AWS.

- `mvnw.cmd -B -ntp verify`, RUN_DB_TESTS=true: **BUILD SUCCESS, 48 tests, 0 failures/errors/skipped**. Hoàn tất 01:04:30 UTC+07 ngày 29/10/2026.
- Phân bố: ActiveAccountFilterTest 3; BackendIntegrationTest 10; ContractTest 4; UploadIntegrationTest 13; HandoverIntegrationTest 18.
- Thêm 7 test methods C06, mở rộng phản ví dụ checksum bucket/key/time trong ca cũ. PostgreSQL transactions, constraint và HTTP/Tomcat thật; StoragePort fixture chỉ nằm trong test source.
- Không phát hiện lỗi production mới trong phạm vi kiểm tra. Không thay service/API/schema/config/dependency; giữ V1 nguyên vẹn.
- `junit-summary.txt` trích tên ca/count từ Surefire XML cuối, không properties/environment. `migration-and-run.txt` giữ dòng migration/run an toàn. `source-hashes.json` lưu source/test/config/tools/contracts, không hash báo cáo tự tham chiếu. Sau lượt restore, chỉ nội dung trình bày biên bản được làm rõ từ result JSON đã xác minh.

[Ma trận C06](../../../docs/week-04/c06-test-matrix.md) ánh xạ từng yêu cầu và ghi rõ AWS NOT RUN. [Bằng chứng restore](../local-restore/restore-report.md) thuộc script riêng: 11 bảng khớp, 18 FK validated, 51 HTTP request checks nguồn/đích. Không cộng test methods và request assertions thành số kịch bản độc lập.

Để chạy lại C06: đặt DB_URL/DB_USERNAME/DB_PASSWORD tới DB fixture riêng có thể xóa dữ liệu, bật RUN_DB_TESTS=true rồi Maven verify. Tests TRUNCATE bảng nghiệp vụ trước từng ca. Để chạy lại restore: đọc `docs/week-04/local-restore-runbook.md`; script chỉ tạo DB mới trên loopback, không nhận DB nguồn/đích có sẵn và không drop DB.

NOT RUN tuần 4: S3/Lambda thật, event AWS trùng/trễ/timeout, IAM/CORS/HTTPS, backup tới S3 và restore chung, browser E2E, đo URL S3 đã cấp trước revoke. Session expiry chờ thực có evidence lịch sử tuần 2, không chạy lại trong lần này. Không dùng các kết quả local để tuyên bố G4 nhóm đã đạt, S3 hard byte quota hoặc RTO/RPO production.
