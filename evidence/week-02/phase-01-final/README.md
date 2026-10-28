# Evidence kiểm tra cuối Phase 1

Ngày 22/10/2026, Windows, branch dung, base ef79ee3 + working tree chưa commit. Java Temurin 25 target 21, Maven Wrapper 3.9.12, PostgreSQL 17.9. Đây là lần chạy sau khi sửa ngoại lệ public/logout của ActiveAccountFilter; evidence trong `../phase-01/` là snapshot cũ được giữ để đối chiếu.

## Lần chạy và giới hạn

- `mvnw.cmd -B -ntp verify`, `RUN_DB_TESTS=true`: BUILD SUCCESS; 17 test, 0 failures/errors/skipped. 3 unit filter + 10 PostgreSQL integration + 4 contract tests. Tên test và kết quả trích từ Surefire XML vào `junit-summary.txt`; không lưu raw properties/environment chứa dữ liệu nhạy cảm.
- `python -u tools/run_http_smoke.py`: 41 HTTP request checks PASS.
- `python -u tools/run_phase1_http_regression.py`: 70 HTTP request checks PASS. Timeout servlet chỉ ở JAR test là 60 giây; chờ thực 65 giây không gửi request. Sau đó GET me 401, POST với CSRF cũ 403, lấy public CSRF mới 200 và logout 204. Không đổi timeout mặc định 30 phút của ứng dụng.
- Tổng 111 HTTP checks là số request assertions của hai script, không phải 111 kịch bản độc lập. Các thao tác account SQL chỉ trên fixture tạo ngẫu nhiên; mật khẩu/cookie/token không được in/lưu vào evidence.
- Mỗi suite dùng DB rỗng riêng: finalize_junit_20261022, finalize_baseline_20261022, finalize_http_20261022 trong cluster thử 127.0.0.1:55433. Các script tự dừng JAR; PostgreSQL fixture được dừng sau kiểm thử. Không dùng dữ liệu hoặc credential AWS.
- `migration-startup.txt`: chỉ các dòng Flyway/startup được chọn; V1 giữ nguyên. `source-hashes.json`: hash source/test/script/contract và JAR đã thử, không đưa binary JAR vào Git. Không hash chính file hash hoặc mọi báo cáo tự tham chiếu.
- `review-checks.json`: file counts, scope deserializer, Git/migration, ignore checks và scan theo mẫu secret. Scan chỉ hỗ trợ rà soát; đã đọc diff/tệp ứng viên, không coi regex là chứng minh tuyệt đối không có mọi loại secret.

## Phạm vi được và chưa được xác minh

HTTP thật: strict JSON/null/unknown field, 415/406, disable read/write hai session, login disabled bị chặn, public CSRF/login/logout không bị principal disabled chặn, session đã hủy không hồi sinh sau re-enable, session hết hạn thật và logout với token mới. Unit mock repository xác minh outage fail closed và public endpoint bỏ qua lookup; **chưa dừng DB thật để thử outage**.

OpenAPI parser resolve và schema/example/negative tests PASS; upload vẫn contract-only. NOT RUN: UploadSession/quota concurrency/UploadService, S3 signing/PUT/conditional PUT/HEAD/download, Lambda checksum, IAM/CORS/HTTPS và UI thật. Không dùng các kết quả trên để tuyên bố AWS PASS hoặc Phase 2 đã triển khai.
