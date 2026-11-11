# C09-R00 — Audit source và baseline

Ngày: 2026-11-11 (Asia/Saigon). Trạng thái: **PASS trong phạm vi C09-R00**. Chưa triển khai đăng ký và chưa bắt đầu C09-R01.

## 1. Branch, base và bảo toàn Git

- Repository/origin: `https://github.com/Chien2k5/cloud-document-handover.git`.
- Worktree mới: `D:/cloud-document-handover-registration`.
- Branch: `task/C09-registration`.
- Base đã fetch từ `origin/dung`: `d7b23139e0cb945a414caa42c9a7eb29676edd7e`, merge PR #6. HEAD ban đầu khớp base, worktree sạch.
- Trước tạo, branch chưa tồn tại local/remote và đường dẫn mới chưa tồn tại. Đã dùng `git worktree add -b task/C09-registration D:/cloud-document-handover-registration origin/dung`, không force/tái sử dụng dữ liệu.
- Worktree cũ vẫn ở `codex/backup-aws-mvp`, HEAD `7e7a3904506ebe64c29510c972b70d8b09e287e6`. Hai nhóm untracked `docs/ke-hoach-chot-ban-nop.md` và `docs/tv3/` gồm 7 file được đối chiếu SHA-256, không thay đổi.
- Đã đọc `PRINCIPLE.MD`. Yêu cầu trực tiếp của owner cho task này chỉ định base dung/worktree riêng, chỉ thêm tài liệu; không cập nhật local dung, merge, rebase, reset, stash, push hoặc PR.
- Đã lưu fingerprint 284 file tracked lúc bắt đầu; sau test và lúc tiếp tục task, cả 284 file vẫn nguyên byte. Không cần chạy lại baseline vì source/config/test và HEAD không đổi.

Nguồn đọc trực tiếp: `frontend/src/App.jsx`, `api.js`, `client.js`, shared UI/AppShell và CSS; `frontend/package.json`; toàn bộ `backend/src/main/java/vn/edu/uet/handover/auth/`; V1 migration, `application.yml`, `backend/pom.xml` và Maven Wrapper properties; `contracts/openapi.yaml`; API/contract unit tests, auth browser tests và các backend auth/integration tests liên quan.

## 2. Authentication hiện tại

### Frontend, login và logout

`App.jsx` bootstrap bằng GET `/api/v1/auth/me`. 401 bootstrap được xử lý im lặng qua `notifyUnauthorized: false`, lỗi khác được hiển thị. Khi anonymous, form Email/Mật khẩu nằm trong `guest-panel` và một Card hiện có; CSS căn giữa, max-width 680px và có breakpoint mobile. Chưa có registration form hoặc state chuyển sang đăng ký.

Login gọi `api.login(email.trim(), password)`, disable nút trong lúc busy và xóa password ở finally. Khi authenticated, `Portal` keyed theo `user.id`, giúp tách state giữa tài khoản. Sự kiện `portal-session-expired` xóa user/password và quay về form đăng nhập. Logout xóa user sau thành công; nhánh lỗi hiện có cũng xóa user nếu client đã mất CSRF. Luồng auth không lưu credential/token vào localStorage/sessionStorage; test browser hiện có kiểm tra storage rỗng.

### API client, session và CSRF

`api.js` chỉ chấp nhận đường dẫn nội bộ, thêm prefix `/api/v1` và gửi `credentials: include`. CSRF giữ trong bộ nhớ, lấy tên header/token qua GET `/auth/csrf`; mutation tự bootstrap CSRF nếu thiếu. `csrfPending` gộp request bootstrap đồng thời, `authEpoch` chặn response cũ ghi đè session mới. Timeout mặc định 20 giây; không tự retry mutation.

Login thực hiện: invalidate CSRF → lấy token anonymous → POST form-encoded `/auth/login` (`email`, `password`) → invalidate/lấy token mới → GET `/auth/me`. Logout POST `/auth/logout` không body → invalidate/lấy token anonymous mới. 401 protected request làm mất CSRF/phát sự kiện hết phiên; 401 login không tự phát sự kiện này. `client.js` nối singleton ApiClient với event cho App.

### Backend và password

