# C09-R08 — Final regression, diff audit và PR readiness

## A. General Information

| Mục | Giá trị |
| --- | --- |
| Task | C09-R08; independent final review R00–R07, cập nhật tài liệu và PR draft local |
| Repository | Chien2k5/cloud-document-handover; origin đã đối chiếu đúng repository |
| Worktree | `D:/cloud-document-handover-registration` |
| Branch | `task/C09-registration` |
| Initial base | `d7b23139e0cb945a414caa42c9a7eb29676edd7e` |
| Source HEAD trước R08 | `1bfd9a4024039485e9e1f8405ab6c573a9c98d0f` (R07) |
| Target | `dung`; không đổi local branch dung |
| Ngày kiểm tra | 2026-11-11, Asia/Saigon |
| Preflight | Đúng root/branch/HEAD; working tree/index sạch; không untracked hoặc conflict trong worktree registration |

Phạm vi R08 chỉ ba README và hai tài liệu R08. SHA commit tài liệu R08 được ghi ở
output cuối, không tự tham chiếu trong file này. Không push, tạo PR thật, merge,
rebase, cherry-pick, deploy hoặc sử dụng AWS. Working tree gốc có dữ liệu riêng
được đối chiếu hash, không sửa/chuyển branch tại đó.

## B. Feature Summary

Guest mặc định Đăng nhập; chọn Đăng ký chuyển form trong cùng Card, không route mới,
đổi URL hoặc reload. Bốn trường displayName/email/password/confirmPassword được client
kiểm tra rồi gửi JSON + cookie/CSRF. Chỉ HTTP 201 với User hợp lệ mới báo thành công,
quay về Login, điền email và xóa password; người dùng chủ động đăng nhập sau đó.

Backend DTO strict string/required/null/unknown-field validation; service chuẩn hóa
email bằng trim/lowercase Locale.ROOT, strip tên, giữ nguyên password. Encoder BCrypt
cost 12 hiện có tạo hash trước transaction INSERT UUID. Parameterized SQL và unique
constraint `uq_user_email` hiện có chống duplicate/race; chỉ conflict đúng email thành
409, không ghi đè hoặc re-enable account disabled. PostgreSQL không nhận plaintext
password/confirmation; không tạo project/membership mặc định hoặc principal đăng nhập.

OpenAPI và endpoint trace đồng bộ controller/caller/integration test. Login tiếp tục
form-urlencoded, logout không body; CSRF/session/protected API giữ cơ chế hiện có.

## C. Commit Audit

Đọc history, file list và patch của cả tám commit theo thứ tự; mỗi commit một parent,
không accidental merge hoặc commit ngoài task. Số file theo từng commit không cộng
thành số file unique của full diff.

| Task | Commit SHA | Files Changed | Status |
| --- | --- | ---: | --- |
| R00 | `361bcbb9ae5a9253170a5b84a4032529349586f1` | 1 | PASS |
| R01 | `6469a752146d36dc19854c0613da4728b783a89b` | 3 | PASS |
| R02 | `55b1ec62db14d400e02d87ebec3eb596fd3a2331` | 4 | PASS |
| R03 | `3f002f178082723809b99140e9e237fc3b9552c5` | 5 | PASS |
| R04 | `6eb9a029aeaab7e97707cccbc7d715b3b3ca9a77` | 3 | PASS |
| R05 | `8c0353962a49b25471aca10c4a95ec2e9f10c93b` | 9 | PASS |
| R06 | `2f6d214ae78053df453e2e99d861f3607ce955e6` | 2 | PASS |
| R07 | `1bfd9a4024039485e9e1f8405ab6c573a9c98d0f` | 3 | PASS |

Marker scan toàn commit range không phát hiện AWS access ID, private key hoặc GitHub
token; review giá trị password/token thêm vào source xác định là fixture/example,
không credential runtime. Không có dump, artifact build, runtime file, dependency,
cloud/deploy config hoặc migration trong range. Đây không phải bảo đảm phát hiện mọi
định dạng secret có thể có. Không rewrite hoặc squash history.

## D. Full Diff Audit

Đã fetch `origin/dung` trước audit và sau regression. Cả hai lần:

- `origin/dung` và FETCH_HEAD: `d7b23139e0cb945a414caa42c9a7eb29676edd7e`.
- Merge base với source R07: `d7b23139e0cb945a414caa42c9a7eb29676edd7e`.
- `HEAD..origin/dung` rỗng: không có base commit chưa tích hợp.
- Full diff `origin/dung...R07`: **28 file = 15 added + 13 modified + 0 deleted**;
  3374 insertion, 13 deletion. `git diff --check` PASS.
