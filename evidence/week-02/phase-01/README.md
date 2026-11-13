# Bằng chứng tuần 2 phase 1

**Bản lưu lần chạy trước kiểm tra cuối.** Kết quả 14 JUnit / 84 HTTP và source-hashes ở thư mục này chỉ đại diện snapshot ban đầu. Code/filter/test đã được bổ sung sau đó; xem [evidence kiểm tra cuối](../phase-01-final/README.md) cho trạng thái hiện tại. Không dùng hash cũ để xác nhận working tree mới.

Ngày 22/10/2026, UTC+07. Branch `dung`, nền ef79ee3 + thay đổi working tree chưa commit. Không push. Môi trường: Windows, Java Temurin 25, target 21, Maven Wrapper 3.9.12, PostgreSQL 17.9. Không có AWS hoặc frontend được thử trong task này.

## Môi trường và lệnh

Dùng cluster local tách riêng `runtime-data/audit-week1-20261022`, listen 127.0.0.1:55433. Tạo các DB fixture mới `phase1_junit_20261022`, `phase1_baseline_final_20261022`, `phase1_regression_final_20261022`; không dùng dữ liệu chung. Trust chỉ ở cluster thử local. Không tạo hoặc sửa DB production. JAR của hai script tự dừng; cluster thử được dừng khi kết thúc.

Từ backend, đặt DB_URL/DB_USERNAME/DB_PASSWORD tới database thử. Chạy `RUN_DB_TESTS=true` và `mvnw.cmd -B -ntp verify`; lần khởi tạo đầu của task đã chạy `clean verify` trên schema trống. Những lần sau chỉ chạy lại khi sửa code/test/contract. Không skip test hoặc dùng H2.

HTTP baseline: `python tools/run_http_smoke.py`, database trống riêng, output `http-baseline.txt`: 41 request checks PASS.

HTTP phase 1: đặt SMOKE_PSQL trỏ psql, DB_URL tới DB trống khác và chạy `python tools/run_phase1_http_regression.py`; output `http-regression.txt`: 43 request checks PASS. Script tạo mật khẩu ngẫu nhiên trong bộ nhớ, SQL chỉ thay enabled của fixture UUID, không có admin API, không in password/token/cookie. Psql thiếu sẽ fail, không skip rồi báo PASS.

## Kết quả cuối

- BUILD SUCCESS, 14 tests: 2 ActiveAccountFilterTest (unit/repository mock cho outage và anonymous), 8 BackendIntegrationTest (PostgreSQL thật), 4 ContractTest. Failures/errors/skipped đều 0. Tên ca và số lượng trích từ Surefire XML trong `junit-summary.txt`, không lấy properties hoặc raw environment.
- HTTP 41 + 43 = 84 request checks, gồm các request lặp theo từng loại input. Không diễn giải thành 84 kịch bản nghiệp vụ hoặc test UploadService.
- `migration-startup.txt` trích log Flyway/Tomcat của JAR cuối trên DB trống, không chứa payload hoặc credential. `source-hashes.json` ghi hash các file mã nguồn/test/hợp đồng thay đổi và JAR, để đối chiếu bản thử chưa commit.
- V1 không thay đổi so với Git HEAD; không có migration mới. Chỉ thiết kế schema, không tuyên bố DB đã có trigger đóng băng identity hoặc service quota.
- 406 đã được xử lý bằng error response JSON rõ ràng, tránh warning thương lượng response lần hai ở lần build đầu. Bản cuối chạy lại không có lỗi này; cảnh báo Mockito agent/Java deprecated API trong test vẫn không làm build thất bại.

## Các bằng chứng sửa lỗi

| Ca | Kết quả cuối |
| --- | --- |
| name/description là số, float, boolean, null, array/object | 400 VALIDATION_ERROR, không tạo project |
| Thiếu name, blank name hoặc tự thêm quotaBytes | 400 |
| Omit description / string hợp lệ | 201, description rỗng / trim chuỗi như cũ |
| Content-Type text/plain hoặc form-urlencoded vào JSON endpoint | 415 UNSUPPORTED_MEDIA_TYPE, không tạo project |
| Accept text/plain khi GET me | 406 NOT_ACCEPTABLE |
| Disable user sau khi đã login hai session | GET me và POST project đều 401 ACCOUNT_DISABLED, session bị hủy; không có row do thao tác bị chặn |
| Login mới khi user đang disabled | 401 INVALID_CREDENTIALS |
| Bật lại user rồi replay cookie session cũ | 401 UNAUTHENTICATED; login mới thì dùng được |
| Lỗi repository khi revalidate account | Unit test 503 AUTH_UNAVAILABLE, handler không chạy và session còn để retry; chưa thử outage DB thật |
| `/health` kèm cookie disabled | 200 khi DB vẫn UP; không phụ thuộc session |
| OpenAPI schema audit counterexamples | Project wrong types/null, fileId=null, complete versionId null/blank/literal-null/number hoặc client integrityStatus bị schema từ chối |

NOT RUN: S3 upload/HEAD/presign, conditional PUT/412, physical quota, concurrent UploadService, Lambda integrity/retry, phát hành/xác nhận, HTTPS/CORS và UI thật. Những phần đó là hợp đồng/review gate hoặc giai đoạn tiếp theo, không phải bằng chứng PASS ở đây.