- `SecurityConfig`: public hiện chỉ health, CSRF và login; các request còn lại yêu cầu authentication. Spring Security xử lý form login/logout. `AuthController` chỉ khai báo GET CSRF và GET me, chưa có đăng ký.
- `UserRepository implements UserDetailsService`: truy vấn tham số hóa email đã `trim().toLowerCase(Locale.ROOT)`. Không có user thì ném `UsernameNotFoundException`. `exists(UUID)` chỉ kiểm tra user còn tồn tại/enabled, không phải kiểm tra email trùng.
- PasswordEncoder bean là `BCryptPasswordEncoder(12)`. Luồng Spring Security dùng user details và encoder; integration test dùng hash do encoder tạo, xác nhận login đúng/sai. Chưa có registration service hoặc public insert-user API.
- `PortalUser` có UUID, email, displayName, hash và enabled. `UserView` chỉ trả `id`, `email`, `displayName`; không trả hash/password. Authorities trực tiếp rỗng; OWNER/EDITOR/VIEWER được quyết định bởi membership dự án.
- Login thành công trả JSON user, login sai/disabled trả 401 `INVALID_CREDENTIALS`. Login và logout vẫn yêu cầu CSRF. Logout invalidate session, xóa `JSESSIONID`, trả 204.
- Session fixation/CSRF mặc định của Spring Security được giữ; không cấu hình stateless hoặc tắt CSRF. `application.yml`: timeout 30 phút, cookie-only, HttpOnly, SameSite=Lax, secure mặc định true.
- `ActiveAccountFilter` lookup enabled/existence trước protected handler. Disabled/deleted: 401 `ACCOUNT_DISABLED`, invalidate session/xóa cookie. DB lỗi: 503 `AUTH_UNAVAILABLE`, fail closed nhưng giữ session. Health/CSRF/login/logout được bỏ qua lookup kể cả khi có principal disabled.
- `LocalDemoUsers` chỉ seed ở profile local khi có cấu hình riêng; dùng encoder và `ON CONFLICT (email) DO NOTHING`. Đây không phải đăng ký. Giới hạn password của seed không tự trở thành policy registration.

Bốn API auth hiện có: GET CSRF, POST form login, GET me, POST logout. Các API project/membership/upload/FileVersion/handover đều phụ thuộc principal UUID/session, nên phải giữ nguyên auth semantics khi thêm registration. Đăng ký tương lai không được tự login hoặc tự gán role dự án.

## 3. Database và email trùng

Đã đọc V1 và đối chiếu catalog trên PostgreSQL thử nghiệm riêng sau verify. Hiện chỉ có migration `V1__initial_schema.sql`; Flyway trên DB thử nghiệm báo version 1 / initial schema / success=true. Không đọc database thật hoặc user data thật.

| app_users | Cấu trúc/ràng buộc |
|---|---|
| id | UUID, PRIMARY KEY, NOT NULL, không có default sinh UUID |
| email | VARCHAR(254), NOT NULL, CHECK bằng lower(email), UNIQUE `uq_user_email` |
| display_name | VARCHAR(100), NOT NULL, CHECK length(trim(display_name)) > 0; không UNIQUE |
| password_hash | VARCHAR(100), NOT NULL; không CHECK định dạng hash |
| enabled | BOOLEAN NOT NULL DEFAULT true |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() |

DB chỉ bắt email lowercase, không tự trim/kiểm tra định dạng email. Lookup Java đã trim/lower; public create sau này phải normalize nhất quán. Unique constraint bảo vệ cả ghi đồng thời; pre-check email đơn thuần không đủ. Hiện chưa có exists-by-email/public duplicate-registration handler. `ApiExceptionHandler` chỉ map `DataIntegrityViolationException` chung thành 409 `DATA_CONFLICT`, chưa có mã riêng cho email trùng.

Tên tài khoản trong yêu cầu là tên hiển thị, khớp `display_name`; không có username đăng nhập riêng. Các bảng project, membership, file metadata/version, upload session, handover/recipient và audit tham chiếu UUID user. Bốn trường UI hiện không đòi migration: displayName/email/hash đã có, confirmPassword không cần lưu. Không sửa V1; chỉ cân nhắc migration mới nếu thiết kế tiếp theo chứng minh có dữ liệu mới cần lưu.

## 4. File dự kiến cho task tiếp theo

Đây là phạm vi dự kiến cần chốt ở C09-R01, không phải phê duyệt sửa code trong R00. Tên file mới dưới đây là đề xuất.

