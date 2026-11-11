# C09-R01 — Registration API design & input validation

Ngày: 2026-11-11 (Asia/Saigon). Branch `task/C09-registration`; base R00 `361bcbb9ae5a9253170a5b84a4032529349586f1`.

**Trạng thái API: thiết kế, chưa triển khai.** R01 chỉ thêm RegistrationRequest, unit test và tài liệu này. Không có controller/service/INSERT, thay đổi SecurityConfig, frontend hoặc OpenAPI chính thức. Các status/response bên dưới là hợp đồng dự kiến cho task triển khai tiếp theo, không phải endpoint đã chạy được.

## 1. Endpoint và request dự kiến

`POST /api/v1/auth/register`

- Request Content-Type: `application/json`; Accept: `application/json`.
- Cho phép anonymous truy cập khi endpoint được triển khai, nhưng luôn yêu cầu CSRF hợp lệ.
- Client lấy GET `/api/v1/auth/csrf`, giữ cùng cookie jar và gửi token qua tên header do backend trả về (hiện là X-CSRF-TOKEN).
- Body là object với **đúng bốn thuộc tính**, tất cả bắt buộc; không chấp nhận thuộc tính khác.

Ví dụ giả lập theo yêu cầu, không phải credential tài khoản thật:

```json
{
  "displayName": "Nguyen Van A",
  "email": "example@gmail.com",
  "password": "Example123",
  "confirmPassword": "Example123"
}
```

`displayName` là tên hiển thị, không phải username đăng nhập riêng. Email tiếp tục là định danh đăng nhập. Không nhận id, enabled, role, membership, owner, passwordHash hoặc các cờ validation do client cung cấp.

## 2. Quy tắc validation đã có trong DTO R01

| Trường | Quy tắc |
|---|---|
| displayName | JSON string, bắt buộc, không null/rỗng/toàn whitespace. Tối đa 100 Unicode code point sau `String.strip()`; không tự thay đổi giá trị lưu trong DTO |
| email | JSON string, bắt buộc, không null/rỗng/toàn whitespace. Tối đa 254 UTF-16 code unit của chuỗi đầu vào theo Jakarta Size. Email được Jakarta Email kiểm tra trên bản `trim()`; DTO vẫn giữ nguyên chuỗi gốc |
| password | JSON string, bắt buộc, không null/rỗng/toàn whitespace. Ít nhất 8 Unicode code point, tối đa 72 byte UTF-8. Không trim, lowercase hoặc Unicode-normalize |
| confirmPassword | JSON string, bắt buộc, không null/rỗng/toàn whitespace; khớp password chính xác bằng String.equals, không biến đổi giá trị |

Các cách đếm được ghi rõ: không coi một surrogate pair là hai ký tự tên/mật khẩu; không coi ký tự tổ hợp là một grapheme. Giới hạn mật khẩu được kiểm tra trên toàn bộ byte, không cắt chuỗi để vừa BCrypt. Ví dụ 18 emoji bốn byte là 72 byte, hợp lệ nếu thỏa min-length; thêm một ký tự ASCII thành 73 byte là không hợp lệ. Bốn emoji không đủ tám ký tự dù chiếm tám UTF-16 code unit.

Email có thể có whitespace ASCII ở hai đầu nếu tổng chuỗi đầu vào không vượt 254; ví dụ `  Person@Example.TEST  ` được kiểm tra format trên bản trim nhưng DTO không thay đổi chữ hoa/thường. Chuỗi email 254 ký tự cộng thêm padding vượt 254 bị từ chối. Business logic R02 phải chuẩn hóa `email.trim().toLowerCase(Locale.ROOT)` trước lookup/INSERT và kiểm tra lại kết quả theo giới hạn DB, nhất là lowercase Unicode có thể làm thay đổi độ dài. Tên hiển thị được strip trước persistence ở bước nghiệp vụ; không trim mật khẩu/xác nhận.

DTO dùng Jakarta NotBlank/Pattern/Size/Email/AssertTrue cùng StrictStringDeserializer sẵn có. Kiểm tra độ dài tên, độ dài password theo ký tự/UTF-8 và khớp xác nhận là các getter Bean Validation tối giản, không có framework/annotation validation mới. Pattern Unicode bổ sung kiểm tra blank (kể cả non-breaking space) vì NotBlank của provider hiện tại chỉ loại được một phần whitespace; không đổi validator toàn cục.