- Candidate gồm tài liệu R08: **33 file = 17 added + 16 modified + 0 deleted**.
  R08 chỉ sửa 3 README, thêm 2 report; không đổi source/test/contract.
- Out-of-scope changes: **NO**. Không có file cần REVIEW_REQUIRED chưa giải thích.

Danh sách đầy đủ dưới đây dùng đường dẫn từ repo root. A = added, M = modified.

### Authentication Backend (1)

- M `backend/src/main/java/vn/edu/uet/handover/auth/AuthController.java` — R03 endpoint mỏng, trả 201 UserView.

### Registration DTO/Service/Repository (3)

- A `backend/src/main/java/vn/edu/uet/handover/auth/RegistrationRequest.java` — R01 input validation.
- A `backend/src/main/java/vn/edu/uet/handover/auth/RegistrationService.java` — R02 normalization/hash/transaction.
- M `backend/src/main/java/vn/edu/uet/handover/auth/UserRepository.java` — R02 lookup và targeted conflict INSERT.

### Security configuration (2)

- M `backend/src/main/java/vn/edu/uet/handover/auth/SecurityConfig.java` — R03 chỉ public POST register, CSRF giữ nguyên.
- M `backend/src/main/java/vn/edu/uet/handover/auth/ActiveAccountFilter.java` — R03 ngoại lệ public đúng POST/path; protected lookup vẫn fail closed.

### Frontend UI (2)

- M `frontend/src/App.jsx` — R04–R05 guest mode/form, async guard và success/error.
- M `frontend/styles.css` — R04 style giới hạn trong guest registration; không đổi workspace layout.

### Frontend API (1)

- M `frontend/src/api.js` — R05 POST register, exact 201 User validation, contextual error; không retry.

### OpenAPI/Contract (2)

- M `contracts/openapi.yaml` — R05 operation register/request/status/CSRF và bỏ câu login phủ nhận registration.
- M `frontend/tests/endpoint-trace.json` — R05 đúng một trace đăng ký mới.

### Backend tests (6)

- M `backend/src/test/java/vn/edu/uet/handover/ActiveAccountFilterTest.java` — R03 thêm cases, giữ test cũ.
- A `backend/src/test/java/vn/edu/uet/handover/RegistrationHttpIntegrationTest.java` — R03 HTTP/full security chain.
- A `backend/src/test/java/vn/edu/uet/handover/RegistrationSecurityRegressionTest.java` — R06 boundary/session/log security.
- A `backend/src/test/java/vn/edu/uet/handover/auth/RegistrationRequestTest.java` — R01 DTO/Jackson/Unicode boundaries.
- A `backend/src/test/java/vn/edu/uet/handover/auth/RegistrationServiceTest.java` — R02 validation/hash/commit failures.
- A `backend/src/test/java/vn/edu/uet/handover/auth/RegistrationPersistenceTest.java` — R02 PostgreSQL race/rollback/integrity.

### Frontend tests (7)

- M `frontend/tests/api.test.js` — R05 thêm registration API cases; toàn nội dung cũ giữ nguyên prefix.
- M `frontend/tests/contract.test.js` — R05 thêm registration contract; assertions cũ giữ nguyên prefix.
- A `frontend/tests/registration-regression.test.js` — R07 CSRF bootstrap/epoch/Unicode/error isolation.
- M `frontend/e2e/backend.live.spec.js` — R05 thêm real registration vào auth test; các checks cũ giữ nguyên.
- A `frontend/e2e/registration-ui.spec.js` — R04–R05 same Card/validation/keyboard/responsive.
- A `frontend/e2e/registration-api.spec.js` — R05 mock HTTP/CSRF/status/uncertain outcome.
- A `frontend/e2e/registration-regression.spec.js` — R07 race/stale responses/isolation/negative boundaries.

### Documentation (9, gồm 5 file R08)

- A `docs/registration/C09-R00-audit.md` — R00 baseline, giữ nguyên.
- A `docs/registration/C09-R01-contract.md` — R01 thiết kế tại thời điểm đó, giữ nguyên.
- A `docs/registration/C09-R06-security-review.md` — R06 security findings/evidence, giữ nguyên.
- A `docs/registration/C09-R07-frontend-review.md` — R07 coverage/regression, giữ nguyên.
- M `README.md` — R08 mục C09 hiện hành và links.
- M `frontend/README.md` — R08 hướng dẫn flow/troubleshooting, bỏ nhận định registration chưa có.
- M `backend/README.md` — R08 JSON fields/status/CSRF/persistence và API table.
- A `docs/registration/C09-R08-final-review.md` — R08 báo cáo này.
- A `docs/registration/C09-R08-pr-draft.md` — R08 nội dung PR local để chủ dự án review.