| File/khu vực | Lý do dự kiến |
|---|---|
| `frontend/src/App.jsx` | State chuyển login/register cùng khung; không đổi URL; giữ bootstrap/expiry/Portal isolation |
| `frontend/src/RegistrationForm.jsx` (mới nếu tách form) | Bốn trường, validation, busy/error/success/focus; thành công quay về login |
| `frontend/src/registration.js` (mới) | Helper dùng api.request có sẵn; không tự login/retry POST |
| `backend/.../auth/RegistrationController.java`, `RegistrationService.java`, `RegistrationDtos.java` (mới) | Endpoint/validation/hash/persistence theo contract đã duyệt; không tạo login session |
| `backend/.../auth/UserRepository.java` | Thêm persistence/duplicate email; giữ lookup đăng nhập và exists(UUID) |
| `backend/.../auth/SecurityConfig.java` | Permit đúng endpoint mới nếu duyệt; giữ CSRF/session và matcher hiện có |
| `contracts/openapi.yaml`, `contracts/examples/` | Schema/payload/status/error/examples của registration, giữ contract cũ |
| `frontend/tests/endpoint-trace.json` | Trace endpoint mới tới controller/caller/test thực |
| Frontend unit/browser và backend registration/integration/contract tests | Thêm success, failure, boundary/type, duplicate/concurrency, CSRF, không auto-login; giữ assertions cũ |

Chỉ cân nhắc nếu có căn cứ: `frontend/styles.css` (ưu tiên tái sử dụng), `frontend/src/api.js` (mapping message mới, không thay core request/CSRF/authEpoch), `ActiveAccountFilter.java` (policy registration với principal cũ). Chưa có lý do bắt buộc sửa `client.js`, GET AuthController, dependency hoặc schema.

`frontend/tests/contract.test.js` đối chiếu exhaustive mọi operation với endpoint-trace; thêm endpoint phải bổ sung trace. Backend ContractTest yêu cầu OpenAPI resolve đúng và có `x-implementation-status`; không xóa assertions để contract mới PASS.

## 5. Thành phần phải giữ nguyên

