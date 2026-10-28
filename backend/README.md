# Backend lưu trữ và bàn giao tài liệu

Backend của Dũng: một ứng dụng Spring Boot 3.5.16, Maven Wrapper 3.9.12, PostgreSQL/Flyway, Spring Security session/CSRF, API Project/Membership, UploadService và HandoverService. Java target 21; kiểm thử bằng Java 25 và PostgreSQL 17. Chưa có S3 SDK adapter, Lambda hoặc frontend. StoragePort là ranh giới để Đăng tích hợp; mặc định trả 503 khi storage chưa sẵn sàng.

Cập nhật tuần 2 phase 1: Project JSON không ép số/boolean thành string, explicit null bị 400 (description bỏ qua vẫn thành chuỗi rỗng); Content-Type sai trả 415, Accept không hỗ trợ trả 406. Account disabled/xóa bị 401 ACCOUNT_DISABLED và hủy session ở request tiếp theo; DB lookup account lỗi trả 503 AUTH_UNAVAILABLE, không cấp quyền mặc định. Không có migration mới hoặc admin UI. Xem [quyết định upload/version và review gates](../docs/week-02/phase-01-upload-contract.md).

## Chuẩn bị PostgreSQL

Cần JDK 21–25, kết nối Maven Central ở lần build đầu, PostgreSQL 17 (đã thử). Docker không bắt buộc. Không tạo/sửa DB đang có của người khác. Tạo role/database riêng bằng tài khoản PostgreSQL quản trị trong `psql`:

```sql
CREATE ROLE handover LOGIN;
\password handover
CREATE DATABASE handover OWNER handover;
```

Lệnh `\password` hỏi mật khẩu tương tác, không đưa mật khẩu vào SQL hoặc lịch sử Git. Database trống; Flyway tạo schema lúc startup. Local app dùng role riêng ở trên, không dùng PostgreSQL superuser trong môi trường chung. Chiến chốt TLS/quyền DB/runtime cho AWS; nhánh này không sửa tài nguyên AWS.

## Cấu hình và chạy bằng PowerShell

Chạy lệnh từ thư mục `backend`. `.env.example` liệt kê tên biến; **Spring Boot không tự đọc file `.env`**, cần export env bằng terminal/IDE hoặc công cụ cấu hình của nhóm. Không commit bản `.env` thật.

```powershell
$env:DB_URL='jdbc:postgresql://127.0.0.1:5432/handover'
$env:DB_USERNAME='handover'
$dbPasswordInput = Read-Host 'Database password' -AsSecureString
$env:DB_PASSWORD = [System.Net.NetworkCredential]::new('', $dbPasswordInput).Password
$env:SPRING_PROFILES_ACTIVE='local'
$env:SERVER_PORT='8080'
.\mvnw.cmd spring-boot:run
```

Linux/macOS dùng `export DB_URL=...`, `DB_USERNAME`, `DB_PASSWORD`, `SPRING_PROFILES_ACTIVE=local` và `sh mvnw spring-boot:run`. Không đưa giá trị secret thật vào tài liệu/lệnh được chia sẻ. Profile local cho phép cookie trên HTTP; mặc định ngoài local dùng Secure cookie và cần HTTPS.

Tạo 4 tài khoản demo là tùy chọn: trước khi start local, đặt `LOCAL_DEMO_PASSWORD` bằng giá trị bạn tự chọn, ít nhất 12 ký tự và tối đa 72 byte UTF-8. Không có mật khẩu mặc định. Tài khoản: `dung@example.test`, `editor@example.test`, `viewer@example.test`, `outsider@example.test`. Seed chỉ thêm user còn thiếu, không reset mật khẩu cũ, không tạo tài khoản khi biến rỗng hoặc khi không có profile local. Không bật local seed trên AWS. Tạo project/membership qua API; lấy UUID user từ `/auth/me` sau khi đăng nhập từng tài khoản hoặc truy vấn DB local để thử.

```powershell
$demoPasswordInput = Read-Host 'Local demo password (optional)' -AsSecureString
$env:LOCAL_DEMO_PASSWORD = [System.Net.NetworkCredential]::new('', $demoPasswordInput).Password
.\mvnw.cmd spring-boot:run
```

Health `GET http://localhost:8080/api/v1/health` kiểm tra `SELECT 1`; UP=200, DB lỗi=503. Không xuất credential/chi tiết database. Startup không có DB hoặc migration sai sẽ thất bại.

## Login và smoke bằng PowerShell

