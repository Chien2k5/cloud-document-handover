# C09-R07 — Frontend QA review

## A. Thông tin

- Task C09-R07; ngày 2026-11-11 (Asia/Saigon); repository Chien2k5/cloud-document-handover.
- Worktree D:/cloud-document-handover-registration; branch task/C09-registration; base 2f6d214ae78053df453e2e99d861f3607ce955e6 (R06).
- Preflight: đúng root/branch/HEAD; không staged/unstaged/untracked/unmerged; R00–R06 đều ancestors. Có hash baseline toàn bộ 296 tracked files và 7 untracked files của worktree gốc để kiểm tra bảo toàn.
- Scope: chỉ thêm frontend/tests/registration-regression.test.js, frontend/e2e/registration-regression.spec.js và báo cáo này; không sửa production/existing tests/config/backend/contract/cloud.
- Môi trường thực: Windows/PowerShell, Node 24.15.0, npm 11.12.1, Chrome 156.0.8078.80, PostgreSQL 17-alpine disposable; Temurin 25+36 compile release 21 theo POM. Không đổi dependency/runner/toolchain.
- Trạng thái: PASS sau toàn bộ gates thực chạy; commit local sau staged diff review.

## B. Coverage Matrix

Ma trận 189 scenario được lập trước implementation: **146 COVERED / 17 PARTIAL / 25 MISSING / 1 NOT_APPLICABLE**. Snapshot trước test ở coverage-initial.json. Targeted suites đã kiểm chứng các gaps; trạng thái hiện tại **188 COVERED / 0 PARTIAL / 0 MISSING / 1 NOT_APPLICABLE** trong các tình huống được liệt kê. Không suy rộng thành kiểm thử mọi input/timing/browser/môi trường.

Reference dưới root D:/cloud-document-handover-registration. Mỗi key dẫn tới file/title/assertion thật. MOCK_E2E chỉ chứng minh browser/client với mocked backend. REAL_E2E là existing live runner không đổi. BACKEND_POSTGRES là assertion HTTP/JDBC thật qua backend verify, không gọi là browser E2E. Ví dụ normalization email được kiểm chứng DB ở backend tests; mocked normalized response chỉ chứng minh frontend xử lý response đúng.

### Existing references