Portal component và phương thức API login/logout được đối chiếu source với base,
giữ nguyên. Các module upload/hash/exact Version ID/FileVersion/handover/authorization,
config/dependency/schema và tài liệu lịch sử không nằm trong diff implementation.
Hash baseline bảo vệ toàn bộ 296 tracked file ngoài ba README trong R08; hai file mới
chỉ là tài liệu. Không xóa, skip hoặc nới assertion cũ để đạt PASS.

## E. Functional Verification

| Yêu cầu | Bằng chứng R08 và kết quả |
| --- | --- |
| Registration/201 | Real UI → Vite → Spring → PostgreSQL tạo user; response đúng id/email/displayName; PASS. |
| Login/logout | User mới explicit login thành công, CSRF rotate, logout 204 và auth/me401; live + HTTP + mock PASS. |
| CSRF/session | Header động, same-cookie session; thiếu/sai/token khác session bị403; existing session/account không bị thay thế; backend security tests PASS. |
| Validation | Bốn field strict, unknown/null/type sai, tên/email boundary, min8 code point, max72 UTF-8 byte, exact confirm; backend/unit/mock PASS. |
| Duplicate/race | Normalized duplicate409; disabled account giữ nguyên; hai precheck cùng absent chỉ một winner; PostgreSQL tests PASS. |
| No auto-login | Sau201 không principal, auth/me401, UI không gọi login/me/logout tự động và password trống; real browser + HTTP PASS. |
| No default membership/project | DB counts trước/sau không tăng; user mới thấy project list rỗng và không truy cập workspace khác; PostgreSQL/live PASS. |
| Frontend async/errors | Pending chặn duplicate/mode switch; timeout/network không retry/không giả success; stale201/500 không ghi đè account mới; mock/unit PASS. |
| Permissions/integrity regression | OWNER/EDITOR/VIEWER, 401/403/404, SHA-256 bytes, exact S3 Version ID, selected FileVersion, handover và state isolation; full local suites PASS, không suy ra AWS PASS. |
| Keyboard/responsive | Labels/focus/Tab/Enter/Space, errors gắn input, không overflow375/768/1440; browser mock PASS. |

Đã đọc thêm PortalUser, ApiExceptionHandler và ui.jsx giữ nguyên: public User không
password/hash, error JSON code/message/requestId, sanitization không echo rejected
values; ErrorNotice chỉ refresh CSRF, không replay POST. Log-capture tests kiểm các
case201/400/409/injected500; không phải kiểm chứng mọi cấu hình logging bên ngoài.

## F. Testing Matrix — thực chạy R08

Source chạy full suite là R07 sạch, không dùng lại con số từ R07. R08 chỉ đổi tài liệu;
source/test/config được hash đối chiếu không đổi. Windows11, JDK Temurin25+36 compile
release21, Maven Wrapper3.9.12, Node24.15.0/npm11.12.1, Python3.13.13, Docker29.4.3,
Chrome có sẵn; PostgreSQL17-alpine container mới riêng cho từng live run.

| Test Category | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Backend verify / LOCAL_REAL_BACKEND | 268 | 268 | 0 | 0 |
| Backend verify / TEST_STORAGE (lượt riêng, cùng suite) | 268 | 268 | 0 | 0 |
| Frontend unit / UNIT_MOCK | 71 | 71 | 0 | 0 |
| Browser mock / BROWSER_MOCK (full suite) | 390 | 390 | 0 | 0 |
| Registration UI (focused, đã nằm trong full suite) | 27 | 27 | 0 | 0 |
| Registration API (focused, đã nằm trong full suite) | 23 | 23 | 0 | 0 |
| Registration regression (focused, lượt hoàn tất) | 34 | 34 | 0 | 0 |
| Auth (focused, đã nằm trong full suite) | 2 | 2 | 0 | 0 |
| Real browser / LOCAL_REAL_BACKEND | 3 | 3 | 0 | 0 |
| Business browser / LOCAL_REAL_BACKEND_WITH_TEST_STORAGE | 2 | 2 | 0 | 0 |
| PYTHON_OFFLINE | 27 | 27 | 0 | 0 |
| JAVA_PYTHON_CONTRACT | 29 | 29 | 0 | 0 |
| Pre-AWS full verification (aggregate gate) | 1 | 1 | 0 | 0 |

