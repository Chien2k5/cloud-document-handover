# Bằng chứng backend tuần 2

Lần làm việc ngày 28/10/2026, nhánh dung, nền ef79ee3 + thay đổi local trước commit. Windows, Java Temurin 25 target 21, Maven Wrapper 3.9.12, PostgreSQL 17.9. PostgreSQL fixture riêng chỉ bind 127.0.0.1:55434 trong runtime-data bị ignore; không dùng DB chung, secret hoặc tài nguyên AWS.

| Suite | Kết quả | Phạm vi |
| --- | --- | --- |
| `mvnw.cmd -B -ntp verify`, RUN_DB_TESTS=true | BUILD SUCCESS, 29/29, 0 failures/errors/skipped | 3 filter unit, 10 PostgreSQL nền tảng, 4 contract, 12 upload integration |
| UploadIntegrationTest HTTP TCP | PASS trong 12 test upload | Tomcat random port, cookie/CSRF, init/complete/state/list/download, kiểm schema phản hồi OpenAPI; fake storage ở test source |
| JAR `tools/run_http_smoke.py`, CHECK_WEEK2_UPLOAD=true | 48/48 HTTP request checks PASS | Auth/quyền/baseline + không có adapter S3 trả 503, FAILED và bù quota, chặn download |
| JAR `tools/run_phase1_http_regression.py` | 70/70 HTTP request checks PASS | Strict JSON, 415/406, disabled account, public/logout, session expiry thật |
| S3 PUT/HEAD/GET, Lambda, conditional PUT, IAM/CORS, browser AWS | NOT RUN | Chưa có adapter và môi trường chung được xác nhận |

Tổng 118 checks của hai script JAR là số request assertions, không phải 118 kịch bản độc lập. Không cộng số request nội bộ JUnit vào tổng này. Bộ JAR chạy trước các bổ sung test schema/phối hợp polling cuối; mã nghiệp vụ/config chạy không đổi giữa các lần đó. Lần verify cuối đạt lúc 23:58:54 UTC+07 ngày 28/10/2026.

## Môi trường thử và lệnh tái hiện

- DB fixture riêng: week2_junit_20261028, week2_final_20261028, week2_http_20261028, week2_regression_20261028. JUnit TRUNCATE dữ liệu nghiệp vụ trước từng ca; chỉ được dùng DB thử.
- Đặt DB_URL/DB_USERNAME/DB_PASSWORD tới DB fixture rồi chạy `mvnw.cmd -B -ntp verify` với RUN_DB_TESTS=true. Log raw/Surefire properties được giữ trong target bị ignore, không đưa vào evidence.
- Smoke dùng DB fixture trống riêng, SMOKE_PORT=18084, UPLOAD_BUCKET=fixture-bucket, CHECK_WEEK2_UPLOAD=true. Không có AWS SDK adapter; bucket chỉ là chuỗi fixture để thử bù quota khi signer không sẵn sàng.
- Regression dùng DB fixture trống khác, PHASE1_SMOKE_PORT=18085, SMOKE_PSQL trỏ psql. Script disable/re-enable tài khoản bằng SQL chỉ trên fixture. Session JAR test 60 giây, chờ 65 giây; cấu hình ứng dụng vẫn 30 phút.
- Password demo tạo ngẫu nhiên trong bộ nhớ; không lưu token/cookie/password/URL có chữ ký vào các tệp minh chứng. Script tự dừng JAR.

## Tệp chứng minh

- `junit-summary.txt`: chỉ tên suite/test và PASS/FAIL/count, trích từ Surefire XML cuối, không properties/environment.
- `http-smoke.txt`, `http-regression.txt`: chỉ status và tổng kiểm tra an toàn.
- `migration-startup.txt`: chọn dòng Flyway/startup từ JAR chạy với DB trống, không raw log.
- `source-hashes.json`: hash source/test/tool/contract hiện tại. Không hash báo cáo tự tham chiếu, không dùng hash snapshot ngày 22/10 để chứng minh code mới.

Các test upload chứng minh transaction PostgreSQL thật: 8 init đồng thời chỉ 5 thành công dưới quota 50 byte; 6 complete đồng thời chỉ tăng used/audit một lần; expiry trong lúc HEAD không phục hồi phiên; lỗi DB rollback metadata/reservation; polling sai/trễ không ghi đè VERIFIED. Storage fixture cấp HEAD/checksum/URL `.invalid` có kiểm soát; không có byte upload S3 hoặc thực thi Lambda trong các test này.

Những lần chạy ban đầu phát hiện lỗi optional fileId và độ chính xác deadline đã được sửa. Khi thêm schema assertion, email fixture được đổi sang domain example.com được validator chấp nhận. Kết quả trong bảng chỉ là lần chạy đạt cuối, không dùng BUILD FAILURE làm PASS. Chưa kiểm dừng DB thật trong lúc account lookup, chỉ có unit test fail closed như Phase 1.

Nghiệm thu G2 chung vẫn chờ Đăng/Chiến/Nam ghép AWS. Không tuyên bố hard quota byte S3, quyền AWS hoặc conditional-write enforcement từ quota logic và fake signer.
