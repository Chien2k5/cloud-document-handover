# C09-UAT-FIX01 — Favicon và thông tin tài khoản

## 1. Phạm vi và Git baseline

- Ngày: 2026-11-11 (Asia/Saigon).
- Repository: Chien2k5/cloud-document-handover.
- Worktree: `D:/cloud-document-handover-registration`.
- Branch: `task/C09-registration`.
- Base/source HEAD trước FIX01: `52d896332950e756d30af37a0ecf03294ede658e`.
- Preflight: đúng root/branch/HEAD, working tree/index sạch, không untracked hoặc conflict.
- Chỉ bảy file dưới đây; SHA commit FIX01 ghi ở output cuối để tránh self-reference.

| File | Thay đổi |
| --- | --- |
| frontend/public/favicon.ico | Asset CH mới, ICO bảy kích thước. |
| frontend/index.html | Thêm rel=icon /favicon.ico, giữ title/meta/React entrypoint. |
| frontend/src/AppShell.jsx | Panel account chỉ đọc và copy user.id; giữ sidebar/navigation/logout. |
| frontend/styles.css | 12 dòng CSS scope account profile, không đổi theme/global font/spacing. |
| frontend/e2e/account-profile-favicon.spec.js | 18 E2E mới; không sửa tests/fixtures/config cũ. |
| docs/registration/C09-UAT-FIX01-review.md | Báo cáo kiểm chứng này. |
| docs/registration/C09-R08-pr-draft.md | Chỉ append Post-R08 Manual UAT Improvements, giữ nguyên nội dung R08. |

Backend, schema, auth/CSRF/session, API client, App.jsx, contract, cloud, dependencies,
config và mọi báo cáo R00–R08 cũ ngoài PR draft được giữ nguyên từng byte. Không tạo
API/route profile, đổi authorization, tạo UUID frontend hoặc thêm browser storage.

## 2. Nguyên nhân và favicon asset

HTML cũ không khai báo icon; public/favicon.ico chưa tồn tại nên Chrome tự request
/favicon.ico và nhận404. C08 cũng thiếu asset: đây là lỗi static asset có từ trước.

Hai đường dẫn ICO/PNG ban đầu người dùng nêu không tồn tại, đã tìm đúng tên trong
attachments/Downloads/dự án mà không thấy. Người dùng sau đó xác nhận chưa tải file
và yêu cầu thêm vào; đã thông báo sẽ tạo CH theo branding hiện có. **Không tuyên bố
đã copy một file đính kèm không tồn tại.** Asset được tạo local bằng Pillow có sẵn,
dựa trên nền CSS #2563eb, chữ CH trắng Segoe UI Bold và góc bo; không icon Internet,
CDN, data URL, SVG/PNG tracked hoặc dependency mới. Ảnh preview chỉ nằm trong runtime-data.

- ICO reserved=0, type=1, count=7; sizes16/24/32/48/64/128/256px.
- 21061 bytes; SHA256 `d7c2e0752d1696ff270fbc1ab156860fa3d1f98711ff0c4c4b90148e96989892`.
- Pillow decode và binary entry offsets/PNG payload được kiểm chứng.
- HTML: `<link rel="icon" type="image/x-icon" href="/favicon.ico" />`.
- Request qua Vite thực trả200; body trùng hoàn toàn bytes ICO trong public, không HTML fallback.
- Kiểm ở guest Login/Register và authenticated workspace; không favicon404 mới.
- Hai build frontend có dist hash map trùng; build giữ asset ICO dưới đường dẫn public.

## 3. UUID và profile/copy behavior

Panel lấy nguyên `user.displayName`, `user.email`, **`user.id`** từ user đang authenticated,
đã có qua flow login/auth/me hiện hành. Không dùng project/membership ID, không sinh
id mới, không dùng email hoặc hardcode fixture trong production. AppShell gọi
AccountProfile key=user.id; Portal vốn key theo user.id. Logout/session expiry unmount
profile, account mới không nhận panel/notice cũ.