- Form-encoded login, cookie/session/CSRF rotation, disabled-account fail closed và stale-response isolation. Không public toàn bộ /auth/**, tắt CSRF hoặc chuyển JWT/localStorage.
- UUID/UserView/role membership và isolation giữa tài khoản/dự án. Registration thành công chỉ quay về login; không auto-login hoặc gán membership.
- Password/confirmPassword không được log/trả về/lưu plaintext. Dùng encoder hiện có; confirmPassword không phải cột DB.
- SHA-256, upload session/polling, exact S3 Version ID, FileVersion selection, AVAILABLE khác VERIFIED và toàn bộ handover semantics.
- Giữ protected helpers upload/files/handover/rules, backend/domain code/test, V1/Flyway, config, OpenAPI, manifest/lockfile, AWS/infra/deploy/ops/nextcloud/workflow trong R00.
- Không sửa/skip/giảm test assertions. Không sửa evidence cũ hoặc worktree khác. Chỉ tài liệu này được thêm vào Git.

## 6. Baseline test thực tế

Windows 11; Maven Wrapper thực chạy Apache Maven 3.9.12. POM target Java 21; máy chạy Temurin JDK 25+36, javac main/test ghi `release 21`. Chưa chạy lại trên JVM Java 21 trong R00. Frontend yêu cầu Node >=22.12.0, thực chạy Node 24.15.0 và npm 11.12.1.

Backend dùng PostgreSQL 17-alpine mới, container tên/label riêng, port random chỉ bind 127.0.0.1, dữ liệu tmpfs, không mount dữ liệu máy. Credential sinh tạm trong bộ nhớ và chỉ truyền cho process con. RUN_DB_TESTS=true chỉ bật sau khi có DB disposable; không dùng DB thật/chung. Sau test và đọc schema, đã xác minh ownership label và xóa đúng container/dữ liệu task. S3 adapter production bị tắt; storage integration là fixture, không phải AWS.

| Lệnh/thư mục | Kết quả thực chạy | Failure/error/skip |
|---|---|---|
| backend: `.\mvnw.cmd -B -ntp verify` | PASS / BUILD SUCCESS / 63 tests | 0/0/0 |
| frontend: `npm ci` | PASS; 110 package từ lock; npm báo 0 vulnerabilities | Không phải test suite |
| frontend: `npm run lint` | PASS / exit 0 | Không phải test suite |
| frontend: `npm test` | PASS / 33 tests | 0 fail, 0 skip/cancelled/todo |
| frontend: `npm run build` | PASS / exit 0 | Không phải test suite |
| Browser mock / real browser / business browser | NOT_RUN trong R00 | Không dùng lần chạy lịch sử làm evidence mới |
| Full pre-AWS runner / Python offline / Java-Python runner riêng | NOT_RUN trong R00 | Ngoài baseline bắt buộc R00 |
| AWS S3/Lambda E2E | NOT_RUN | Không gọi hoặc triển khai AWS |

Backend suites: ActiveAccountFilterTest 3; BackendIntegrationTest 11; ContractTest 5; HandoverIntegrationTest 22; S3StorageAdapterTest 6; UploadIntegrationTest 16. Tổng 63, không integration suite nào bị skip.

Auth tests hiện có kiểm tra login đúng/sai/thiếu CSRF, anonymous/authenticated me, logout/invalidate, disabled existing sessions và DB outage. Frontend unit kiểm tra form serialization/cookie jar/rotated CSRF, 401/403/503, concurrent bootstrap, stale 401, network/timeout/invalid response và không retry mutation. Đã đọc auth/live browser tests để xác định tác động, không tuyên bố đã chạy browser trong task này.

Evidence mới, bị Git ignore và không commit, ở `runtime-data/c09-r00-20261111-4b79f5f3a4/` của worktree mới:

- `backend-result.json`, `backend-verify.log`, `database-schema.txt`.
- `frontend-result.json`, `npm-ci.log`, `frontend-lint.log`, `frontend-test.log`, `frontend-build.log`.
- `java-version.log`, `maven-version.log`, `node-version.log`, `npm-version.log`.
- `tracked-baseline.json`, `safety-verification.json`.

## 7. Rủi ro và điểm cần chốt

1. Chốt normalize email/validation format/độ dài, mã duplicate và xử lý unique violation theo đúng constraint; không map mọi DB error thành email trùng. Cần test race đăng ký cùng email.
2. Chốt policy password và ngưỡng 72 UTF-8 bytes của BCrypt, gồm tiếng Việt/emoji; không tự lấy policy seed local làm policy registration. Chốt confirmPassword/payload/status/error ở C09-R01.
3. Registration cần anonymous CSRF nhưng không tạo principal; quyết định rõ khi đã có session hoặc principal disabled. Không làm thay bootstrap/logout public hiện tại.
4. POST timeout có thể đã tạo user; không tự retry hoặc chắc chắn báo chưa tạo khi chưa biết kết quả. Ngăn double submit/late response và xóa password khi chuyển form/account.
5. Contract/endpoint trace phải đồng bộ, tuân thủ review contract theo PRINCIPLE.MD ở task thay đổi API sau này.
6. JVM 21 runtime chưa được chạy lại trong R00. Có cảnh báo Byte Buddy dynamic agent và npm cảnh báo ESLint pinned hết hỗ trợ, nhưng test/lệnh đều exit 0. Không nâng cấp thư viện hoặc sửa source để che cảnh báo; giữ rõ giới hạn môi trường khi nghiệm thu release sau này.
7. Chưa có public registration API/service/test, nên baseline PASS không chứng minh registration/email duplicate qua API hoặc AWS E2E đã đạt. Audit không tự thêm nghiệp vụ ngoài bốn trường đã yêu cầu.

## 8. Điều kiện bắt đầu C09-R01

Baseline bắt buộc đạt, đủ điều kiện kỹ thuật để owner giao **C09-R01 riêng**. Cần chốt contract/payload/validation/mã lỗi, duplicate race, session/CSRF và phạm vi file được phép sửa trước khi triển khai. Tiếp tục từ branch này khi sạch sau commit tài liệu; recheck HEAD/base, không tự merge/rebase nếu có thay đổi.

Chỉ commit local file `docs/registration/C09-R00-audit.md` sau review nội dung, diff check và scope check, message `docs(registration): audit auth baseline C09-R00`. Không push/PR/merge, không implementation registration và không bắt đầu R01 trong task này.
