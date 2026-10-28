# Bàn giao kỹ thuật backend của Dũng

Ngày 29/10/2026. Bản bàn giao gồm backend Spring Boot/PostgreSQL, hợp đồng StoragePort/OpenAPI, kiểm thử và evidence local. C07 được kiểm chứng ở backend; nghiệm thu Cloud của nhóm còn chờ adapter S3/Lambda, môi trường AWS và UI. Không có phê duyệt Nam/Đăng/Chiến được tự ghi nhận.

## Thành phần và dữ liệu

- Java target 21, Maven Wrapper 3.9.12, Spring Boot 3.5.16 theo pom; đã chạy Java 25/PostgreSQL 17.9.
- `auth/`: session/CSRF, BCrypt, kiểm enabled-account ở request được bảo vệ; local seed tùy chọn.
- `project/`: Project/Membership, Owner/Editor/Viewer, quota counter và audit transaction.
- `upload/`: FileMetadata/FileVersion/UploadSession, reserve/complete/expire quota, integrity và StoragePort.
- `handover/`: DRAFT/READY/CONFIRMED, người nhận trong/ngoài dự án, download version đã chốt, revoke/audit.
- Flyway V1 tạo 10 bảng nghiệp vụ; Flyway giữ bảng schema history riêng. Không sửa V1 hoặc thêm migration trong các lần tuần 2–5.
- `contracts/openapi.yaml` 0.4.0-week3-backend có 22 operations implemented ở backend. Version này giữ nguyên vì tuần 4/5 không đổi API. Ví dụ JSON là minh họa, không có signed URL hoạt động.

## Dựng và chạy lại

1. Giải nén bundle hoặc checkout commit nhánh dung. Vào `backend`.
2. Tạo role LOGIN và DB riêng theo backend/README.md. Đặt DB_URL, DB_USERNAME, DB_PASSWORD bằng môi trường terminal/IDE; Spring Boot không tự đọc `.env`.
3. `mvnw.cmd -B -ntp verify` trên Windows, `sh mvnw -B -ntp verify` trên Linux/macOS. Mặc định unit/contract chạy, DB suites SKIPPED. Kết quả này không phải PASS PostgreSQL.
4. Chạy JAR hoặc `mvnw.cmd spring-boot:run`. Health kiểm SELECT 1. Không có DB/migration hợp lệ thì startup thất bại.
5. Local HTTP đặt SPRING_PROFILES_ACTIVE=local; LOCAL_DEMO_PASSWORD tùy chọn, tối thiểu 12 ký tự, không có mật khẩu mặc định. Ngoài local, cookie Secure mặc định true và cần HTTPS.
6. Lấy GET /api/v1/auth/csrf → POST form-urlencoded /auth/login với cùng cookie → lấy CSRF mới → gọi API JSON. POST cần X-CSRF-TOKEN; logout cũng vậy. Nam dùng proxy cùng origin và credentials include.

## Cấu hình backend

| Biến | Ý nghĩa/mặc định trong code |
| --- | --- |
| DB_URL / DB_USERNAME / DB_PASSWORD | Bắt buộc; không commit giá trị thật |
| SERVER_PORT | 8080 |
| SPRING_PROFILES_ACTIVE | local chỉ cho máy thử; không bật seed trên AWS |
| SESSION_COOKIE_SECURE | true ngoài local; false trong profile local |
| LOCAL_DEMO_PASSWORD | Rỗng thì không seed; seed không reset tài khoản cũ |
| PROJECT_QUOTA_BYTES | 1073741824, phải dương |
| UPLOAD_BUCKET | Rỗng thì storage init trả 503 |
| UPLOAD_TTL_SECONDS | 300; chỉ 1..300 |
| UPLOAD_EXPIRY_DELAY_MS | 30000; job expiry bounded |

Giới hạn file 100 MiB và quota/TTL ở trên là giá trị triển khai hiện tại, không phải bằng chứng nhóm đã đo/chốt trên AWS. Các biến Nextcloud/PORTAL_DATABASE_URL cũ trong root .env.example không được backend này sử dụng. Tham khảo backend/.env.example để cấu hình.

## Ghép StoragePort và UI

Đăng cung cấp bean triển khai bốn operation: presignPut, headVersion, readChecksum, presignGet. Đầu vào bucket/key do backend quản lý, versionId opaque phải giữ nguyên. Không HEAD latest. PUT signer trả signed Content-Type và If-None-Match: *, URL HTTPS còn hạn; adapter thiếu điều kiện thì fail closed. HEAD phải phản ánh đúng ref/size/type/delete marker, Missing khác timeout/AccessDenied/5xx. Đọc JSON tối đa 64 KiB và timeout hữu hạn. Chi tiết result-key/schema ở contracts/s3-adapter-contract.md.

