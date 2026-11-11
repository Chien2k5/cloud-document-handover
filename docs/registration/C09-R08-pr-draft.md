# feat(auth): add secure user registration (C09)

Base: `dung`
Head: `task/C09-registration`
Related tasks: C09-R00–C09-R08; chưa có Issue URL được cung cấp.

## 1. Summary

Guest có thể tạo tài khoản qua `POST /api/v1/auth/register` có CSRF. Backend validate
strict JSON bốn trường, normalize email, hash BCrypt12 và persist PostgreSQL với
constraint chống email trùng/race. React chuyển Login/Register trong cùng Card,
gửi API và chỉ xác nhận sau201 hợp lệ. OpenAPI/trace cùng unit/integration/browser
tests bổ sung cho flow mới và regression cũ.

## 2. Functional Behavior

- Nhập tên tài khoản, email, password và confirm password; validation client hỗ trợ nhập liệu, backend quyết định.
- Thành công201 chỉ trả id/email/displayName; UI trở về Login với email, password trống, không auto-login.
- Không tạo project/membership mặc định; account mới không được đọc/ghi workspace của người khác.
- Giữ form-urlencoded login, logout không body, session rotation và CSRF hiện có.
- Pending chặn submit lặp; lỗi/timeout không tự retry POST hoặc báo success không xác nhận; stale response không thay account mới.

## 3. Implementation Scope

| Nhóm | Phạm vi |
| --- | --- |
| Backend | RegistrationRequest/Service, UserRepository INSERT/lookup, AuthController, exact public POST matcher và ActiveAccountFilter. |
| Frontend | Guest Login/Register state/form, guest-scoped CSS, register API/strict201/error handling. |
| Contract | OpenAPI operation/request/status/CSRF và một endpoint trace mới. |
| Tests | DTO/service/PostgreSQL/HTTP/security, API/contract unit, mock browser và real backend registration. |
| Documentation | Bốn báo cáo R00/R01/R06/R07, ba README hiện hành và hai tài liệu R08. |

Full feature candidate so với base:33 files,17 added/16 modified/0 deleted. R00–R07
riêng28 files; R08 chỉ thêm2 docs/sửa3 README. Không dependency/migration/deploy/cloud
config change. Không sửa Project/Upload/Handover hoặc protected logic ở R08.

## 4. Security Guarantees — phạm vi đã kiểm chứng

- Anonymous registration vẫn cần token CSRF từ đúng session; thiếu/sai/cross-session bị403.
- BCrypt encoder cost12 hiện có hash raw password; tối thiểu8 Unicode code point, tối đa72 byte UTF-8, exact confirmation; không trim/cắt password.
- Strict required strings, null/type/unknown field rejection, name/email boundary và Locale.ROOT normalization.
- Parameterized SQL + uq_user_email xử lý duplicate/race; không overwrite/reset/re-enable account đã có.
- Existing account/session isolation và protected project/membership/upload/handover boundaries được backend/local suites kiểm lại.
- Response/error/log cases được test không leak password/hash/internal SQL; frontend không lưu password vào web storage hoặc URL, không tự retry mutation.

Đây là các checks cụ thể, không bảo đảm chống mọi tấn công hoặc xác nhận cấu hình
logging/gateway/TLS production. Bốn rủi ro public registration vẫn OPEN bên dưới.

## 5. Verification — thực chạy C09-R08

