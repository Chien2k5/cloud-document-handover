# Backend lưu trữ và bàn giao tài liệu

Nền tảng tuần 1 của Dũng: một ứng dụng Spring Boot 3.5.16, Maven Wrapper 3.9.12, PostgreSQL/Flyway, Spring Security session/CSRF và API Project/Membership. Java target 21; đã kiểm thử bằng Java 25 và PostgreSQL 17. Chưa có S3 SDK, Lambda, frontend hoặc service upload/bàn giao.

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

File upload/complete/status/list/download và handover có thiết kế trong `../contracts/openapi.yaml`, đánh dấu **contract-only**; không có controller giả. Caller ngoài project nhận 404 để không lộ tài nguyên. Không có session nhận 401; CSRF thiếu/sai có thể bị 403 trước. Role được đọc từ Membership hiện tại, không nằm trong request hoặc quyền global.

## Build và test

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

## Cấu trúc

- `auth/`: user lookup, BCrypt, session login/logout/CSRF, local demo users.
- `project/`: controller/DTO/service/repository, membership và audit transaction.
- `common/`: health, requestId server sinh, lỗi JSON an toàn.
- `src/main/resources/db/migration/`: schema Flyway.
- `src/test/java/`: kiểm tra PostgreSQL/API và hợp đồng; dependency validator chỉ scope test.

Tham khảo phiên bản và CSRF: [Spring Boot 3.5 system requirements](https://docs.spring.io/spring-boot/3.5/system-requirements.html), [Spring Security CSRF](https://docs.spring.io/spring-security/reference/features/exploits/csrf.html). Không triển khai microservices, Redis, Kafka, Eureka hoặc MongoDB.