Mở terminal khác khi backend đang chạy. Form login sử dụng **application/x-www-form-urlencoded**, còn API nghiệp vụ dùng JSON. Không gửi JSON vào login. Cookie được giữ trong `$portalSession`; mọi request thay đổi phải gửi masked CSRF token.

```powershell
$base='http://localhost:8080/api/v1'
$csrf=Invoke-RestMethod "$base/auth/csrf" -SessionVariable portalSession
$portalCredential=Get-Credential -UserName 'dung@example.test'
$loginBody=@{email=$portalCredential.UserName; password=$portalCredential.GetNetworkCredential().Password}
$me=Invoke-RestMethod "$base/auth/login" -Method Post -WebSession $portalSession -Headers @{'X-CSRF-TOKEN'=$csrf.token} -ContentType 'application/x-www-form-urlencoded' -Body $loginBody
$csrf=Invoke-RestMethod "$base/auth/csrf" -WebSession $portalSession
$project=Invoke-RestMethod "$base/projects" -Method Post -WebSession $portalSession -Headers @{'X-CSRF-TOKEN'=$csrf.token} -ContentType 'application/json' -Body '{"name":"Du an thu nghiem","description":"Week 1"}'
Invoke-RestMethod "$base/projects/$($project.id)" -WebSession $portalSession
Invoke-RestMethod "$base/projects?page=0&size=20" -WebSession $portalSession
Invoke-RestMethod "$base/auth/logout" -Method Post -WebSession $portalSession -Headers @{'X-CSRF-TOKEN'=$csrf.token}
```

Lấy lại `/auth/csrf` sau login/logout vì Spring Security xoay token. Không ghi token/cookie/password vào minh chứng. React dùng proxy cùng origin tới backend và `credentials:'include'`; CORS nhiều origin chưa triển khai. Cookie Secure phải bật khi HTTPS; không đặt `SESSION_COOKIE_SECURE=false` trên AWS.

## API đã có

| Method | Endpoint dưới `/api/v1` | Ý nghĩa |
| --- | --- | --- |
| GET | /health | DB readiness |
| GET | /auth/csrf | Token CSRF |
| POST | /auth/login | Form login, trả user và session cookie |
| GET | /auth/me | Tài khoản hiện tại |
| POST | /auth/logout | Hủy session, 204 |
| POST | /projects | Tạo project và Owner trong transaction, 201 |
| GET | /projects | List project có membership, page/size |
| GET | /projects/{id} | Xem project theo membership |
| GET | /projects/{id}/members | Danh sách userId/displayName/role |
| PUT | /projects/{id}/members/{userId} | Owner gán EDITOR/VIEWER cho user có sẵn |
| DELETE | /projects/{id}/members/{userId} | Owner gỡ Editor/Viewer, 204 |

Các API upload và handover đã triển khai. Caller ngoài project nhận 404 khi truy cập project/file. Người nhận được chỉ định có quyền riêng trên gói bàn giao, không có quyền xem project. Không có session nhận 401; CSRF thiếu/sai có thể bị 403 trước. Role được đọc từ Membership hiện tại, không nằm trong request hoặc quyền global.

| Method | Endpoint dưới `/api/v1` | Ý nghĩa |
| --- | --- | --- |
| POST | /projects/{id}/files/uploads | Owner/Editor tạo session và giữ quota; cần storage signer thật để trả 201 |
| POST | /projects/{id}/files/uploads/{uploadId}/complete | Người khởi tạo còn quyền ghi; HEAD đúng version trước AVAILABLE |
| GET | /projects/{id}/files/uploads/{uploadId} | Thành viên xem trạng thái; đối soát checksum của version AVAILABLE |
| GET | /projects/{id}/files | Một item mỗi version; page/size, thứ tự created_at/id |
| GET | /projects/{id}/files/{fileVersionId}/download | AVAILABLE + VERIFIED, kiểm HEAD rồi ký GET đúng version |

`UPLOAD_BUCKET` không có giá trị mặc định; chưa cấu hình trả 503. `UPLOAD_TTL_SECONDS` mặc định 300, chỉ cho 1..300; `UPLOAD_EXPIRY_DELAY_MS` mặc định 30000. Init không idempotent; fileId bỏ qua tạo tài liệu mới, có fileId thêm version và giữ filename. Quota logic tính used của mọi version đã hoàn tất + reserved của PENDING. Expiry scheduler giới hạn 20 project x 100 session/lượt, cùng khóa project với init/complete. V1 được giữ nguyên; không có migration mới.