Nút Thông tin tài khoản nằm gần identity và logout. Panel nhỏ có heading/dl/readonly
UUID textarea, không route/hash mới, reload hoặc API call khi mở/đóng/copy. UUID có
thể wrap; focus textarea tự select nguyên chuỗi để copy thủ công. Panel không modal,
không chặn background bằng overlay hoặc focus trap; nút đóng chính là disclosure toggle.

Copy chỉ gọi `navigator.clipboard.writeText(user.id)`, giữ dấu gạch, không prefix/space.
Pending guard chặn click lặp, không báo thành công sớm. Success: `Đã sao chép UUID.`
(role=status). Missing/denied/rejected Clipboard: `Không thể sao chép tự động. Vui lòng
chọn UUID và sao chép thủ công.` (role=alert), UUID vẫn đọc/chọn được. Sequence guard
bỏ notice muộn sau đóng panel hoặc unmount/đổi account; không khẳng định hủy được
clipboard operation đã gửi cho browser.

Keyboard Enter/Tab/Space của native buttons, Escape đóng và trả focus về trigger;
aria-expanded/controls, accessible labels, readonly field và focus ring hiện có.
Không dùng màu làm tín hiệu duy nhất. Responsive375/768/1440 đã kiểm bounds/no overflow,
copy/logout/sidebar toggle và navigation; không đổi logo/header/sidebar hiện có ngoài
bố trí thêm control account cần thiết.

## 4. Coverage E2E mới — 18 tests

Các API fixture là BROWSER_MOCK; favicon luôn được phục vụ bởi Vite thật. Clipboard
success/failure/missing/pending được kiểm soát trong riêng browser context, không
đổi security settings toàn hệ thống.

| Cases trong yêu cầu | Bằng chứng |
| --- | --- |
| F01–F06/P01 | Guest Login/Register: link đúng,200, ICO entries/payload/body equality; không profile hoặc mutation. |
| F07/P02–P08/P12–P13 | Auth profile: exact name/email/id khác Project ID, mở lại id ổn định, URL và API call list không đổi. |
| P09 | Reload session còn hợp lệ: cùng User UUID, panel khởi đầu đóng. |
| C01–C06/C09–C10 | Clipboard nhận duy nhất nguyên user.id, success role=status, không storage/API/navigation/reload. |
| C07–C08 | Hai cases denied và unavailable: alert đúng, không success, readonly UUID select được nguyên chuỗi. |
| Async copy | Pending không double-submit/early success; đóng panel bỏ late notice. |
| Accessibility | Enter/Tab/Escape, focus visible, manual selection; Tab thoát panel tới logout, không trap. |
| P10–P11/R06–R07 | Logout bỏ UUID cũ; login account khác hiển thị UUID mới; late copy account cũ không ảnh hưởng account mới. |
| Session expiry | Backend me401 sau reload trở về guest, không còn profile/UUID cũ. |
| R09/permissions | Ba roles OWNER/EDITOR/VIEWER mở profile và project → overview → projects được. |
| R01–R05/R09–R10 | Ba viewport375/768/1440, long name/email, panel bounds/copy/logout/sidebar/logo/nav/console. |
| R08 | Registration201 không auto-login; explicit login rồi profile đúng backend fixture User ID. |

Lượt focused đầu15 PASS/3 FAIL do test mới dùng ID không tồn tại `workspace-overview`.
Snapshot cho thấy ứng dụng đã mở Tổng quan dự án đúng; sửa selector của **test mới**
sang ID thực `project-overview`, giữ nguyên yêu cầu visible/navigation. Chạy lại18/18
PASS rồi full408 PASS. Không sửa test cũ hoặc production để che failure này.

## 5. Tests thực chạy FIX01