- **UI-default** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: defaults to unchanged login and switches within the same Card without navigation or new auth requests`. Assertion: Một form,2/4 inputs; headings/switch; document/card identity và href/path/search/hash/history unchanged; chỉ GET me.
- **UI-state** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: login and register states remain separate and all passwords disappear when leaving a mode`. Assertion: Quay lại mode password/confirmation rỗng; email riêng; type password; DOM bỏ password inputs không chứa giá trị; storage lengths0.
- **UI-fields** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: required labels, autocomplete, maxlength and accessible validation stay attached to the four inputs`. Assertion: Bốn accessible labels; field metadata; blank submit aria-invalid/describedby, role alert và focus lỗi đầu.
- **UI-length** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: maxlength blocks typing past name/email limits without truncating passwords`. Assertion: 100 name/254 valid email rồi thêm ký tự vẫn giữ giá trị cũ; password73byte không tự truncate.
- **UI-invalid** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: rejects ${scenario.name} locally and never calls registration`. Assertion: 10 case blank name/email/password,7-char,Unicode/ASCII73byte,confirmation; error text/aria-invalid; afterEach POST = 0.
- **UI-valid** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: valid ${name} submits once and returns to login only after confirmed 201`. Assertion: 5 boundary passwords; POST = 1; payload raw exact; login passwordempty; noPortal; URL/storage unchanged.
- **UI-enter** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: Enter on a valid register form does not navigate or submit a native password query`. Assertion: Enter submits POST = 1, status success, URL unchanged.
- **UI-errors** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: login errors and register validation never cross modes; login success and logout remain unchanged`. Assertion: Wrong login error; switch clears error; register errors không sang Login; login passwordempty.
- **UI-keyboard** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: switching and all four fields work with keyboard focus indicators`. Assertion: Enter/Space mode switch; focus initial; Tab qua4 fields/submit/switch; outlineStyle và width>0.
- **UI-responsive** [MOCK_E2E]: `frontend/e2e/registration-ui.spec.js` — `R04: the existing auth Card remains responsive at ${width}px`. Assertion: 375/768/1440; cùng Card dimensions; logo/h1; mọi input và submit scrollIntoView; boundingbox không tràn; scrollWidth<=innerWidth.
- **API-success** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: confirmed 201 returns to the same login Card with safe status at ${width}px`. Assertion: Status role; login emailnormalized/pwdempty;3request GETme/GETcsrf/POSTregister; noPortal/login; sameCard/document/URL; storage0.
- **API-pending** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: synchronous submit events and repeated clicks send one POST; no premature success or mode switch`. Assertion: Gated response;3sync submit events; POST = 1; busytext/disabledinputs/switch; no premature success; release→201/status1.
- **API-409** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: duplicate email stays on Register; only an explicit corrected submit retries`. Assertion: Exact409message; preserve name/email; passwords cleared; POST = 1 before action; corrected email explicitPOST = 2 success.
- **API-400** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: backend 400 preserves nonsensitive input and uses registration validation message`. Assertion: Register remains; safe400message; no success/Portal/retry; controls enabled; passwordsempty/name-email preserved.
- **API-403** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: 403 permits manual CSRF refresh without replay; manual submit uses new dynamic token`. Assertion: 403; refreshCSRF GET2 notPOST; manual next submit uses token2,POST = 2 success.
- **API-failures** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: ${status} does not authenticate, retry or lock navigation`. Assertion: 500/503/401 propermessage; form/controlsusable; passwords cleared; POST = 1, switch Login possible.
- **API-network** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: network loss leaves an uncertain outcome, clears passwords and never auto retries`. Assertion: Abortroute; uncertain networkmessage;POST = 1; enabled controls/passwordempty; switchLogin.
- **API-timeout** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: timeout is uncertain; a late 201 cannot change the returned login form`. Assertion: Clock passes20001ms; uncertaintimeoutmessage; noPOSTretry; switch/type otherLoginEmail; late201 cannot overwrite.
- **API-malformed** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: ${name} cannot falsely confirm registration`. Assertion: 200/wrongtype/missingdisplayName/extrahash: error, notsuccess/noPortal; POST = 1.
- **API-stale** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: stale ${status} after session expiry cannot overwrite another mode`. Assertion: Forced existing expiry event; late201/400 cannot replace LoginEmail or clear auth error; no login automatically.
- **API-auth** [MOCK_E2E]: `frontend/e2e/registration-api.spec.js` — `R05 mock: explicit login and logout still rotate CSRF; registration never automatically authenticates`. Assertion: NoPortal until explicit password/login; form-urlencoded and dynamicCSRF checked in fixture; logout204; password/statusempty.
- **AUTH-wrong** [MOCK_E2E]: `frontend/e2e/auth.spec.js` — `mock backend: wrong password does not reveal protected UI`. Assertion: 401 INVALID_CREDENTIALS visible, login passwordempty; logoutbutton absent.
- **UNIT-register** [UNIT]: `frontend/tests/api.test.js` — `register bootstraps dynamic CSRF and posts exactly four original JSON fields on the internal cookie path`. Assertion: GETcsrf+POSTregister; exact4rawJSONfields, includecredentials, headerdynamic; no otherendpoint; existing-session test retains epoch/token.
- **UNIT-invalid** [UNIT]: `frontend/tests/api.test.js` — `register rejects unconfirmed success: ${name}`. Assertion: 11 cases 200/202/204, nonJSON/null/array/missingdisplayName/wrongtype/blankemail/invalidUUID/extrasecret reject INVALID_RESPONSE; calls1.
- **UNIT-session** [UNIT]: `frontend/tests/api.test.js` — `late registration cannot confirm success or overwrite a new auth epoch`. Assertion: invalidate epoch while pending; response201 rejects SESSION_CHANGED; new CSRF object unchanged.
- **UNIT-401** [UNIT]: `frontend/tests/api.test.js` — `anonymous startup is silent but later protected 401 notifies session expiry`. Assertion: Startup401 no notify, protected401 callback once; late old-session401 test preserves newly logged-in epoch.
- **LIVE-auth** [REAL_E2E]: `frontend/e2e/backend.live.spec.js` — `real Spring/PostgreSQL: form login, session rotation, reload, logout, 401 and wrong password`. Assertion: Real UI register201/view safe/name stripped; me401; explicit login/me matches/empty projects/logout; prior cookie rotation/HttpOnly/reload/wrong password preserved.
- **BACKEND-normalization** [BACKEND_POSTGRES]: `backend/src/test/java/vn/edu/uet/handover/RegistrationHttpIntegrationTest.java` — `anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout`. Assertion: HTTP uppercase/padded email stored normalized, name stripped, BCrypt/raw checks; real PG via full verify; không gọi đây là browser E2E.

### New references

UNIT mới nằm ở frontend/tests/registration-regression.test.js; MOCK_E2E mới nằm ở frontend/e2e/registration-regression.spec.js. Mixed UNIT+MOCK_E2E tương ứng hai file, không thêm helperfile. Hook observation là một phần của từng test mới, không tính thêm test để tăng số PASS.

- **reload-cycles** [MOCK_E2E]: `R07 mock: reload and repeated mode cycles preserve URL/history, clear passwords and never mutate`. Assertion: 6 cycles same document/history/URL; passwordempty; reload từ Register trở về anonymousLogin; GET me = 2; POST = 0.
- **name-data** [MOCK_E2E]: `R07 mock: name data ${name} survives JSON and renders safely after explicit login`. Assertion: 5 payloads: name1/100,Vietnamese,HTML,punctuation; exactJSON; noPortal until explicitlogin; identity text equals name, khôngimg/script execution.
- **oversize** [MOCK_E2E]: `R07 mock: handler rejects ${name} even if the browser maxlength gate is removed`. Assertion: Remove maxlength chỉ ở browser test;101/100000name/255validemail đượcclientguardtừchối; focusederror; POST = 0 vàCSRF bootstrap = 0; form vẫn tương tác.
- **email-format** [MOCK_E2E]: `R07 mock: email format ${name} respects existing browser/server boundary`. Assertion: Special localpart và padded uppercase cóPOST = 1/canonicalresponseLoginEmail; missingdomainerror/POST = 0; normalizing DB được kiểm chứng riêng backend.
- **email-limit** [MOCK_E2E]: `R07 mock: a syntactically valid 254-character email can actually submit`. Assertion: 64localpart/domainlabels63/63/61;length = 254; native typeMismatchfalse; actualPOST = 1 chứa đúngemail.
- **utf8-three-byte** [MOCK_E2E]: `R07 mock: UTF-8 boundary ${name}`. Assertion: 6 casesVietnamese/combining72vs73bytes,7vs8emoji codepoints; TextEncoder bytes; exactpayload hoặcvalidation+POST = 0.
- **confirmation** [MOCK_E2E]: `R07 mock: confirmation ${name} cannot submit`. Assertion: Kháccase hoặc thiếupadding so với raw password ->exactconfirmationerror,POST = 0.
- **native-race** [MOCK_E2E]: `R07 mock: native race ${action} has exactly one pending POST and one success notice`. Assertion: Native dblclick/repeatedEnter/click+Enter; gate giữPOST = 1;busy/disable/noearlystatus;release201/status count = 1;clock+60s no replay.
- **reload-pending** [MOCK_E2E]: `R07 mock: reload during pending registration discards the old document and does not replay POST`. Assertion: Reload khiPOSTpending; freshLoginEmail không bịlate responseoverwrite; passwordempty/status0;POST = 1/URLunchanged; noReacterror.
- **late-after-login** [MOCK_E2E]: `R07 mock: old registration ${status} cannot overwrite a newly logged-in account`. Assertion: 2 stale response201/500sau forcedexpiryevent+explicitlogin mới;Portalnewidentity/noerror/nosuccess/POST = 1; actualprotected401 cótest riêng.
- **missing-response-fields** [UNIT + MOCK_E2E]: `R07 UNIT: missing ${field} cannot confirm 201; R07 mock: response ${malformed} stays an unconfirmed error without retry`. Assertion: Missing id/email đượctest ởclient vàUI; INVALID_RESPONSE/errornotice; noPortal/noautoretry.
- **non-json-browser** [MOCK_E2E]: `R07 mock: response ${malformed} stays an unconfirmed error without retry`. Assertion: HTTP201bodyHTML ->unconfirmederror/controlsusable/POST = 1/not success, bổ sung UNIT nonJSON đãcó.
- **responsive-states** [MOCK_E2E]: `R07 mock: responsive states and manual 400 recovery at ${width}px`. Assertion: 375×812,768×1024,1440×900: blankvalidation→400→manualretry gatedbusy→201→explicitlogin→Portal/reload/logout; bounds/scrollWidth/scrollIntoView; alerts,status không conflict.
- **protected-401** [MOCK_E2E]: `R07 mock: a protected API 401 removes the old workspace and returns safely to login`. Assertion: Dùng mockProject thật của bộtest; nútKiểmtraquyền phátHTTP401 quaApiClient→event→App;Portalunmounted/Login/expiryerror/passwordempty; noPOSTregister.
- **sensitive-observation** [MOCK_E2E]: `beforeEach/afterEach trên toàn bộ 34 R07 mock tests`. Assertion: HookStorage.setItem/cookie setter đếmwrite; lengths0; console/URL/DOM ngoài passwordinputs/cookies khôngpassword; network sameorigin,secret chỉPOSTregister/login; unexpectedexternal bịabort.
- **unicode-serialization** [UNIT]: `R07 UNIT: Unicode and URL metacharacters remain exact JSON data without changing endpoint or session`. Assertion: Raw Unicode name/email/password72bytes đượcJSON roundtrip, không đổi path/origin/session; không suyra backend chấp nhận mọi emailUnicode.

| ID | Scenario | Existing Coverage | New Coverage | Status |
|---|---|---|---|---|
| A01 | Trang mở mặc định ở chế độ Login. | UI-default | Không thêm test trùng | COVERED |
| A02 | Tiêu đề là Đăng nhập. | UI-default | Không thêm test trùng | COVERED |
| A03 | Form có Email. | UI-default | Không thêm test trùng | COVERED |
| A04 | Form có Mật khẩu. | UI-default | Không thêm test trùng | COVERED |
| A05 | Không hiển thị ô Tên tài khoản. | UI-default | Không thêm test trùng | COVERED |
| A06 | Không hiển thị ô Nhập lại mật khẩu. | UI-default | Không thêm test trùng | COVERED |
| A07 | Có nút chuyển sang Đăng ký. | UI-default | Không thêm test trùng | COVERED |
| A08 | Không có request `/auth/register` khi chỉ mở trang. | UI-default | Không thêm test trùng | COVERED |
| A09 | `/auth/me` vẫn được gọi theo cơ chế khởi tạo session hiện tại. | UI-default | Không thêm test trùng | COVERED |
| A10 | Trang không tự chuyển sang Register khi reload. | Chưa có ở baseline | reload-cycles (initial MISSING) | COVERED |
| A11 | Người dùng đã authenticated vẫn được điều hướng đến Portal như trước. | LIVE-auth | Không thêm test trùng | COVERED |
| B01 | Nhấn Đăng ký chuyển đúng sang Register. | UI-default | Không thêm test trùng | COVERED |
| B02 | Tiêu đề đổi thành Đăng ký. | UI-default | Không thêm test trùng | COVERED |
| B03 | Có đúng bốn trường đăng ký. | UI-default | Không thêm test trùng | COVERED |
| B04 | Form Login không còn hoạt động đồng thời ở phía sau. | UI-default | Không thêm test trùng | COVERED |
| B05 | Nhấn Đăng nhập quay về Login. | UI-default | Không thêm test trùng | COVERED |
| B06 | Có thể chuyển qua lại nhiều lần. | UI-default | reload-cycles (initial PARTIAL) | COVERED |
| B07 | Không reload trang. | UI-default | Không thêm test trùng | COVERED |
| B08 | Không đổi pathname. | UI-default | Không thêm test trùng | COVERED |
| B09 | Không đổi search parameters. | UI-default | Không thêm test trùng | COVERED |
| B10 | Không đổi hash. | UI-default | Không thêm test trùng | COVERED |
| B11 | Không tạo history entry không cần thiết. | UI-default | Không thêm test trùng | COVERED |
| B12 | Không làm mất khả năng tương tác bằng bàn phím. | UI-keyboard | Không thêm test trùng | COVERED |
| B13 | Password cũ không xuất hiện lại khi quay về mode trước. | UI-state | Không thêm test trùng | COVERED |
| B14 | Lỗi của Login không rò sang Register. | UI-errors | Không thêm test trùng | COVERED |
| B15 | Lỗi của Register không rò sang Login. | UI-errors | Không thêm test trùng | COVERED |
| C01 | Rỗng → Không submit | UI-fields | Không thêm test trùng | COVERED |
| C02 | Chỉ khoảng trắng → Không submit | UI-invalid | Không thêm test trùng | COVERED |
| C03 | Một ký tự hợp lệ → Chấp nhận theo contract | Chưa có ở baseline | name-data (initial MISSING) | COVERED |
| C04 | Đúng 100 ký tự → Chấp nhận | Chưa có ở baseline | name-data (initial MISSING) | COVERED |
| C05 | 101 ký tự → Không được gửi request không hợp lệ | UI-length | oversize (initial PARTIAL) | COVERED |
| C06 | Có khoảng trắng đầu/cuối → Chuẩn hóa theo quy tắc đã có | LIVE-auth, BACKEND-normalization | Không thêm test trùng | COVERED |
| C07 | Unicode tiếng Việt → Xử lý đúng | Chưa có ở baseline | name-data (initial MISSING) | COVERED |
| C08 | Ký tự HTML như `<script>` → Được xử lý như dữ liệu, không thực thi | Chưa có ở baseline | name-data (initial MISSING) | COVERED |
| C09 | Ký tự đặc biệt → Không gây lỗi UI | Chưa có ở baseline | name-data (initial MISSING) | COVERED |
| C10 | Chuỗi rất dài → Không làm treo giao diện | Chưa có ở baseline | oversize (initial MISSING) | COVERED |
| D01 | Rỗng → Không submit | UI-fields | Không thêm test trùng | COVERED |
| D02 | Thiếu @ → Không submit | UI-invalid | Không thêm test trùng | COVERED |
| D03 | Thiếu phần tên miền → Không submit | Chưa có ở baseline | email-format (initial MISSING) | COVERED |
| D04 | Email hợp lệ → Cho phép submit | API-success | Không thêm test trùng | COVERED |
| D05 | Email có chữ hoa → Backend chuẩn hóa đúng | API-success, BACKEND-normalization | Không thêm test trùng | COVERED |
| D06 | Email có khoảng trắng đầu/cuối → Xử lý đúng theo contract | UNIT-register, BACKEND-normalization | email-format (initial PARTIAL) | COVERED |
| D07 | Đúng giới hạn 254 ký tự và hợp lệ → Chấp nhận | Chưa có ở baseline | email-limit (initial MISSING) | COVERED |
| D08 | Vượt 254 ký tự → Từ chối | UI-length | oversize (initial PARTIAL) | COVERED |
| D09 | Email đã tồn tại → Hiển thị lỗi 409 | API-409 | Không thêm test trùng | COVERED |
| D10 | Email chưa tồn tại → Có thể đăng ký | API-409 | Không thêm test trùng | COVERED |
| D11 | Unicode hoặc ký tự đặc biệt → Không crash; xử lý theo contract | Chưa có ở baseline | email-format, unicode-serialization (initial MISSING) | COVERED |
| D12 | Email sửa lại sau lỗi 409 → Có thể submit lại bằng hành động mới | API-409 | Không thêm test trùng | COVERED |
| E01 | Password rỗng. | UI-fields | Không thêm test trùng | COVERED |
| E02 | Password 7 ký tự. | UI-invalid | Không thêm test trùng | COVERED |
| E03 | Password đúng 8 ký tự. | UI-valid | Không thêm test trùng | COVERED |
| E04 | Password dài hơn 8 ký tự. | UI-valid | Không thêm test trùng | COVERED |
| E05 | Password toàn khoảng trắng. | UI-invalid | Không thêm test trùng | COVERED |
| E06 | Password ASCII đúng 72 byte. | UI-valid | Không thêm test trùng | COVERED |
| E07 | Password ASCII 73 byte. | UI-invalid | Không thêm test trùng | COVERED |
| E08 | Password Unicode có tổng đúng 72 byte. | UI-valid | Không thêm test trùng | COVERED |
| E09 | Password Unicode có tổng lớn hơn 72 byte. | UI-invalid | Không thêm test trùng | COVERED |
| E10 | Password có emoji nhiều byte. | UI-valid | Không thêm test trùng | COVERED |
| E11 | Password có ký tự tiếng Việt nhiều byte. | UI-valid | utf8-three-byte (initial PARTIAL) | COVERED |
| E12 | Password có số ký tự dưới 72 nhưng số byte vượt 72. | UI-invalid | Không thêm test trùng | COVERED |
| E13 | Password có khoảng trắng đầu/cuối không bị tự ý trim. | UI-valid | Không thêm test trùng | COVERED |
| E14 | Password có chữ hoa không bị lowercase. | UI-valid | Không thêm test trùng | COVERED |
| E15 | Password và confirmPassword giống chính xác được chấp nhận. | UI-valid | Không thêm test trùng | COVERED |
| E16 | Confirm password khác một ký tự bị từ chối. | UI-invalid | Không thêm test trùng | COVERED |
| E17 | Confirm password khác chữ hoa/chữ thường bị từ chối. | Chưa có ở baseline | confirmation (initial MISSING) | COVERED |
| E18 | Confirm password thiếu khoảng trắng so với password bị từ chối. | Chưa có ở baseline | confirmation (initial MISSING) | COVERED |
| F01 | Nhấn một lần → một POST. | API-success | Không thêm test trùng | COVERED |
| F02 | Double-click rất nhanh → tối đa một POST đang xử lý. | API-pending | native-race (initial PARTIAL) | COVERED |
| F03 | Nhấn Enter liên tiếp → không tạo nhiều POST đồng thời. | Chưa có ở baseline | native-race (initial MISSING) | COVERED |
| F04 | Click nút rồi Enter → không tạo request trùng. | Chưa có ở baseline | native-race (initial MISSING) | COVERED |
| F05 | Trong khi pending, nút submit bị disable. | API-pending | Không thêm test trùng | COVERED |
| F06 | Trạng thái busy hiển thị đúng. | API-pending | Không thêm test trùng | COVERED |
| F07 | Sau thành công, không có request đăng ký thứ hai tự động. | API-success | Không thêm test trùng | COVERED |
| F08 | Sau thất bại, người dùng có thể chủ động thử lại. | API-409, API-403 | Không thêm test trùng | COVERED |
| F09 | Không có background retry. | API-failures, API-network, API-timeout | Không thêm test trùng | COVERED |
| F10 | Không phát sinh nhiều thông báo thành công. | API-pending | native-race (initial PARTIAL) | COVERED |
| G01 | Trạng thái busy được bật khi submit. | API-pending | Không thêm test trùng | COVERED |
| G02 | Busy được tắt khi request hoàn thành. | API-success, API-auth | Không thêm test trùng | COVERED |
| G03 | Busy được tắt khi request thất bại. | API-400, API-failures | Không thêm test trùng | COVERED |
| G04 | Form không bị kẹt vĩnh viễn sau timeout. | API-timeout | Không thêm test trùng | COVERED |
| G05 | Không có stale response ghi đè state sai. | API-stale, UNIT-session | Không thêm test trùng | COVERED |
| G06 | Không hiển thị thông báo thành công trước response HTTP hợp lệ. | API-pending | Không thêm test trùng | COVERED |
| G07 | Không có setState lỗi sau khi component unmount. | Chưa có ở baseline | reload-pending (initial MISSING) | COVERED |
| G08 | Không có lỗi React nghiêm trọng trong console. | API-success | Không thêm test trùng | COVERED |
| G09 | Nếu chuyển mode bị khóa trong lúc request đang chạy, trạng thái khóa phải nhất quán. | API-pending | Không thêm test trùng | COVERED |
| G10 | Nếu implementation cho phép thay đổi mode, kết quả request cũ không được cập nhật sai mode mới. | Chưa có ở baseline | Implementation khóa mode switch trong pending; forced expiry/stale cases thuộc G05/K16, không yêu cầu thêm mode-switch-while-busy. | NOT_APPLICABLE |
| G11 | Loading/error/success state không xung đột. | API-pending, API-400 | responsive-states (initial PARTIAL) | COVERED |
| H01 | HTTP 201 với response hợp lệ → thành công. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H02 | Response có `id`. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H03 | Response có `email`. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H04 | Response có `displayName`. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H05 | Không yêu cầu password trong response. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H06 | Không yêu cầu passwordHash trong response. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H07 | Hiển thị thông báo thành công. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H08 | Chuyển về Login. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H09 | Không tự authenticated. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H10 | Không thay đổi URL. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H11 | Password và confirmPassword được xóa. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H12 | Không tạo request đăng ký thứ hai sau khi thành công. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H13 | Nếu frontend điền sẵn email, chỉ điền email, không điền password. | API-success, API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| H14 | Response thiếu `id`. | Chưa có ở baseline | missing-response-fields (initial MISSING) | COVERED |
| H15 | Response thiếu `email`. | Chưa có ở baseline | missing-response-fields (initial MISSING) | COVERED |
| H16 | Response thiếu `displayName`. | UNIT-invalid, API-malformed | Không thêm test trùng | COVERED |
| H17 | Response có kiểu dữ liệu không đúng. | UNIT-invalid, API-malformed | Không thêm test trùng | COVERED |
| H18 | Response không phải JSON hợp lệ. | UNIT-invalid | non-json-browser (initial PARTIAL) | COVERED |
| H19 | HTTP success status không đúng contract. | UNIT-invalid, API-malformed | Không thêm test trùng | COVERED |
| I01 | Hiển thị validation error. | API-400 | Không thêm test trùng | COVERED |
| I02 | Không chuyển về Login. | API-400 | Không thêm test trùng | COVERED |
| I03 | Không báo thành công. | API-400 | Không thêm test trùng | COVERED |
| I04 | Không tự retry. | API-400 | Không thêm test trùng | COVERED |
| I05 | Người dùng có thể sửa thông tin và submit lại. | Chưa có ở baseline | responsive-states (initial MISSING) | COVERED |
| I06 | Hiển thị lỗi CSRF. | API-403 | Không thêm test trùng | COVERED |
| I07 | Không tự retry POST. | API-403 | Không thêm test trùng | COVERED |
| I08 | Không bypass CSRF. | API-403 | Không thêm test trùng | COVERED |
| I09 | Có thể làm mới token bằng cơ chế hiện tại. | API-403 | Không thêm test trùng | COVERED |
| I10 | Làm mới token không tự gửi lại đăng ký. | API-403 | Không thêm test trùng | COVERED |
| I11 | Khi người dùng chủ động submit lại, request mới sử dụng CSRF token phù hợp. | API-403 | Không thêm test trùng | COVERED |
| I12 | Nhận `EMAIL_ALREADY_EXISTS`. | API-409 | Không thêm test trùng | COVERED |
| I13 | Hiển thị thông báo email đã được sử dụng. | API-409 | Không thêm test trùng | COVERED |
| I14 | Không hiển thị thông báo chung gây hiểu lầm. | API-409 | Không thêm test trùng | COVERED |
| I15 | Không chuyển về Login tự động. | API-409 | Không thêm test trùng | COVERED |
| I16 | Không xóa email khi người dùng cần sửa. | API-409 | Không thêm test trùng | COVERED |
| I17 | Không gửi request lần hai nếu người dùng chưa chủ động thao tác. | API-409 | Không thêm test trùng | COVERED |
| I18 | Sau khi sửa email, người dùng có thể thử lại. | API-409 | Không thêm test trùng | COVERED |
| J01 | Network failure được báo rõ. | API-network | Không thêm test trùng | COVERED |
| J02 | HTTP 500 không bị hiểu là thành công. | API-failures | Không thêm test trùng | COVERED |
| J03 | HTTP 503 được hiển thị phù hợp. | API-failures | Không thêm test trùng | COVERED |
| J04 | Timeout không làm UI kẹt busy. | API-timeout | Không thêm test trùng | COVERED |
| J05 | Timeout không tự động retry. | API-timeout | Không thêm test trùng | COVERED |
| J06 | Không có success message giả khi timeout. | API-timeout | Không thêm test trùng | COVERED |
| J07 | Người dùng vẫn có thể quay về Login sau lỗi. | API-network, API-timeout, API-failures | Không thêm test trùng | COVERED |
| J08 | Lỗi kết nối không làm lộ password trong UI. | API-network | Không thêm test trùng | COVERED |
| J09 | Lỗi server không làm mất toàn bộ trang. | API-failures | Không thêm test trùng | COVERED |
| J10 | Không tạo request mutation mới chỉ vì component render lại. | API-pending | reload-cycles (initial PARTIAL) | COVERED |
| K01 | Sau đăng ký thành công, trở về Login. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K02 | Không tự vào Portal. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K03 | Không có authenticated user do registration tự tạo ở frontend. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K04 | Người dùng chủ động nhập mật khẩu và Login. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K05 | Login vẫn sử dụng API form-urlencoded hiện có. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K06 | Login vẫn dùng CSRF. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K07 | Login thành công hiển thị Portal. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K08 | Login sai mật khẩu vẫn hiển thị lỗi. | AUTH-wrong, LIVE-auth | Không thêm test trùng | COVERED |
| K09 | Logout vẫn hoạt động. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K10 | Sau Logout trở lại Login. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K11 | Không giữ mật khẩu sau Logout. | API-auth, LIVE-auth | Không thêm test trùng | COVERED |
| K12 | Reload khi đã authenticated vẫn hoạt động theo session hiện tại. | LIVE-auth | Không thêm test trùng | COVERED |
| K13 | Reload khi anonymous không tự vào Portal. | Chưa có ở baseline | reload-cycles (initial MISSING) | COVERED |
| K14 | Session hết hạn được xử lý như trước. | UNIT-401, API-stale | protected-401 (initial PARTIAL) | COVERED |
| K15 | Protected 401 vẫn được xử lý đúng. | UNIT-401, API-stale | protected-401 (initial PARTIAL) | COVERED |
| K16 | Không để response cũ của session trước ghi đè session mới. | UNIT-session, API-stale | late-after-login (initial PARTIAL) | COVERED |
| L01 | Password input có `type="password"`. | UI-state | Không thêm test trùng | COVERED |
| L02 | Confirm password có `type="password"`. | UI-state | Không thêm test trùng | COVERED |
| L03 | Password không nằm trong URL. | UI-enter, API-success | Không thêm test trùng | COVERED |
| L04 | Password không nằm trong query string. | UI-enter, API-success | Không thêm test trùng | COVERED |
| L05 | Password không nằm trong hash. | UI-enter, API-success | Không thêm test trùng | COVERED |
| L06 | Password không được lưu vào localStorage. | UI-state, API-success | sensitive-observation (initial PARTIAL) | COVERED |
| L07 | Password không được lưu vào sessionStorage. | UI-state, API-success | sensitive-observation (initial PARTIAL) | COVERED |
| L08 | Không sử dụng cookie tự tạo để lưu password. | Chưa có ở baseline | sensitive-observation (initial MISSING) | COVERED |
| L09 | Không gửi password đến external origin. | UNIT-register, API-success | sensitive-observation (initial PARTIAL) | COVERED |
| L10 | Không gửi password qua GET. | UNIT-register, API-success | sensitive-observation (initial PARTIAL) | COVERED |
| L11 | Không hiển thị password trong error message. | API-success, API-400, API-network | Không thêm test trùng | COVERED |
| L12 | Không đưa password vào success message. | API-success, API-400, API-network | Không thêm test trùng | COVERED |
| L13 | Chuyển mode phải xóa password state theo hành vi đã thiết kế. | UI-state | Không thêm test trùng | COVERED |
| L14 | Registration không làm lộ password trong DOM ở dạng văn bản thông thường. | UI-state | Không thêm test trùng | COVERED |
| L15 | Console không chứa password do frontend tự ghi. | Chưa có ở baseline | sensitive-observation (initial MISSING) | COVERED |
| M01 | Mỗi input có accessible label. | UI-fields | Không thêm test trùng | COVERED |
| M02 | Các label phân biệt rõ ràng. | UI-fields | Không thêm test trùng | COVERED |
| M03 | Login/Register switch dùng được bằng bàn phím. | UI-keyboard | Không thêm test trùng | COVERED |
| M04 | Nút chuyển mode không vô tình submit form. | UI-default | Không thêm test trùng | COVERED |
| M05 | Tab navigation hoạt động. | UI-keyboard | Không thêm test trùng | COVERED |
| M06 | Focus indicator xuất hiện. | UI-keyboard | Không thêm test trùng | COVERED |
| M07 | Lỗi validation được liên kết với trường tương ứng nếu thiết kế hiện tại hỗ trợ. | UI-fields | Không thêm test trùng | COVERED |
| M08 | Thông báo thành công có semantic phù hợp. | API-success | Không thêm test trùng | COVERED |
| M09 | Thông báo lỗi có semantic phù hợp. | API-400, API-403, API-409 | Không thêm test trùng | COVERED |
| M10 | Không có hai form cùng hoạt động gây nhầm lẫn. | UI-default | Không thêm test trùng | COVERED |
| M11 | Không dùng màu sắc làm tín hiệu duy nhất của lỗi. | UI-fields | Không thêm test trùng | COVERED |
| M12 | Các nút có accessible name rõ ràng. | UI-fields, UI-default | Không thêm test trùng | COVERED |
| N01 | Form Register hiển thị đầy đủ. | UI-responsive | Không thêm test trùng | COVERED |
| N02 | Không có horizontal overflow không cần thiết. | UI-responsive | Không thêm test trùng | COVERED |
| N03 | Không có input bị che khuất. | UI-responsive | Không thêm test trùng | COVERED |
| N04 | Nút Đăng ký vẫn thao tác được. | UI-responsive | Không thêm test trùng | COVERED |
| N05 | Nút chuyển Login/Register vẫn thao tác được. | UI-responsive | Không thêm test trùng | COVERED |
| N06 | Card không tràn khỏi viewport theo chiều ngang. | UI-responsive | Không thêm test trùng | COVERED |
| N07 | Có thể cuộn dọc khi màn hình thấp. | UI-responsive | Không thêm test trùng | COVERED |
| N08 | Validation error không phá layout. | Chưa có ở baseline | responsive-states (initial MISSING) | COVERED |
| N09 | Server error không phá layout. | Chưa có ở baseline | responsive-states (initial MISSING) | COVERED |
| N10 | Loading state không phá layout. | Chưa có ở baseline | responsive-states (initial MISSING) | COVERED |
| N11 | Chuyển Login/Register không làm mất logo hoặc tiêu đề ứng dụng. | UI-responsive | Không thêm test trùng | COVERED |
| N12 | Không ảnh hưởng Workspace sau khi Login. | Chưa có ở baseline | responsive-states (initial MISSING) | COVERED |

## C. Boundary Testing

- **Display name:** tên 1 và 100 ký tự được gửi thành công. Tên 101 và 100.000 ký tự bị submit guard từ chối khi test cố ý tháo native maxlength ở DOM. Đây là kiểm thử bổ sung ngoài native input; không sửa tracked source. Test R04 về giới hạn nhập bằng bàn phím được giữ nguyên. Tiếng Việt, chuỗi HTML và dấu câu đi qua JSON như dữ liệu; sau login chủ động, UI hiển thị đúng text, không tạo img/script hoặc chạy event handler.
- **Email:** fixture ở biên 254 có local part 64 và các domain label 63/63/61 ký tự, native typeMismatch=false và thực sự gửi một POST. Email 255 ký tự bị từ chối. Chuỗi có padding/chữ hoa nhận canonical response email và được điền sẵn ở Login. Có test local part chứa dấu câu hợp lệ và thiếu domain. Unicode serialization ở client không có nghĩa mọi email Unicode đều hợp lệ; backend validation và normalization vẫn quyết định. DB normalization được xác minh bằng backend PostgreSQL tests, không lấy mock response làm bằng chứng DB.
- **Password:** tests cũ cho tối thiểu 8 ký tự, ASCII 72/73 byte, Unicode 2/4 byte, whitespace và case được giữ nguyên. Tests mới thêm ký tự tiếng Việt 3 byte, combining sequences ở biên 72/73 byte, 7 so với 8 emoji code points. Số byte dùng TextEncoder().encode(value).length; không dùng string.length để suy ra UTF-8 bytes.
- **Confirm password:** bổ sung khác chữ hoa/thường và thiếu khoảng trắng so với password gốc; cả hai không gửi POST. Không ghi giá trị password mẫu trong tài liệu.
- **Response:** thêm missing id/email ở UNIT và UI; numeric id/email ở UNIT; non-JSON 201 ở UI. Giữ test cũ cho missing displayName, wrong type, extra hash, HTTP 200/202/204, null, array và invalid UUID. Các response không xác nhận được kết quả đều không trở thành success, auto-login hoặc auto-retry.
- **CSRF bootstrap:** thiếu header/token, network failure hoặc timeout không dẫn đến POST chứa credential. Bootstrap cũ sau authEpoch change không gửi credential cũ hay ghi đè token mới. Hai lời gọi ApiClient.register được chủ động tạo riêng dùng một bootstrap và hai payload/result/error độc lập; đây là hai mutation có chủ ý, khác với UI double submit phải giữ một POST.

## D. Async & Race Conditions

Ba thao tác native double-click, Enter liên tiếp và click rồi Enter đều giữ đúng một POST đang chờ, disable submit/mode switch và không báo success trước response. Sau release 201 chỉ có một status; tiến virtual clock thêm 60 giây không gửi lại request. Test R05 dispatch ba submit events đồng bộ vẫn kiểm tra ref guard độc lập với disabled button.

Reload khi POST đang chờ tạo document mới về Login. Phản hồi cũ không ghi đè email mới, không replay POST và không phát sinh React error. G07 là quan sát lifecycle qua navigation/unload; không khẳng định đã instrument mọi lệnh setState bên trong React.

Một test kích hoạt expiry event hiện có, login chủ động bằng account khác rồi nhận response đăng ký cũ 201/500: Portal vẫn thuộc account mới, không có lỗi hoặc success notice cũ ghi đè. Test riêng kích hoạt protected 401 bằng thao tác UI qua ApiClient để kiểm chứng đường phát sinh session-expiry event thật của frontend.

HTTP 400 giữ form và dữ liệu không nhạy cảm, xóa password, khôi phục busy và cho phép người dùng sửa rồi gửi lại. CSRF 403/manual refresh, 409/corrected email, network loss và timeout tiếp tục được kiểm tra bởi suites cũ. Timeout được thông báo là kết quả chưa xác định; không suy ra DB chắc chắn chưa tạo account. G10 là NOT_APPLICABLE vì implementation khóa thao tác chuyển mode khi pending; không bổ sung cơ chế state mới.

## E. Security & Accessibility

34 test mới quan sát network, console, DOM, URL, browser storage và JavaScript cookie writes. Hook chỉ đếm write và gọi lại native setter, không thay hành vi lưu trữ. Request bất ngờ ra ngoài local origin bị chặn và làm assertion thất bại; credential chỉ được phép trong POST cùng origin tới register/login. Không quan sát thấy password trong query/hash, error/success notice, text DOM thông thường, storage hoặc cookie do frontend tạo. Kết luận chỉ áp dụng cho các scenario quan sát được; không tuyên bố memory erasure tuyệt đối.

Các test R04 về accessible label, Tab, focus indicator, aria-describedby/aria-invalid, switch type=button và role alert/status đã được chạy lại. Test mới kiểm tra nội dung lỗi bằng text và ARIA, không chỉ dựa vào màu sắc. Không thêm scanner/dependency hoặc tuyên bố đạt toàn bộ WCAG.

Tại 375×812, 768×1024 và 1440×900, test đi qua validation, server error, loading, recovery, Login, Portal, reload và logout. Assertions kiểm scrollWidth, container bounds và khả năng cuộn input/nút vào viewport khi form cao hơn màn hình. Không sửa CSS. Có 9 ảnh validation/server-error/recovered trong ignored artifacts; đã xem ảnh mobile validation, tablet server error và desktop success, không thấy tràn ngang. Đây là bằng chứng QA cho các kích thước đã nêu, không phải phê duyệt thẩm mỹ mới.

## F. Test Results — thực chạy R07

| Test Suite | Run | Pass | Fail | Skip |
|---|---:|---:|---:|---:|
| New frontend unit, node --test tests/registration-regression.test.js | 11 | 11 | 0 | 0 |
| Full frontend unit, npm test | 71 | 71 | 0 | 0 |
| New registration E2E, lần chạy lại cuối | 34 | 34 | 0 | 0 |
| Existing registration UI E2E | 27 | 27 | 0 | 0 |
| Existing registration API E2E | 23 | 23 | 0 | 0 |
| Existing auth E2E | 2 | 2 | 0 | 0 |
| Full browser mock, npm run test:e2e | 390 | 390 | 0 | 0 |
| Backend verify với PostgreSQL riêng | 268 | 268 | 0 | 0 |
| Real backend browser, unchanged run_live_check.py | 3 | 3 | 0 | 0 |
| Backend clean verify bên trong live runner | 268 | 268 | 0 | 0 |

Lint và build: PASS. Backend failure/error/skip đều 0. New unit được discovery trong npm test: 71 = 60 cũ + 11 mới. Full browser: 390 = 356 cũ + 34 mới. Không có test cũ bị sửa, xóa hoặc skip. Playwright workers=1/retries=0 và cấu hình cũ được giữ nguyên. Các hàng test có giao nhau (targeted nằm trong full suite), không cộng chúng thành số test độc lập hoặc gọi tất cả là real E2E.

Real runner trả PASS_LOCAL_REAL_BACKEND. Test auth hiện có thực hiện UI → Vite → Spring → PostgreSQL, nhận 201, vẫn anonymous, sau đó người dùng chủ động login bằng account vừa tạo, kiểm tra me/project list rỗng và logout. Hai live test còn lại kiểm tra Project/Membership và S3-disabled fail-closed. Không thêm live spec, không thay số test kỳ vọng và không dùng mock để thay real gate.

Database cleanup: PASS. Backend verify dùng container PostgreSQL 17 mới, loopback port ngẫu nhiên, credentials sinh trong bộ nhớ, DB rỗng đã được xác minh trước khi bật RUN_DB_TESTS. Container có ownership label; kiểm tra ID/label trước khi xóa. Runner live tạo container và hai DB riêng rồi ghi testDatabaseRemoved=true. Không dùng production/staging/shared DB hoặc AWS.

Evidence trong D:/cloud-document-handover-registration/runtime-data/c09-r07-20261111-4b08144e0a/: coverage-initial.json, coverage-final.json, focused-result.json và new-browser.log (lần lỗi), frontend-focused-final.json và từng log cuối, full-browser-result.json/full-browser.log, backend-result.json/backend-verify.log, real-live-verification.json/real-live-runner.log, visual-review.json, tracked-baseline.json, refs-before.txt, original-files.json. Screenshot và các build/browser artifacts bị Git ignore, không commit.

## G. Defect Findings

**Không tái hiện được production/contract/security regression.** Không sửa production code. Lỗi lần đầu thuộc helper của test mới, được phân loại riêng:

| ID | Severity | Mô tả / bước tái hiện | Expected | Actual lần đầu | File/module và bằng chứng | Trạng thái |
|---|---|---|---|---|---|---|
| R07-H01 — test harness | LOW | Responsive recovery: validation → HTTP 400 → submit lại → 201 → login chủ động → helper noOverflow; lặp ở ba viewport | Kiểm tra overflow và bounds của container đang hiển thị | Helper chờ guest Card đã unmount dù Portal đã hiện, timeout 30 giây ở ba test | Chỉ frontend/e2e/registration-regression.spec.js, helper noOverflow; new-browser.log và error-context.md lần đầu cho thấy Portal hiện đúng | TEST_HELPER_CORRECTED_AND_RETEST_PASS: chọn guest Card khi có, workspace-main sau login; giữ nguyên scrollWidth/bounds assertions; chạy lại 34/34 và full 390/390 PASS |

Lần chạy đầu: 31 PASS / 3 FAIL / 0 SKIP do một lỗi thiết kế helper, không phải ba lỗi sản phẩm. Lint và 11 unit tests PASS ngay lần đầu. Log và artifacts lỗi được giữ nguyên. Không xóa test, thêm skip/only, tăng timeout hoặc đổi expected result để che production bug. Không đánh dấu product defect RESOLVED khi chưa sửa production.

## H. Existing Risks

Tham chiếu báo cáo C09-R06-security-review.md; không tạo finding trùng hoặc tự triển khai:

- R06-F01 MEDIUM: thiếu application rate limit/chống đăng ký hàng loạt — OPEN.
- R06-F02 MEDIUM: chưa xác minh quyền sở hữu email — OPEN.
- R06-F03 LOW: EMAIL_ALREADY_EXISTS tạo khả năng dò email tồn tại — OPEN theo contract hiện tại.
- R06-F04 LOW: chưa có registration enable/disable flag — OPEN.

Frontend PASS không khắc phục hoặc chấp nhận các risk này thay owner. Chưa chạy abuse/load test hoặc kiểm chứng control ở gateway/AWS.

## I. Final Conclusion

**R07 PASS trong phạm vi kiểm thử đã nêu; không có blocking defect hoặc production regression được phát hiện; đủ điều kiện nhận yêu cầu R08.** Ma trận cuối: 188 COVERED / 0 PARTIAL / 0 MISSING / 1 NOT_APPLICABLE, với giới hạn của từng loại test được ghi rõ.

Chưa kiểm chứng AWS E2E, hạ tầng public/reverse proxy/HTTPS thực tế, load/abuse, email verification chưa được triển khai, browser engine ngoài Chrome hiện có, runtime Java 21, toàn bộ WCAG hoặc erasure mọi bản sao trong bộ nhớ JavaScript. Không tuyên bố production ready từ local PASS.

Git review phải xác nhận chỉ ba file R07 mới, toàn bộ 296 tracked files cũ và dữ liệu worktree gốc giữ nguyên theo hash; không sửa existing tests/config/backend/contract/cloud. Chỉ commit local sau khi tất cả gates và staged diff review PASS; SHA được ghi trong báo cáo kết quả cuối để tránh self-reference. Không push, tạo PR, merge, deploy hoặc thực hiện R08.