- Thiếu field bị Bean Validation từ chối; explicit null bị Jackson Nulls.FAIL từ chối, theo quy ước CreateProject.
- Number, boolean, array và object không được coercion thành string.
- Unknown field bị từ chối theo `spring.jackson.deserialization.fail-on-unknown-properties=true` hiện có. Getter validation không thuộc JSON, không thể dùng field giả để bỏ qua validation.
- Các constraint có thông báo cố định, không nội suy mật khẩu/giá trị bị từ chối. `toString()` chỉ trả `RegistrationRequest[redacted]`.
- Password và confirmPassword là Jackson WRITE_ONLY: deserialize được nhưng không xuất hiện khi DTO bị serialize. Đây không phải response DTO.
- Controller tương lai phải dùng request body bắt buộc và Valid để kích hoạt validation; DTO tự nó không tạo HTTP endpoint. Body thiếu/null/sai root type cần được xử lý thành 400 ở lớp HTTP khi triển khai.

## 3. Thành công: 201 Created

Response JSON dùng shape UserView hiện có, chỉ gồm id, email đã normalize và displayName đã strip. Ví dụ giả lập:

```json
{
  "id": "00000000-0000-0000-0000-000000000001",
  "email": "example@gmail.com",
  "displayName": "Nguyen Van A"
}
```

- Chỉ trả 201 sau khi tạo account thành công và transaction commit; không phản hồi thành công khi INSERT rollback.
- Không trả password, confirmPassword, passwordHash, JWT, CSRF token hoặc role/membership trong body này. Không tạo một URL Location giả cho API user chưa tồn tại.
- Không auto-login, không thiết lập/thay principal để đăng nhập user vừa tạo, không gọi login handler. Client anonymous vẫn anonymous; GET `/auth/me` sau registration vẫn 401 cho tới khi login riêng.
- Anonymous session/cookie được tạo khi bootstrap CSRF vẫn được phép tồn tại; điều này không phải phiên đăng nhập.
- Không có membership hoặc quyền project mặc định. Không gửi email/OTP, không tạo JWT và không thêm username riêng.
- Frontend task sau sẽ chuyển về login trong cùng khung bằng state, giữ URL, không tự gửi POST login. R01 chưa sửa giao diện.

## 4. Lỗi dự kiến và ApiError

Giữ cấu trúc ApiError hiện có, luôn gồm code/message/requestId; không bổ sung rejectedValue hoặc echo payload. requestId do hệ thống tạo, không dùng id cố định trong runtime.

| HTTP | code dự kiến | Ý nghĩa |
|---|---|---|
| 400 | VALIDATION_ERROR | Body/field sai kiểu, thiếu/null, unknown field, vi phạm độ dài/format hoặc xác nhận không khớp |
| 409 | EMAIL_ALREADY_EXISTS | Email normalized đã có, bao gồm conflict do hai transaction đồng thời cùng email |
| 403 | ACCESS_DENIED | CSRF thiếu/sai/hết hạn; giữ cách xử lý Security hiện có |