Không cộng các hàng thành tổng test unique: focused/full/aggregate lồng nhau; backend
suite chạy hai lần. AWS_REAL_E2E: **NOT_RUN**, không ghi AWS thành skipped/PASS.

Lệnh `python tools/run_preaws_checks.py` nguyên bản hoàn tất exit0 với
**PASS_PRE_AWS_CHECKS**, started `2026-11-11T08:37:31Z`, completed `2026-11-11T08:47:14Z`.
Runner thực thi `npm ci`, `npm run lint`, `npm test`, `npm run build` hai lần,
`npm run test:e2e`, `npm audit --json`, Python offline và Java/Python contract.
Lint/ci/build PASS; hai dist hash map trùng, hai production JAR SHA trùng
`e0547de5cb95b3b06f413b16c28471704d7409e9d53131ca877b877a6ecbe463`;
npm audit0 vulnerability.

Gate backend/live được chạy thực trong aggregate, không có một standalone verify
thứ ba: runner gọi `python frontend/tools/run_live_check.py --evidence ...` rồi
`--business --evidence ...`; mỗi lượt chạy Maven Wrapper `-B -ntp ... clean verify`
với RUN_DB_TESTS=true, database disposable và Mockito agent cache. XML sau build
được đối chiếu268/0/0/0. Browser ordinary không mock API; business dùng Spring thật
với HTTPS StoragePort fixture test-only, không S3/Lambda. Fixture không nằm trong
production JAR. Hai container `handover-frontend-test-9b90f55ee7` và
`handover-frontend-test-13489e26e1` đã remove; Docker inventory đối chiếu không còn.
Không dùng DB Nextcloud, shared/staging/production hoặc credential AWS.

Bốn lệnh focused được chạy riêng bằng `npx playwright test e2e/<spec>` với cổng test
trống do hệ điều hành cấp, chỉ thêm output path dưới runtime-data. Lần đầu của
registration-regression thoát trước dòng Running/tests: Windows exit3221226505
(0xC0000409), log chỉ có warning NO_COLOR/FORCE_COLOR của web server, không có tên
assertion thất bại hoặc tổng test. Chưa xác định nguyên nhân native exit; không gọi
đây là product assertion failure đã tái hiện. Giữ nguyên log/result lần đầu. Sau
aggregate kết thúc, chạy lại nguyên spec/config đạt34/34 exit0, auth2/2; full390 cũng
đã PASS ở lượt độc lập. Không sửa runner, fixture, expected count, timeout hoặc test.
Đây là gián đoạn tiến trình local đã có lượt xác minh lại thành công, không bị che
khỏi báo cáo. Không có gate FAIL chưa xử lý hoặc unexpected SKIP ở lượt hoàn tất.

Evidence local bị Git ignore, không commit raw log, screenshot, dump hoặc secret:

- `runtime-data/c09-r08-20261111-4e0837d0e8/`: preflight/hash/ref/commit/diff audit,
  preaws-runner.log, preaws-link.json, targeted-results.json (giữ lần lỗi),
  targeted-followup-results.json, từng targeted log, environment-and-cleanup.json,
  remote-state-final.json, staged/final guard evidence.
- `runtime-data/preaws-f3ec39e5b15c47518cf0ee2b74508951/`: verification.json,
  real-backend.json, business-storage.json và logs từng aggregate gate.
- `runtime-data/frontend-live-a3d9faad02/` và `runtime-data/frontend-live-01ab61a54c/`:
  backend-clean-verify.log, browser-live.log, source/hash/build/cleanup evidence.

## G. Security Review

Backend/frontend/contract review PASS trong phạm vi source và local cases đã chạy:
CSRF không bị tắt, BCrypt12, validation trước side effect, parameterized SQL, unique
email race, existing account/session/authorization isolation và sanitized errors.
Không phát hiện blocking production defect hoặc CRITICAL/HIGH mới trong audit này.
Không suy từ npm audit0 ra bảo mật ứng dụng toàn diện.

Giữ nguyên severity và trạng thái từ [R06](C09-R06-security-review.md):

| Finding | Severity | Nội dung | Status |
| --- | --- | --- | --- |
| R06-F01 | MEDIUM | Chưa application rate limit/chống đăng ký hàng loạt; BCrypt/INSERT public có nguy cơ abuse. | OPEN |
| R06-F02 | MEDIUM | Chưa xác minh quyền sở hữu email; account enabled không chứng minh danh tính email. | OPEN |
| R06-F03 | LOW | Response409 EMAIL_ALREADY_EXISTS khác201 cho phép dò email tồn tại. | OPEN |
| R06-F04 | LOW | Chưa công tắc bật/tắt registration riêng; chưa kiểm chứng control triển khai bên ngoài. | OPEN |

