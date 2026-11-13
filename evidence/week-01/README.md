# Bằng chứng local tuần 1

Người thực hiện: Nguyễn Huy Dũng. Ngày chạy 15/10/2026, UTC+07, Windows, Java Temurin 25, Maven Wrapper 3.9.12, Spring Boot 3.5.16, PostgreSQL **17.9**. Nền Git `0e70ee2`, các file trong commit bàn giao nhánh `dung`; dùng `git log -1 --format=%H dung` để lấy hash. Đây là kiểm chứng local, không có bằng chứng AWS hoặc Nam/Đăng đã review.

## Môi trường tách biệt

Docker CLI có nhưng daemon không chạy. Máy có PostgreSQL 17 nên đã init cluster thử riêng ở `runtime-data/week1-pg-verified`, chỉ listen `127.0.0.1:55432`. User thử `week1_test`, database `handover_week1` cho JUnit và `handover_week1_http` cho lần smoke đầu. Cluster thử dùng trust để tránh lưu secret; chỉ phục vụ test cục bộ, không phải cấu hình triển khai chung. Không dùng hoặc thay đổi dịch vụ/database sẵn có. Sau kiểm chứng dừng cluster thử; không xóa dữ liệu khác.

Lần init trong sandbox bị dừng tại kiểm tra shared memory; đã ngắt và chạy lại init trong cluster thử mới ngoài sandbox với quyền được cấp. Maven PATH của máy có script không chạy được; dùng Maven Wrapper chuẩn của project. Sandbox chặn ghi `.m2` nên build/test đã chạy với quyền được cấp. Các lỗi môi trường ban đầu không được tính là PASS; các kết quả dưới đây từ những lần chạy thành công sau đó.

## Build và JUnit

Lệnh từ `backend/`, với DB_URL trỏ database thử, DB_USERNAME/DB_PASSWORD cấu hình riêng:

```powershell
$env:RUN_DB_TESTS='true'
.\mvnw.cmd -B -ntp verify
```

Lần đầu 22:52:14–22:52:26 đã chứng minh schema trống:

```text
Schema history table public.flyway_schema_history does not exist yet
Current version of schema public: << Empty Schema >>
Migrating schema public to version 1 - initial schema
Successfully applied 1 migration, now at version v1
BackendIntegrationTest: Tests run 5, Failures 0, Errors 0, Skipped 0
ContractTest: Tests run 3, Failures 0, Errors 0, Skipped 0
Tests run 8, Failures 0, Errors 0, Skipped 0
BUILD SUCCESS
```

Lần verify tiếp theo 22:57:33–22:57:42 kiểm migration lặp: schema v1, `No migration necessary`; 8/8 PASS, không skip. Bộ test dùng mật khẩu ngẫu nhiên, không commit password hoặc session. Maven có cảnh báo Mockito agent/Java 25 và API deprecated trong test; build vẫn thành công. Không dùng warning để bỏ qua failure.

Bản cuối sau điều chỉnh login/API health: verify 23:00:52–23:01:03, vẫn 8/8 PASS, không skip. Tên ca và số lượng được trích trực tiếp từ XML Surefire ở `junit-summary.txt`, không lấy phần properties/environment hoặc payload. `http-smoke.txt` là output 41 request checks của JAR cuối trên DB trống `handover_week1_http_final`; `migration-startup.txt` chỉ trích dòng migration/Tomcat/startup, chứng minh JAR cuối migrate từ trống và listen HTTP.

Ca PostgreSQL/API bao gồm health, Flyway history, đăng nhập đúng/sai, thiếu CSRF, không session, logout, tạo Owner phía server, A/B không đọc chéo, role/unknown field bị chặn, Owner gán/gỡ member, Editor/Viewer bị chặn sửa membership, không xóa Owner, member bị gỡ mất quyền ngay, audit và validation.

Ca DB gồm FK/unique, version phải có trước AVAILABLE, AVAILABLE vẫn INTEGRITY_PENDING, hash sai không VERIFIED, không trộn item/gói khác project, vượt quota CHECK bị chặn và không xóa version được tham chiếu. Các test này không chứng minh quota reservation đồng thời hoặc HEAD S3 đã hiện thực.

## Smoke JAR trên HTTP

Tái lập bằng `backend/tools/run_http_smoke.py` với một database thử **trống** và các env DB; script tự start JAR/profile local trên TCP 18080 và tự dừng trong finally. Không in cookie/token/password; mật khẩu tạo trong bộ nhớ. Sau một lần chạy, dùng database trống khác cho lần tiếp theo.

Kết quả lần smoke đầu: **41 HTTP checks PASS**, session ID xoay sau login, CSRF trước login bị từ chối khi dùng sau login. Kiểm cookie jar độc lập của 4 user, auth/me/logout, project A/B, membership Owner/Editor/Viewer, validation, gỡ quyền, route upload chưa triển khai không trả thành công. JAR startup cũng chạy Flyway từ database trống thứ hai.

```text
GET health -> 200
GET auth/me before login -> 401
POST auth/login wrong password -> 401
POST auth/login correct credentials -> 200
POST projects with stale/missing CSRF -> 403
POST projects -> 201
GET own project -> 200; cross-project -> 404
PUT membership by Owner -> 200; by Editor/Viewer -> 403
DELETE Owner -> 409; DELETE Viewer -> 204
GET project after membership removed -> 404
POST upload route (contract only) -> 404
POST auth/logout -> 204; GET auth/me afterwards -> 401
status=PASS httpChecks=41 sessionIdRotation=true staleCsrfRejected=true
```

## Hợp đồng và kết quả chưa có

OpenAPI parser resolve không lỗi; API JSON examples hợp schema; Lambda success/failure hợp JSON Schema, thiếu/literal-null Version ID hoặc SUCCEEDED thiếu actual hash bị từ chối. Tất cả ID/URL trong examples là dữ liệu giả và `example.invalid` không truy cập được. JSON schema test không thay test Lambda thật.

NOT RUN: S3, Lambda, Beanstalk, frontend, HTTPS/cookie Secure, complete thật, concurrent reservation, publish/confirm thật, backup/restore. Cần POC và log của Đăng/Chiến, test UI của Nam và review contract trước nghiệm thu tích hợp. Không có log hoặc ảnh AWS được tạo giả.