| Gate | PASS | FAIL | ERROR | SKIP | Mức bằng chứng |
| --- | ---: | ---: | ---: | ---: | --- |
| Frontend unit | 71 | 0 | 0 | 0 | UNIT_MOCK |
| New focused E2E | 18 | 0 | 0 | 0 | BROWSER_MOCK + favicon HTTP thật |
| Existing auth E2E riêng | 2 | 0 | 0 | 0 | BROWSER_MOCK |
| Existing registration UI/API/regression riêng | 27/23/34 | 0 | 0 | 0 | BROWSER_MOCK |
| Full browser E2E | 408 | 0 | 0 | 0 | 390 cũ +18 mới, BROWSER_MOCK |
| Backend clean verify, mỗi lượt (2 lượt) | 268 | 0 | 0 | 0 | PostgreSQL disposable riêng |
| Real browser runner | 3 | 0 | 0 | 0 | LOCAL_REAL_BACKEND |
| Business browser runner | 2 | 0 | 0 | 0 | LOCAL_REAL_BACKEND_WITH_TEST_STORAGE |
| Python offline | 27 | 0 | 0 | 0 | PYTHON_OFFLINE |
| Java/Python contract | 29 | 0 | 0 | 0 | JAVA_PYTHON_CONTRACT |
| Additional localhost profile scenario | 1 | 0 | 0 | 0 | Chrome + Spring + UAT PostgreSQL + Clipboard thật |

Lint/build PASS cả standalone và aggregate. `python tools/run_preaws_checks.py`
nguyên bản: **PASS_PRE_AWS_CHECKS**, started2026-11-11T10:11:41Z,
completed2026-11-11T10:18:49Z. npm ci PASS; npm audit0 vulnerability. Dist hashes hai
build bằng nhau; JAR hashes hai backend build bằng nhau. Backend XML được đối chiếu
268/0/0/0. Backend verify/live thực thi trong aggregate, không có standalone Maven
verify thứ ba: runner gọi Wrapper `-B -ntp ... clean verify` với RUN_DB_TESTS=true
và DB riêng, sau đó chạy3 live/2 business browser. Không đổi expected count/runner/spec.
Các hàng subset/aggregate lồng nhau, không cộng thành tổng test unique.

Source snapshot khi chạy aggregate là base52d8963 + code/test FIX01 chưa commit,
workingTreeDirty=true đúng thực tế. Sau tests chỉ thêm report/append PR draft; code,
asset, test và config được hash đối chiếu không đổi trước commit.

Pre-AWS lần đầu dừng ở npm ci EPERM unlink Rolldown native binding do Vite đang giữ
DLL. Giữ log thất bại, không audit fix/đổi lockfile/runner. Đã đối chiếu PID/path và
dừng đúng preview C09 cùng process Vite test R08 còn sót; npm ci lần sau PASS, rồi
mở lại preview ngay sau bước ci. Đây là lỗi khóa file môi trường đã xử lý, không
xóa hoặc làm yếu test. C08 và các project/worktree khác giữ nguyên.

## 6. Kiểm tra localhost thật và dữ liệu UAT

Tại `http://127.0.0.1:5189`, proxy `http://127.0.0.1:8082`, Chrome thật headless không
API mock: tạo riêng một account smoke bằng POST register201; auth/me vẫn401 trước
explicit login. Sau login, profile id được so với auth/me **và app_users PostgreSQL**;
email/name/enabled/BCrypt12 đúng, không membership/project mặc định. Copy dùng Clipboard
API thật với permission giới hạn ở test context/origin; read-back đúng UUID, không
API thêm hoặc URL change. Reload cùngUUID; logout guest không UUID và auth/me401.
Không password/cookie/token/hash được ghi vào report hoặc runtime results.

Screenshot real-profile1440/768/375 được review; không overflow, copy/logout/navigation
vẫn thao tác được. Browser console không còn favicon404/JS/CSS/proxy errors trong case.
Đây là **automated verification tại manual localhost**, không phải chủ dự án đã tự
thực hiện/approve UAT. MANUAL_UAT_APPROVED: chưa có; PENDING_USER_REVIEW.