Tổng **0 CRITICAL / 0 HIGH / 2 MEDIUM / 2 LOW**. Không tự đánh dấu risk accepted hoặc
resolved, không thêm rate limit/email service/OTP/CAPTCHA/flag. Public exposure cần
chủ dự án quyết định chính sách và kiểm chứng lớp bảo vệ trước triển khai Internet.

Chưa xác minh load/abuse, email ownership/delivery, gateway/TLS/cookie/log ingestion
production, mọi URI canonicalization hoặc debug-log config, browser password manager
và việc thu hồi mọi bản sao password trong bộ nhớ. Không tuyên bố bảo mật tuyệt đối.

## H. Documentation Changes

| File R08 | Thay đổi | Lý do |
| --- | --- | --- |
| README.md | Mục C09 ngắn, feature branch/API/same Card/CSRF/BCrypt/no auto-login và links. | Chỉ rõ tính năng hiện hành và trạng thái review; không tuyên bố đã merge/production-ready. |
| frontend/README.md | Guest → bốn trường → confirmed201 → Login → explicit login; validation/CSRF/no storage/no retry và năm tình huống troubleshooting. | Hướng dẫn đúng implementation, bỏ riêng câu cũ phủ nhận đăng ký. |
| backend/README.md | JSON object/bốn string fields,201/400/403/409/415, headerName/cookie, normalization/BCrypt/no default membership và API row. | Mô tả endpoint thật, không thêm password ví dụ hoặc hướng dẫn deployment mới. |
| C09-R08-final-review.md | Audit toàn range, matrix R08, evidence/risk/decision. | Kết quả final review có thể đối chiếu. |
| C09-R08-pr-draft.md | Title/body/base/head/checklist/known risks/merge status. | Chủ dự án review local trước lệnh release riêng. |

Tài liệu R01 nói API chưa triển khai là snapshot đúng lúc R01; trạng thái hiện hành
đã triển khai ở R03–R05 được mô tả tại README/R08. Không sửa R00–R07, week01–05,
pilot, verification, evidence hoặc lịch sử của thành viên khác để đổi nghĩa quá khứ.
Không tuyên bố hỗ trợ reset password, email verification, OTP, Google Login/invitation.

## I. Remaining Limitations

- AWS_REAL_E2E **NOT_RUN**; local backend/storage fixture/Python offline không chứng minh IAM/CORS/S3/Lambda hoặc rollout trên AWS.
- Bốn rủi ro R06 vẫn OPEN; chưa có rate limit, email verification, registration enable flag; email enumeration còn tồn tại.
- Test thực trên JDK25 compile release21; Java21 runtime/Ubuntu Chromium CI chưa chạy trong R08 local. Không suy CI PASS từ local.
- Keyboard/responsive/console cases đã chạy không thay thế toàn bộ audit WCAG, manual UX hoặc các browser khác.
- Native process exit ban đầu của focused regression chưa có root cause; giữ log và rerun thành công, không đổi config để giấu lỗi.
- Branch protection, CI của PR tương lai và review của thành viên chưa được thỏa mãn bởi local tests. Theo PRINCIPLE.MD, chủ phần việc review, TV1 điều phối; OpenAPI cần TV2 và TV4 cùng duyệt trước merge. Target dung theo yêu cầu task; không chuyển sang main.

## J. Final Decision

**READY_FOR_LOCAL_PR_REVIEW** — git/history/full diff/backend/frontend/contract audit,
full local regression và documentation gates đạt trong phạm vi nêu trên. Không có
blocking defect đã xác định, không có base divergence chưa xử lý. Candidate chỉ gồm
feature C09 và năm tài liệu R08; không đổi protected source/test/config trong R08.

Acceptance: Git/root/branch/source HEAD/initial clean/fetch/history/diff PASS;
backend validation/persistence/BCrypt/duplicate/CSRF/session/no auto-login/no membership
PASS; frontend same Card/four fields/URL/validation/errors/pending/double submit/password
handling/login/logout PASS; contract/trace/request/response PASS; full test/cleanup
PASS; documentation/current-vs-historical consistency PASS; scope/secrets/diff checks
PASS. Commit local sau staged review, SHA và final clean status ghi ở output cuối.

**NOT_PUSHED — PR_NOT_CREATED — MERGE_NOT_APPROVED**.
Production deployment approved: **NO**. Chỉ chờ chủ dự án review tài liệu/source/test
evidence và cho phép bước GitHub riêng; R08 dừng tại đây.