Nam review fileId/no-rename, init không idempotent, retry, signed headers, Version ID và polling. AVAILABLE không đồng nghĩa VERIFIED. DRAFT có thể chờ integrity nhưng publish chỉ cho AVAILABLE + VERIFIED còn truy xuất được. Người nhận ACTIVE chỉ xem/tải gói phát hành còn hạn/chưa revoke; quyền gói không cấp quyền project. Confirm là xác nhận trong ứng dụng, không phải chữ ký số.

Chiến cấu hình Versioning, IAM/CORS, event uploads/results, HTTPS/DB, policy/cleanup và chi phí, triển khai bản nhóm đã duyệt. Backend quota logic không chứng minh hard quota byte S3, giải phóng reservation không xóa object. Conditional PUT và URL đã cấp sau revoke cần đo thật cùng Đăng/Nam.

## Kiểm thử và phục hồi

- Full suite: DB_URL tới **DB thử có thể xóa dữ liệu**, RUN_DB_TESTS=true rồi Maven verify. Tests TRUNCATE bảng nghiệp vụ. Đọc evidence/week-05/backend cho kết quả bản chốt.
- HTTP JAR: run_http_smoke.py với DB fixture trống; CHECK_WEEK2_UPLOAD=true/UPLOAD_BUCKET=fixture-bucket chỉ khi ứng dụng chưa có adapter vì suite này mong storage 503. run_phase1_http_regression.py dùng DB khác và psql, có chờ session expiry thật.
- Restore: run_local_restore_check.py với --pg-bin/--host loopback/--port/--user có CREATEDB và PGPASSWORD trong môi trường. Dùng --evidence-dir evidence/week-05/local-restore. Script tạo hai DB mới, không drop DB, target không seed, so mọi bảng/hash/FK/quota/manifest/timestamps và HTTP. Đọc runbook tuần 4.

Storage fake chỉ ở test source. Không dùng fixture để demo S3/Lambda đã chạy. Archive dump có password hashes nằm trong runtime-data bị ignore; không đưa vào Git hoặc bundle.

## Đóng gói và đối chiếu

Sau khi commit, từ root chạy `python backend/tools/build_handover_bundle.py`. Tool yêu cầu tracked working tree sạch và không có scoped untracked files; các tài liệu TV3 cũ ngoài whitelist được giữ nguyên.

Đầu ra output/backend-handover-dung.zip và sidecar .manifest.json. Trong ZIP có BUNDLE-MANIFEST.json: commit, file count, size/SHA-256 từng tệp. Tool kiểm CRC và đọc lại từng entry để so hash, giữ executable bit cho mvnw. Whitelist chỉ source/backend/tools/contracts/docs/evidence đã chọn, không symlink, runtime, .env thật, dump, JAR/dependency hoặc chữ ký sống. Regex scan hỗ trợ review, không chứng minh tuyệt đối mọi dạng secret.

Giải nén ZIP, vào thư mục backend trong gói và chạy Maven verify theo README. Dependency phải tải/cache được; khi chưa cấu hình DB test, integration suites sẽ SKIPPED. Cần full PostgreSQL suite riêng để kiểm nghiệp vụ. ZIP này là phần Dũng bàn giao, không chứa frontend/Lambda/hạ tầng chưa được cung cấp.

## Giới hạn và nghiệm thu còn lại

Chưa registration/invitation/reset password, session lưu bền/chia sẻ nhiều instance, rate limiting, CORS nhiều origin, sửa draft, list gói, quản trị revoke từng recipient hoặc UI nâng cao. Audit tối thiểu ở DB; không có API/UI audit mới. Chưa đo AWS hard quota/cleanup, RTO/RPO/HA, thu hồi ngay URL đã cấp hoặc tải phiên bản sau restore Cloud.

Source branches được kiểm tra trên GitHub ngày 29/10: dung, main và task/B01-nextcloud-local. Nhánh B01 chứa Nextcloud cũ, không có adapter S3/Lambda/React mới; infra/deploy/ops README đang trống. Checklist tuần 5 ghi các đầu vào cần nhóm cung cấp. Không tự merge main, deploy AWS, đánh dấu phê duyệt, hoặc xác nhận G2–G5 Cloud từ bằng chứng local.