| Gate | Kết quả | Mức bằng chứng |
| --- | --- | --- |
| npm ci / lint | PASS | Lockfile không đổi; không audit fix |
| npm test | 71 PASS,0 fail/skip | UNIT_MOCK |
| npm run build (2 lượt) | PASS, dist hashes trùng | Local frontend build |
| npm run test:e2e | 390 PASS,0 fail/skip | BROWSER_MOCK, không chứng minh DB/AWS |
| Focused registration UI/API/regression + auth | 27/23/34/2 PASS,0 fail/skip ở lượt hoàn tất | BROWSER_MOCK; subset full390 |
| Backend clean verify (2 lượt, trong live runners) | 268 PASS mỗi lượt,0 failure/error/skip | Maven Wrapper, disposable PostgreSQL thật |
| Real Spring/PostgreSQL browser | 3 PASS,0 fail/skip | LOCAL_REAL_BACKEND; đăng ký201 → me401 → explicit login/logout, project/membership |
| Business storage browser | 2 PASS,0 fail/skip | LOCAL_REAL_BACKEND_WITH_TEST_STORAGE; HTTPS fixture test-only, không AWS |
| Python offline | 27 PASS | PYTHON_OFFLINE |
| Java/Python contract | 29 PASS | JAVA_PYTHON_CONTRACT, production parser/JAR |
| npm audit | 0 vulnerability | Dependency audit, không thay security review ứng dụng |
| python tools/run_preaws_checks.py | PASS_PRE_AWS_CHECKS | Unchanged aggregate runner hoàn tất exit0 |
| Database cleanup | PASS | Hai container do runner tạo đã remove, inventory đối chiếu |
| AWS_REAL_E2E | NOT_RUN | Không dùng/deploy tài nguyên AWS |

Aggregate thực thi các npm gates, hai live runners (mỗi lượt Maven clean verify),
Python và contract; không cộng subset/aggregate thành số test unique. Source full
suite: R07 `1bfd9a4024039485e9e1f8405ab6c573a9c98d0f`, clean lúc bắt đầu; R08 docs-only,
source/test/config hashes không đổi. Base đã fetch lại vẫn
`d7b23139e0cb945a414caa42c9a7eb29676edd7e`.

Minh bạch execution: focused registration-regression lần đầu thoát Windows3221226505
(0xC0000409) trước output Running/tests, chưa có assertion failure; log giữ nguyên.
Chạy lại nguyên suite/config sau aggregate đạt34/34, auth2/2; full390 đã PASS độc lập.
Chưa xác định root cause native exit; không sửa fixture/assertion/timeout/config.
JDK25 compile release21 được test; Java21 runtime và PR CI tương lai chưa được kiểm
chứng bằng lượt local này.

Chi tiết matrix, toàn bộ33 file, audit tám commit và evidence paths tại
[final review R08](C09-R08-final-review.md). Evidence local ignored:
`runtime-data/preaws-f3ec39e5b15c47518cf0ee2b74508951/verification.json` và
`runtime-data/c09-r08-20261111-4e0837d0e8/`; raw artifacts không đưa vào PR.

## 6. Known Risks

Giữ severity/status từ [R06 security review](C09-R06-security-review.md), không tự
chấp nhận rủi ro thay chủ dự án:

| Finding | Severity | Risk | Status |
| --- | --- | --- | --- |
| R06-F01 | MEDIUM | Chưa application rate limit/chống tạo tài khoản hàng loạt; nguy cơ abuse CPU/DB. | OPEN |
| R06-F02 | MEDIUM | Chưa xác minh quyền sở hữu email; account enabled không chứng minh danh tính. | OPEN |
| R06-F03 | LOW | Phân biệt201/409 cho phép email enumeration. | OPEN |
| R06-F04 | LOW | Chưa công tắc bật/tắt registration riêng; chưa kiểm chứng control bên ngoài. | OPEN |

0 CRITICAL,0 HIGH,2 MEDIUM,2 LOW trong phạm vi review. Không có blocking defect mới
đã xác định; không coi local readiness là production security approval.

## 7. Deployment Notes

- Không database migration mới cho registration; dùng schema/unique email constraint hiện có.
- Không yêu cầu AWS resource mới; không thay IAM/S3/Lambda/RDS hoặc deployment config.
- Không thêm biến môi trường/dependency và không thay seed/credential deployment.
- Public registration cần chốt chính sách rate limit, email ownership và exposure trước mở Internet; chưa phê duyệt production/deploy.
- Theo [PRINCIPLE.MD](../../PRINCIPLE.MD), chủ phần việc review, TV1 điều phối; OpenAPI cần TV2 và TV4 cùng duyệt. Target dung theo task được giao; không main, không bypass review/protection. Chưa kiểm tra/thỏa mãn CI và branch protection của PR thật vì chưa tạo PR.

## 8. Reviewer Checklist