Đăng cung cấp bean `StoragePort` theo `../contracts/s3-adapter-contract.md`; nhánh này không chứa AWS SDK implementation. Signer PUT phải trả signed Content-Type và If-None-Match: *, URL HTTPS và hạn không vượt session; backend không tự chứng minh AWS đã enforce header. HEAD/GET luôn nhận exact bucket/key/versionId, không latest. Đọc checksum giới hạn 64 KiB và timeout hữu hạn ở adapter; schema/identity được backend kiểm lại. Không đưa fake vào profile local/AWS. Hướng dẫn và câu hỏi phối hợp ở `../docs/week-02/team-integration-questions.md`.

## API bàn giao tuần 3

Tuần 3 có thêm:

| Method | Endpoint dưới `/api/v1` | Ý nghĩa |
| --- | --- | --- |
| POST | /projects/{id}/handovers | Owner tạo DRAFT với phiên bản AVAILABLE và người nhận hiện có |
| GET | /handovers/{handoverId} | Owner xem lịch sử; người nhận xem gói phát hành còn quyền |
| POST | /handovers/{handoverId}/publish | Owner phát hành, chỉ AVAILABLE + VERIFIED và exact HEAD hợp lệ |
| POST | /handovers/{handoverId}/confirm | Người nhận xác nhận chính mình; không body |
| GET | /handovers/{handoverId}/items/{fileVersionId}/download | Đúng item, đúng version, URL không vượt hạn gói/300 giây |
| POST | /handovers/{handoverId}/revoke | Owner thu hồi cơ bản, giữ lịch sử; không body |

Publish cũng không nhận body. Tạo gói cần title, fileVersionIds/recipientUserIds không rỗng và không lặp, expiresAt là chuỗi ISO có timezone trong tương lai. Không có API sửa manifest/recipient. Đọc [hướng dẫn tuần 3](../docs/week-03/huong-dan-cho-dung.md) để tự kiểm và lấy đầu vào ghép nhóm. Các thay đổi dùng bảng V1 hiện có, không thêm migration/config/dependency.

## Build và test

Tuần 4: bộ hồi quy hiện có 48 JUnit khi RUN_DB_TESTS=true, gồm 7 ca C06 mới. [Ma trận](../docs/week-04/c06-test-matrix.md) ánh xạ yêu cầu/ca lỗi tới test; [bằng chứng](../evidence/week-04/backend/README.md) ghi lần chạy hiện tại. Các kết quả tuần 2/3 bên dưới là lịch sử.

Backup/restore local chạy bằng `python tools/run_local_restore_check.py --pg-bin '<thu muc PostgreSQL bin>' --host 127.0.0.1 --port 5432 --user <role local co CREATEDB>`, dùng PGPASSWORD trong môi trường. Script tự tạo hai DB mới, khởi động JAR, dump/restore và đối chiếu dữ liệu/API; không cần AWS. Đọc [runbook](../docs/week-04/local-restore-runbook.md) trước khi chạy. Archive/raw log chỉ ở runtime-data bị ignore, evidence ở evidence/week-04/local-restore. Không chạy công cụ này như backup production hoặc đưa archive có password hashes vào Git.

```powershell
.\mvnw.cmd -B -ntp verify
```

Lệnh trên build JAR và chạy contract tests (OpenAPI parser, schema và ví dụ JSON), integration tests mặc định SKIPPED. Không gọi đó là PASS PostgreSQL. Để chạy tất cả, tạo **database thử riêng, trống và có thể xóa dữ liệu**, ví dụ `handover_test` với owner `handover`:

```sql
CREATE DATABASE handover_test OWNER handover;
```

```powershell
$env:DB_URL='jdbc:postgresql://127.0.0.1:5432/handover_test'
$env:RUN_DB_TESTS='true'
.\mvnw.cmd -B -ntp verify
Remove-Item Env:RUN_DB_TESTS
```

DB_USERNAME/DB_PASSWORD vẫn phải được cấu hình. Tests TRUNCATE bảng nghiệp vụ trong DB_URL trước từng ca; **không dùng DB chung hoặc có dữ liệu thật**. Mỗi bộ có thể chạy lại trên DB test đã migrate; để xác minh từ trống lần nữa, tạo một DB thử mới. Không bật Flyway clean hoặc baseline để che lỗi. Hướng dẫn này không yêu cầu Docker/Testcontainers.

Integration tests kiểm migration thật, constraint/FK, auth đúng/sai/CSRF/logout, hai dự án cách ly, role Owner/Editor/Viewer, gỡ member có hiệu lực ngay, validation và route chưa triển khai. MockMvc chạy toàn bộ Spring context với PostgreSQL thật; smoke HTTP riêng kiểm tra JAR/Tomcat/session trên TCP. Kết quả cụ thể ở `../evidence/week-01/README.md`.