Công cụ computer-use mở cửa sổ Chrome trực tiếp báo lỗi khởi tạo kernel assets (os3),
không điều khiển được cửa sổ để quan sát tab Chrome trực tiếp. Vì vậy kiểm chứng ở
đây là DOM/network/ICO decode và Chrome headless thật; chủ dự án kiểm icon trên tab
Chrome đang dùng, reload hoặc mở phiên mới nếu cache còn icon cũ. Không đổi source
để giấu lỗi công cụ này.

UAT database `handover-c09-uat-97f4eee7a413` được giữ nguyên, không TRUNCATE/DROP.
Trước FIX01 users2/projects1/memberships2; sau users3/projects1/memberships2: chỉ thêm
một account smoke riêng, không xóa/reset dữ liệu của người dùng. Test password ngẫu
nhiên chỉ ở memory, account smoke được giữ trong DB disposable và không đưa credential
vào báo cáo.

JAR UAT trước đó nằm trong backend/target bị JVM giữ khóa. Đã copy đúng checksum sang
runtime-data UAT rồi restart đúng process do task quản lý bằng JAR pin riêng; regression
clean/build không đụng JAR đang phục vụ. Backend source/DB/session config không sửa;
restart làm mất session memory cũ, người dùng có thể phải login lại. Preview5189 và
UAT8082/5175 đã mở lại; Docker container/dữ liệu UAT không bị xóa. C08 PID16232/5173
không bị dừng. Hai container PostgreSQL riêng do regression runner tạo đã remove,
được đối chiếu Docker inventory. Không sử dụng AWS hoặc DB production/staging/Nextcloud.

## 7. Evidence, giới hạn và Git integrity

Evidence local ignored: `runtime-data/c09-uat-fix01-b90f6f38dff3/`: baseline/ref/user-file
hashes, favicon-validation.json/preview, initial/focused logs, focused-results.json,
preaws-runner.log và preaws-runner-attempt2.log (giữ cả hai lần), preaws links,
real-uat-result.json/screenshots, test-and-cleanup-check.json và uat-preservation.json.
Aggregate evidence: `runtime-data/preaws-354ea652a6dc4456833ed5a92f55a20b/verification.json`;
real runner evidence ở frontend-live-88642b247b và frontend-live-40fe80696d. Không commit
runtime logs, screenshots, script, token, cookie, credential hoặc dump.

297 tracked file ngoài bốn existing files được phép giữ nguyên hash;7 untracked file
ở worktree gốc giữ nguyên; refs ngoài branch feature không đổi. PR draft cũ được giữ
nguyên prefix, chỉ append phần hậuR08. Không sửa báo cáo finalR08 hoặc lịch sử khác.
Diff check/secrets-marker/scope review trước local commit. Không push/PR/merge/deploy.

R06-F01 rate limiting MEDIUM OPEN, R06-F02 email ownership MEDIUM OPEN,
R06-F03 email enumeration LOW OPEN, R06-F04 registration switch LOW OPEN: không đổi
severity/status, không tự accept/resolve hoặc khẳng định production-ready. UUID nhìn
thấy không tự cấp quyền; backend authorization giữ nguyên và regression kiểm lại.

Giới hạn: AWS_REAL_E2E **NOT_RUN**; storage fixture không S3/Lambda/IAM/CORS thật.
Local JDK25 compile release21, không Java21 runtime/CI Linux mới; không toàn bộ audit
WCAG/browser/OS clipboard policies. Clipboard denial được kiểm qua fixture, success
được kiểm thêm bằng Clipboard thật. User manual approval vẫn chờ.

## 8. Kết luận

**PASS — READY_FOR_MANUAL_UAT**, trong phạm vi kiểm chứng nêu trên. Favicon asset/HTTP,
account profile exact backend User ID/stability, copy success/failure, no extra API/URL,
keyboard/responsive và regression gates đạt. Không blocking defect đã xác định.
Commit local sau staged review; SHA/final working-tree status được ghi ở output cuối.
**NOT_PUSHED — PR_NOT_CREATED — MERGE_NOT_PERFORMED.** AWS không sử dụng.