- [ ] Review backend authentication.
- [ ] Review Spring Security và CSRF.
- [ ] Review validation.
- [ ] Review password handling.
- [ ] Review frontend UI.
- [ ] Review OpenAPI/trace.
- [ ] Review test evidence.
- [ ] Review known security risks.
- [ ] Xác nhận chính sách public registration.
- [ ] Xác nhận merge vào `dung`.

## 9. Merge Status

**NOT_PUSHED — PR_NOT_CREATED — MERGE_NOT_APPROVED**

Draft local để chủ dự án review. Không tự đánh dấu checklist approved, không tạo PR
thật hoặc merge. Push/PR/merge cần lệnh riêng sau khi người dùng duyệt.

## 10. Post-R08 Manual UAT Improvements

C09-UAT-FIX01 sửa hai điểm phát hiện khi chuẩn bị manual UAT, không thay registration
API/security: thêm favicon CH ICO bảy kích thước và link /favicon.ico; thêm panel
Thông tin tài khoản trong header cùng nút Sao chép UUID. UUID hiển thị/copy nguyên
user.id từ user authenticated, không tạo UUID frontend, project ID hoặc browser
storage. Có success/status và failure/alert, UUID readonly select được để copy thủ
công; Escape/focus, pending/stale-copy và account isolation được kiểm thử.

Asset gốc chưa được người dùng tải về và không tồn tại tại đường dẫn đã nêu. Sau
khi người dùng yêu cầu thêm, favicon được tạo local theo branding CH xanh/trắng hiện
có; không giả rằng đã copy binary đính kèm. /favicon.ico trả200 và đúng ICO bytes qua
Vite, không HTML fallback. Không backend API mới, schema migration, dependency,
contract/deploy/AWS config change. Không sửa test cũ hoặc R08 final report.

| FIX01 verification | Kết quả và mức bằng chứng |
| --- | --- |
| Lint / unit / build | PASS /71 PASS /PASS; no failure/skip |
| New E2E | 18 PASS; mock account/clipboard và favicon HTTP thật |
| Existing auth / registration UI/API/regression | 2/27/23/34 PASS, nguyên tests cũ |
| Full browser | 408 PASS =390 cũ +18 mới, BROWSER_MOCK |
| Backend verify | 268 PASS mỗi lượt,0 failure/error/skip;2 lượt trong real/business runner, DB riêng |
| Real runner browser / storage fixture | 3/2 PASS; phân biệt LOCAL_REAL_BACKEND và TEST_STORAGE, không AWS |
| Real localhost profile probe | PASS; Chrome/Spring/PostgreSQL/Clipboard thật: auth/me UUID = DB = displayed/copied UUID; reload/logout PASS |
| Python offline / Java-Python contract | 27/29 PASS |
| Pre-AWS | PASS_PRE_AWS_CHECKS; npm audit0; regression DB cleanup PASS |
| AWS_REAL_E2E | NOT_RUN |

Đây là số liệu FIX01 mới chạy; các phần trước của draft là snapshot R08. Full candidate
sau FIX01 có38 file so với base dung ban đầu; riêng FIX01 tối đa7 file được phép.
Focused test đầu có3 lỗi selector trong file mới đã sửa đúng ID thực và rerun18/18;
Pre-AWS đầu bị Windows native-module lock tại npm ci, giữ log và rerun nguyên runner
PASS sau giải phóng đúng owned preview/test process. Không đổi assertions cũ/runner
hoặc lockfile. JAR UAT được pin riêng trong runtime-data để Maven clean không làm hỏng
preview; DB UAT giữ nguyên, không dùng cho regression/TRUNCATE.

Kiểm localhost là automation với backend thật; chủ dự án chưa approve manual UAT.
Chrome window automation không khởi tạo được để quan sát trực tiếp tab favicon;
DOM/network/ICO và Chrome headless đã kiểm, owner xem tab Chrome hiện có. Xem
[FIX01 review](C09-UAT-FIX01-review.md) cho source/test evidence, screenshots và giới hạn.
Known risks R06-F01/F02 MEDIUM OPEN, R06-F03/F04 LOW OPEN giữ nguyên. Không coi local
PASS là public registration security approval. Không push, tạo PR thật, merge hoặc
triển khai: **NOT_PUSHED — PR_NOT_CREATED — MERGE_NOT_APPROVED**.