JAR: `target/document-handover-0.1.0-SNAPSHOT.jar`; chạy `java -jar target/document-handover-0.1.0-SNAPSHOT.jar` với cùng env. Dừng bằng Ctrl+C; tự dừng DB thử nếu bạn đã tự khởi tạo. `target/`, `.env`, `runtime-data/` bị Git bỏ qua.

Smoke HTTP tự động (cần Python 3, chỉ standard library): tạo **một DB thử trống khác**, đặt DB_URL/DB_USERNAME/DB_PASSWORD tới đó rồi chạy `python tools/run_http_smoke.py`. Script tự tạo mật khẩu ngẫu nhiên trong bộ nhớ, start JAR/profile local trên cổng 18080, thử cookie/CSRF/auth/quyền/validation và tự dừng JAR trong `finally`. Có thể đổi cổng bằng SMOKE_PORT. Script tạo 4 user và 2 project, không xóa DB; không chạy lên DB chung. Muốn chạy lại phải dùng DB trống mới vì mật khẩu seed chỉ tạo một lần. Log server nội bộ ở `target/http-smoke-server.log`; không commit raw log/token.

HTTP regression phase 1: tạo DB thử trống **khác với DB smoke trên**, cấu hình DB_URL/DB_USERNAME/DB_PASSWORD và SMOKE_PSQL (đường dẫn psql), rồi chạy `python tools/run_phase1_http_regression.py`. Script dùng SQL **chỉ trong DB fixture** để disable/re-enable tài khoản, xác minh hai session cũ không đọc/ghi được và không hồi sinh sau bật lại; không tạo API quản trị. Kiểm thêm JSON type/null, 415 và 406. Psql thiếu thì script dừng, không skip rồi báo PASS. Cổng mặc định 18082, đổi bằng PHASE1_SMOKE_PORT. Cả hai script tự dừng JAR và không in password/cookie/token.

Kiểm tra cuối Phase 1 mở rộng script trên để thử public CSRF/login/logout với session disabled và session tự hết hạn. Chỉ JAR kiểm thử được đặt timeout 1 phút và chờ 65 giây không có request; cấu hình ứng dụng vẫn mặc định 30 phút. Các kết quả Phase 1 là lịch sử; kết quả mới ở `../evidence/week-02/backend/`.

`UploadIntegrationTest` nằm trong bộ opt-in `RUN_DB_TESTS=true`, dùng PostgreSQL thật và StoragePort fixture chỉ ở test source. Có transaction/quota concurrency, complete lặp/expiry race, rollback, exact version, JSON checksum sai và HTTP TCP/Tomcat thật với cookie/CSRF. Fixture HEAD/checksum không phải upload byte lên S3 hoặc chạy Lambda. Thiếu DB test thì suite bị SKIPPED; không ghi AWS PASS từ suite này.

Để kiểm JAR thiếu adapter thật: dùng DB fixture trống riêng, đặt `CHECK_WEEK2_UPLOAD=true`, `UPLOAD_BUCKET=fixture-bucket`, rồi chạy `python tools/run_http_smoke.py`. Ngoài baseline, script thử Viewer 403, cross-project 404, signer 503, quota được bù và download version FAILED bị chặn. `UPLOAD_BUCKET` này chỉ là fixture; không tạo AWS resource. Script phải chạy trước khi tích hợp adapter thật, vì nó cố ý mong đợi 503.

## Cấu trúc

- `auth/`: user lookup, BCrypt, session login/logout/CSRF, local demo users.
- `project/`: controller/DTO/service/repository, membership và audit transaction.
- `upload/`: session, quota/expiry, complete exact version, checksum và StoragePort.
- `handover/`: DRAFT/READY/CONFIRMED, quyền người nhận, download và revoke cơ bản.
- `common/`: health, requestId server sinh, lỗi JSON an toàn.
- `src/main/resources/db/migration/`: schema Flyway.
- `src/test/java/`: kiểm tra PostgreSQL/API và hợp đồng; dependency validator chỉ scope test.

Tham khảo phiên bản và CSRF: [Spring Boot 3.5 system requirements](https://docs.spring.io/spring-boot/3.5/system-requirements.html), [Spring Security CSRF](https://docs.spring.io/spring-security/reference/features/exploits/csrf.html). Không triển khai microservices, Redis, Kafka, Eureka hoặc MongoDB.