Ví dụ lỗi 400 giả lập, dùng đúng thông báo generic của ApiExceptionHandler:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid request fields or format",
  "requestId": "00000000-0000-0000-0000-000000000002"
}
```

409 dự kiến dùng message cố định `Email is already registered`; 403 giữ `Permission denied or invalid CSRF token`. Không đưa email được đăng ký, mật khẩu, token, SQL hoặc stack trace vào message. Code EMAIL_ALREADY_EXISTS là đề xuất cho R02, chưa có handler nghiệp vụ đăng ký trong R01. R02 có thể dùng ApiException theo kiến trúc hiện tại, không cần đổi ApiError shape.

Content-Type không hỗ trợ tiếp tục theo cơ chế HTTP 415/UNSUPPORTED_MEDIA_TYPE sẵn có khi có controller. Sai DB/schema hoặc lỗi hệ thống không được giả thành 409 email trùng; giữ error sanitization của hệ thống. Không tự retry POST sau timeout vì transaction có thể đã commit; hướng dẫn người dùng kiểm tra/trở về login, không khẳng định chắc chắn account chưa được tạo.

## 5. Email trùng và concurrency: phương án dành cho R02

1. Validate request trước side effect; normalize email nhất quán với lookup đăng nhập bằng trim + lowercase Locale.ROOT.
2. Nếu pre-check tồn tại để cải thiện phản hồi thì đây chỉ là tối ưu; không dựa vào check-then-insert để bảo đảm duy nhất.
3. Sinh UUID/hash bằng encoder BCrypt cost 12 hiện có và INSERT trong transaction, không sửa V1/schema hoặc tạo membership. Chưa có INSERT nào trong R01.
4. Database `app_users.uq_user_email` là nguồn bảo đảm cuối cùng. Hai transaction cùng email normalized: tối đa một INSERT commit, request còn lại nhận 409 sau khi nhận diện unique violation của đúng constraint (PostgreSQL SQLSTATE 23505), không 500 hoặc 201 giả.
5. Đảm bảo rollback transaction lỗi trước khi trả conflict; không tiếp tục dùng transaction đã bị PostgreSQL abort. Không map mọi DataIntegrityViolationException hoặc mọi 23505 thành email trùng (ví dụ conflict PK hoặc schema khác).
6. Giữ tài khoản đã có nguyên vẹn, kể cả disabled; không overwrite password/displayName, re-enable hoặc auto-login. Race/concurrency và side-effect tests thuộc R02, không tuyên bố đã kiểm thử persistence ở R01.

## 6. Quy tắc bảo toàn và integration checkpoint

- Không đổi session/login/logout/CSRF/disabled-account handling, không permit toàn bộ /auth/**. Task triển khai sẽ phải review matcher cho đúng endpoint và hành vi khi request có principal cũ; R01 không sửa SecurityConfig hoặc ActiveAccountFilter.
- Giữ raw input trong DTO cho business processing có chủ đích; không log request/constraint rejected values hoặc serialize credential vào response.
- Không đổi dependency, application config, migration, frontend, AWS hoặc tài liệu cũ trong R01.
- OpenAPI chính thức được cập nhật ở task tích hợp cùng schema/examples, x-implementation-status, frontend caller, backend tests và `frontend/tests/endpoint-trace.json`. ContractTest/contract.test.js hiện đối chiếu operation trace; không sửa hoặc làm yếu assertions trong R01.

## 7. Kiểm thử và giới hạn bằng chứng R01

RegistrationRequestTest dùng JsonTest với ObjectMapper thực do Spring cấu hình và Jakarta Validator riêng, không khởi động database hoặc endpoint. Coverage gồm required/null/blank, length boundary tên/email, Unicode code point, UTF-8 72/73 byte, exact confirmation, không coercion JSON, unknown fields kể cả tên getter validation, raw input không đổi, redacted toString/serialization và thông báo validation không có password.

Các lệnh nghiệm thu bắt buộc:

```powershell
# backend
.\mvnw.cmd -B -ntp -Dtest=RegistrationRequestTest test
.\mvnw.cmd -B -ntp verify
# frontend
npm run lint
npm test
npm run build
```

Full backend verify chỉ bật RUN_DB_TESTS khi đã tạo PostgreSQL disposable riêng; không dùng DB chung và không coi skip là PASS. Kết quả thực chạy được ghi ở evidence bị ignore trong runtime-data và báo cáo cuối. Không có registration HTTP E2E, duplicate-email DB E2E hoặc browser registration ở R01 vì endpoint/frontend chưa triển khai. Không chạy hoặc triển khai AWS. Hoàn thành R01 thì dừng, không tự thực hiện R02 và không push.

## 8. Kết quả nghiệm thu thực chạy R01

- Focused Maven Wrapper RegistrationRequestTest: **105 PASS**, 0 failure/error/skip.
- Maven Wrapper verify: **168 PASS**, gồm 105 test mới và toàn bộ 63 test cũ, 0 failure/error/skip. PostgreSQL disposable đã được xóa.
- Frontend lint: PASS; unit: **33 PASS**, 0 fail/skip; build: PASS. Frontend không thay đổi.
- Lần focused đầu phát hiện hai case Unicode whitespace chưa bị NotBlank hiện hành từ chối. Đã bổ sung Pattern chuẩn trong DTO mới và thêm boundary cases; giữ nguyên assertions, lần chạy lại và full verify đều PASS.
- Môi trường: Maven Wrapper 3.9.12, JDK 25 compile release 21, Node 24.15.0, npm 11.12.1; chưa kiểm chứng lại runtime Java 21 trong R01. Cảnh báo dynamic agent hiện có không làm fail test; không thay dependency/config để che cảnh báo.
- Evidence của lần chạy này ở `runtime-data/c09-r01-20261111-ec549581dc/` (Git ignore, không commit): registration-unit.log (lần đầu), registration-unit-2.log và result JSON, backend-verify.log/backend-result.json, frontend logs/frontend-result.json và tracked-baseline.json.
- API registration/DB duplicate race/browser registration/AWS E2E: **NOT_RUN**, chưa có endpoint/frontend/persistence để tuyên bố PASS.

Chỉ commit local ba file R01 sau staged diff/scope check. Không push/PR/merge hoặc thực hiện R02.
