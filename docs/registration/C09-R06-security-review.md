# C09-R06 — Registration security review

## A. Thông tin chung

- Branch: `task/C09-registration`.
- Base: `8c0353962a49b25471aca10c4a95ec2e9f10c93b` (R05).
- Ngày kiểm tra: 2026-11-11, Asia/Saigon.
- Trạng thái nghiệm thu: PASS sau khi chạy toàn bộ gates R06; không phát hiện blocking defect.
- Mục tiêu: audit HTTP → validation → BCrypt → PostgreSQL → session/authorization, bổ sung regression có giá trị. Chỉ thêm test class và báo cáo này; không sửa source/config/frontend/contract/cloud/tests cũ.
- Preflight: đúng worktree, branch, HEAD; working tree sạch, không unmerged entries; năm commit gần nhất là R01–R05. Test DTO/service/persistence nằm trong package `auth`, HTTP/filter/backend test nằm ở package gốc; tất cả còn tồn tại.

## B. Test Coverage Matrix

Ma trận ban đầu được lập và lưu trước khi tạo test R06: **46 COVERED / 11 PARTIAL / 2 MISSING / 0 NOT_APPLICABLE**. Cột Initial giữ nguyên kết quả gap analysis. Sau khi bổ sung và thực chạy tests: **59 COVERED / 0 PARTIAL / 0 MISSING / 0 NOT_APPLICABLE** trong 59 scenario được liệt kê. COVERED không có nghĩa kiểm thử mọi tổ hợp đầu vào/path trên mọi môi trường; phép kiểm theo lớp và giới hạn probe được ghi rõ. Không thêm validation rule và không coi input chưa bị đặc tả cấm là một bug bảo mật.

Tên lớp rút gọn, đường dẫn tuyệt đối dưới `D:/cloud-document-handover-registration/`:

- RR: `backend/src/test/java/vn/edu/uet/handover/auth/RegistrationRequestTest.java`.
- RS: `backend/src/test/java/vn/edu/uet/handover/auth/RegistrationServiceTest.java`.
- RP: `backend/src/test/java/vn/edu/uet/handover/auth/RegistrationPersistenceTest.java`.
- RH: `backend/src/test/java/vn/edu/uet/handover/RegistrationHttpIntegrationTest.java`.
- AF: `backend/src/test/java/vn/edu/uet/handover/ActiveAccountFilterTest.java`.
- BI: `backend/src/test/java/vn/edu/uet/handover/BackendIntegrationTest.java`.
- UploadIntegrationTest/HandoverIntegrationTest cùng thư mục với BI.

RSR: `backend/src/test/java/vn/edu/uet/handover/RegistrationSecurityRegressionTest.java` cùng thư mục với BI.

| ID | Security Scenario | Existing Test (R05) | Initial | Status | Evidence trong R06 | Gap priority |
|---|---|---|---|---|---|---|
| A01 | JSON hợp lệ | RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | COVERED | COVERED | 201; đúng ba field User; SELECT count email = 1; existing suite đã chạy lại PASS trong R06 | - |
| A02 | Thiếu field bắt buộc | RR.rejectsEachMissingField; RH.representativeHttpValidationFailuresReturn400AndNeverWriteUsers | COVERED | COVERED | RR bỏ từng field và violations > 0; HTTP missing email/empty object trả 400, count users giữ nguyên; existing suite đã chạy lại PASS trong R06 | - |
| A03 | Explicit null | RR.rejectsEachExplicitNull; RH.representativeHttpValidationFailuresReturn400AndNeverWriteUsers | COVERED | COVERED | Bốn field null ném MismatchedInputException; HTTP null password trả 400, không ghi; existing suite đã chạy lại PASS trong R06 | - |
| A04 | Sai kiểu JSON | RR.rejectsWrongJsonTypesInsteadOfCoercingStrings; RH.representativeHttpValidationFailuresReturn400AndNeverWriteUsers | COVERED | COVERED | 28 tổ hợp field/type bị từ chối; HTTP number/bool trả 400; existing suite đã chạy lại PASS trong R06 | - |
| A05 | Unknown fields/privilege injection | RR.rejectsUnknownFieldsIncludingAttemptsToOverrideValidationGetters; RH.representativeHttpValidationFailuresReturn400AndNeverWriteUsers | COVERED | COVERED | UnrecognizedPropertyException, FAIL_ON_UNKNOWN_PROPERTIES=true; HTTP role bị 400/count unchanged; existing suite đã chạy lại PASS trong R06 | - |
| A06 | Tên toàn whitespace | RR.rejectsBlankDisplayName; RS.rejectsR01ValidationFailuresBeforeLookupHashOrInsert | COVERED | COVERED | Unicode/ASCII whitespace có violations; service verifyNoInteractions(users,passwords,manager); existing suite đã chạy lại PASS trong R06 | - |
| A07 | Email sai định dạng | RR.rejectsInvalidEmail; RH.representativeHttpValidationFailuresReturn400AndNeverWriteUsers | COVERED | COVERED | Email invalid bị DTO từ chối; HTTP 400 và count users unchanged; existing suite đã chạy lại PASS trong R06 | - |
| A08 | Email vượt giới hạn | RR.rejectsEmailOver254CharactersEvenWhenItsFormatIsValid; RS.rechecksEmailLengthAfterUnicodeLowercaseExpansion | COVERED | COVERED | Violation email ở 255; lowercase expansion từ 254 thành 255 bị 400 trước lookup/hash/insert; existing suite đã chạy lại PASS trong R06 | - |
| A09 | Password dưới 8 code points | RR.requiresEightPasswordCharactersRatherThanEightUtf16Units; RH.representativeHttpValidationFailuresReturn400AndNeverWriteUsers | COVERED | COVERED | 4/7 emoji không đủ 8 code points; HTTP short password không ghi; existing suite đã chạy lại PASS trong R06 | - |
| A10 | Password vượt 72 byte UTF-8 | RR.rejectsOver72Utf8BytesEvenBelow72JavaCharacters; RP.serviceValidationPreventsInvalidInputsFromReachingTheDatabase | COVERED | COVERED | 73-byte ASCII/multibyte rejected; DB count unchanged; existing suite đã chạy lại PASS trong R06 | - |
| A11 | Confirmation phải khớp chính xác | RR.rejectsPasswordConfirmationThatIsNotAnExactMatch; RR.doesNotNormalizeUnicodePasswordConfirmation | COVERED | COVERED | Khác case/padding/Unicode composition bị từ chối; existing suite đã chạy lại PASS trong R06 | - |
| A12 | Input lỗi không tạo user | RH.representativeHttpValidationFailuresReturn400AndNeverWriteUsers | COVERED | COVERED | 15 HTTP bodies; mỗi case 400 VALIDATION_ERROR, total app_users unchanged; existing suite đã chạy lại PASS trong R06 | - |
| B01 | Một request tạo một user | RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | COVERED | COVERED | count app_users WHERE email = 1; existing suite đã chạy lại PASS trong R06 | - |
| B02 | Email normalized trước lưu | RP.persistsCommittedUserCompatibleWithTheExistingLoginRepository; RS.normalizationUsesLocaleRootAndStripsUnicodeNamePadding | COVERED | COVERED | Repository load padded uppercase trả canonical email; Turkish locale không đổi kết quả ROOT; existing suite đã chạy lại PASS trong R06 | - |
| B03 | Unique constraint thật | RP.schemaEmailConstraintStillRejectsDuplicateRawInserts | COVERED | COVERED | pg_constraint uq_user_email contype=u; raw duplicate SQLSTATE23505; count=1; existing suite đã chạy lại PASS trong R06 | - |
| B04 | Duplicate không overwrite account | RP.duplicateNormalizedEmailCannotOverwriteAnExistingUser | COVERED | COVERED | id và UserView sau = trước; count=1; existing suite đã chạy lại PASS trong R06 | - |
| B05 | Duplicate không thay hash | RH.duplicateEmailReturns409WithSafeErrorAndKeepsOldCredentialsUnchanged | COVERED | COVERED | hash sau = trước; old password vẫn matches; existing suite đã chạy lại PASS trong R06 | - |
| B06 | Không re-enable tài khoản disabled | RP.disabledEmailRemainsReservedAndIsNeverReenabledOrReset | COVERED | COVERED | 409; enabled=false; id/view/hash unchanged; existing suite đã chạy lại PASS trong R06 | - |
| B07 | Không có user partial sau failure | RP.registrationRollsBackWithAnEnclosingTransaction; RS.commitFailureNeverReturnsAnApparentSuccess | COVERED | COVERED | Rollback thật: existsByEmail=false; sau đó đăng ký cùng email thành công; commit error không trả User; existing suite đã chạy lại PASS trong R06 | - |
| B08 | Lỗi DB khác không giả duplicate email | RP.unrelatedPrimaryKeyViolationIsNotSuppressedAsAnEmailConflict; RP.unrelatedCheckAndNotNullViolationsArePreserved; RS.doesNotMislabelOtherInsertFailuresAsDuplicateEmail | COVERED | COVERED | SQLSTATE23505 PK/23514/23502 được giữ nguyên; email lỗi không tồn tại; service propagates same exception; existing suite đã chạy lại PASS trong R06 | - |
| B09 | Không sinh project/membership | RH.verifyNoDefaultProjectOrMembershipAndCleanOwnedUsers; RP.verifySideEffectsAndRemoveOnlyOwnedUsers | COVERED | COVERED | AfterEach so sánh count projects/memberships với before; HTTP new user memberships=0; existing suite đã chạy lại PASS trong R06 | - |
| B10 | Race cùng email chỉ một winner | RP.competingRegistrationsBothPassPrecheckButOnlyOneCommits | COVERED | COVERED | Hai precheck absent có barrier; một User, một409; count=1; hash thuộc winner; request kế tiếp vẫn chạy; existing suite đã chạy lại PASS trong R06 | - |
| C01 | Anonymous đăng ký với CSRF thật | RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | COVERED | COVERED | csrf endpoint thật + MockHttpSession + header động; 201; existing suite đã chạy lại PASS trong R06 | - |
| C02 | Không auto principal | RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | COVERED | COVERED | SecurityContext session null sau201; session ID unchanged; existing suite đã chạy lại PASS trong R06 | - |
| C03 | auth/me vẫn cần login | RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | COVERED | COVERED | GET me trên session vừa đăng ký =401 UNAUTHENTICATED; existing suite đã chạy lại PASS trong R06 | - |
| C04 | User mới login được | RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | COVERED | COVERED | POST login thực; session ID rotate; GET me đúng UUID; existing suite đã chạy lại PASS trong R06 | - |
| C05 | Không tự có role dự án | RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | COVERED | COVERED | authorities empty; count memberships user=0; project list empty; existing suite đã chạy lại PASS trong R06 | - |
| C06 | Registration không phá session tài khoản khác | RH.registrationDoesNotReplaceOrRotateAnAlreadyAuthenticatedSession | PARTIAL | COVERED | RSR.registrationInAnotherSessionPreservesAccountAndCsrf: hai browser, register/login/logout B; GET me A vẫn đúng UUID, session/principal identity unchanged; PASS | HIGH |
| C07 | Login/logout cũ | RH.existingLoginLogoutAndProjectCsrfProtectionAndSessionRotationAreUnchanged | COVERED | COVERED | Wrong password401; valid login rotate; stale/missing CSRF403; valid logout204/session invalid; existing suite đã chạy lại PASS trong R06 | - |
| C08 | Disabled không vượt protected check | RH.disabledSessionMayUsePublicRegistrationButCannotReachProtectedAreas; AF.disabledAccountsRemainBlockedOnEveryProtectedArea | COVERED | COVERED | Public register201 được phép; me/projects401 ACCOUNT_DISABLED; read/write sessions invalidated; existing suite đã chạy lại PASS trong R06 | - |
| C09 | Không đổi DB account đang login | RH.registrationDoesNotReplaceOrRotateAnAlreadyAuthenticatedSession | PARTIAL | COVERED | RSR.registrationInAnotherSessionPreservesAccountAndCsrf: SELECT * app_users của A trước/sau equal, gồm password_hash/enabled/created_at; PASS | HIGH |
| D01 | Thiếu CSRF bị từ chối | RH.missingOrInvalidCsrfRejectsRegistrationWithoutCreatingAUser | COVERED | COVERED | No token ->403 ACCESS_DENIED; app_users count unchanged; existing suite đã chạy lại PASS trong R06 | - |
| D02 | CSRF sai bị từ chối | RH.missingOrInvalidCsrfRejectsRegistrationWithoutCreatingAUser | COVERED | COVERED | Invalid token ->403 ACCESS_DENIED; app_users count unchanged; existing suite đã chạy lại PASS trong R06 | - |
| D03 | CSRF hợp lệ được chấp nhận | RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | COVERED | COVERED | Token từ cùng session ->201; existing suite đã chạy lại PASS trong R06 | - |
| D04 | CSRF reject không ghi DB | RH.missingOrInvalidCsrfRejectsRegistrationWithoutCreatingAUser | COVERED | COVERED | Total users before=after; session vẫn anonymous; existing suite đã chạy lại PASS trong R06 | - |
| D05 | Token session khác không hợp lệ | Không có test trực tiếp | MISSING | COVERED | RSR.foreignSessionCsrfCannotRegisterOrAlterEitherSession: token B + session A403; count10 bảng unchanged; token A201; PASS | HIGH |
| D06 | CSRF endpoint khác còn được giữ | RH.existingLoginLogoutAndProjectCsrfProtectionAndSessionRotationAreUnchanged | COVERED | COVERED | Project/login/logout thiếu hoặc stale token bị403; session không bị phá; existing suite đã chạy lại PASS trong R06 | - |
| D07 | Method/path không bypass security | RH.registrationIsNotPublicForUnintendedMethods; AF.registrationBypassAppliesOnlyToPost | PARTIAL | COVERED | RSR.additionalMethodsStayProtected (3 case401, có token thật); RSR.alternatePathsWithoutCsrfCannotWrite (5 URI, không token,400 firewall hoặc403 CSRF); no INSERT/context/count change; PASS | HIGH |
| E01 | User mới không thấy project người khác | BI.projectsAreIsolatedAndOwnerIsAssignedByServer; RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | PARTIAL | COVERED | RSR.newAccountCannotReadOrMutateForeignWorkspace: registered user login thực; GET projects items.length=0 trong khi project owner tồn tại; PASS | HIGH |
| E02 | User mới không đọc project không tham gia | BI.projectsAreIsolatedAndOwnerIsAssignedByServer | PARTIAL | COVERED | RSR.newAccountCannotReadOrMutateForeignWorkspace: GET project/members/files đều404 PROJECT_NOT_FOUND; owner vẫn200 OWNER; PASS | HIGH |
| E03 | User mới không thêm/xóa membership ngoài | BI.membershipMutationRequiresOwnerAndCannotRemoveOwner | PARTIAL | COVERED | RSR.newAccountCannotReadOrMutateForeignWorkspace: PUT tự thêm EDITOR và DELETE owner đều404, counts/owner/project unchanged; PASS | HIGH |
| E04 | User mới không có quyền upload ngoài | UploadIntegrationTest.rightsCurrentMembershipAndCrossProjectIds | PARTIAL | COVERED | RSR.newAccountCannotReadOrMutateForeignWorkspace: valid upload init404 trước storage; metadata/version/session/quota không đổi; PASS | HIGH |
| E05 | User mới không xem handover chưa cấp | HandoverIntegrationTest.httpForeignHandoverAndFileIdsCannotReadOrMutateAnotherProject | PARTIAL | COVERED | RSR.newAccountCannotReadOrMutateForeignWorkspace: handover thật owner đọc200; registered outsider GET/publish404 HANDOVER_NOT_FOUND; PASS | HIGH |
| E06 | Authorization endpoints cũ không đổi | BI.projectsAreIsolatedAndOwnerIsAssignedByServer; BI.membershipMutationRequiresOwnerAndCannotRemoveOwner | COVERED | COVERED | GET404 nonmember, Owner mutation policy, immutable owner, audit counters; rerun full regression; existing suite đã chạy lại PASS trong R06 | - |
| F01 | 201 không plaintext password | RH.anonymousRegistrationCreatesOneSafeAccountWithoutLoginThenTheNewAccountCanLoginAndLogout | COVERED | COVERED | JSON chỉ id/email/displayName và doesNotContain plaintext/password; existing suite đã chạy lại PASS trong R06 | - |
| F02 | 201 không password hash | RP.persistsCommittedUserCompatibleWithTheExistingLoginRepository | COVERED | COVERED | Serialized UserView không chứa stored hash, password/session/token; existing suite đã chạy lại PASS trong R06 | - |
| F03 | Error không chứa password | RH.error; RR.validationMessagesAndRepresentationsNeverContainPasswordValues | COVERED | COVERED | ApiError chỉ code/message/requestId; doesNotContain credential fixture; DTO redacted/write-only; existing suite đã chạy lại PASS trong R06 | - |
| F04 | Error không SQL detail | RH.error; RS.doesNotMislabelOtherInsertFailuresAsDuplicateEmail | PARTIAL | COVERED | RSR.unexpectedLookupFailureIsSanitizedWithoutWriting: injected lookup exception có SQL marker; real MVC trả500 generic và log không marker; PASS | HIGH |
| F05 | Error không stack trace | RH.error | PARTIAL | COVERED | RSR.unexpectedLookupFailureIsSanitizedWithoutWriting: ApiError đúng3 field, không stack trace/package/detail; CapturedOutput không full exception class/message; PASS | MEDIUM |
| F06 | Hash trước INSERT, password không đổi | RS.registersNormalizedUserWithExistingBcryptAndReturnsOnlyThePublicView; RP.persistsFullUtf8BoundaryPasswordAndHundredCodePointDisplayName | COVERED | COVERED | Captured INSERT hash $2x$12; encoder nhận raw; matches(raw)=true, matches(trim)=false; UTF8 boundary persisted; existing suite đã chạy lại PASS trong R06 | - |
| F07 | Registration không log password | Không có captured-output assertion | MISSING | COVERED | RSR.successfulInvalidAndDisabledDuplicateRequestsDoNotLeakLogs + RSR.unexpectedLookupFailureIsSanitizedWithoutWriting: capture stdout/stderr/application log cho201/400/409/500, không raw password/hash/SQL marker; PASS | HIGH |
| F08 | Error không echo toàn input | RH.error; RR.validationMessagesAndRepresentationsNeverContainPasswordValues | COVERED | COVERED | Error shape exactly3; no rejectedValue/password/hash; DTO toString redacted; existing suite đã chạy lại PASS trong R06 | - |
| G01 | 400 đúng code | RH.representativeHttpValidationFailuresReturn400AndNeverWriteUsers | COVERED | COVERED | 400 VALIDATION_ERROR, requestId UUID, header/body ID matching; existing suite đã chạy lại PASS trong R06 | - |
| G02 | 403 đúng code | RH.missingOrInvalidCsrfRejectsRegistrationWithoutCreatingAUser | COVERED | COVERED | 403 ACCESS_DENIED + RH.error shape/requestId/no sensitive fields; existing suite đã chạy lại PASS trong R06 | - |
| G03 | 409 đúng code | RH.duplicateEmailReturns409WithSafeErrorAndKeepsOldCredentialsUnchanged | COVERED | COVERED | 409 EMAIL_ALREADY_EXISTS + RH.error; user/hash unchanged; existing suite đã chạy lại PASS trong R06 | - |
| G04 | 415 đúng code | RH.registrationRequiresJsonContentType | COVERED | COVERED | Ba Content-Type không phải JSON ->415 UNSUPPORTED_MEDIA_TYPE và count unchanged; existing suite đã chạy lại PASS trong R06 | - |
| G05 | Error có requestId | RH.error | COVERED | COVERED | UUID.fromString(body.requestId); header X-Request-Id = body.requestId; existing suite đã chạy lại PASS trong R06 | - |
| G06 | Unexpected failure không lộ internals | RS.databaseLookupOutageIsNotAConflictAndNeverHashesOrInserts; RS.commitFailureNeverReturnsAnApparentSuccess | PARTIAL | COVERED | RSR.unexpectedLookupFailureIsSanitizedWithoutWriting:500 INTERNAL_ERROR, message cố định, requestId UUID/header matches, không INSERT,10 bảng unchanged; PASS | HIGH |
| G07 | Rejected request không thành công/không ghi | RH.representativeHttpValidationFailuresReturn400AndNeverWriteUsers; RH.registrationRequiresJsonContentType | COVERED | COVERED | Exact400/415; app_users count before=after; CSRF reject403 tương tự; existing suite đã chạy lại PASS trong R06 | - |

## C. Tests Added

`RegistrationSecurityRegressionTest.java` có 7 method / 13 invocations, không viết lại race/transaction/DTO tests cũ. Không test nào dùng tài khoản thật, fake principal, token CSRF giả hoặc AWS. Những mẫu bí mật được sinh trong bộ nhớ test và không đưa vào báo cáo này.

| Method mới | Số case | Mục tiêu/rủi ro | Kết quả mong đợi | Thực chạy focused + related |
|---|---:|---|---|---|
| `foreignSessionCsrfCannotRegisterOrAlterEitherSession` | 1 | D05: token thật thuộc session B được gắn vào session A | 403 ACCESS_DENIED; counts của 10 bảng unchanged; hai session ID/context không đổi; cùng request với token A hợp lệ mới201 | 1 PASS / 0 FAIL / 0 SKIP |
| `registrationInAnotherSessionPreservesAccountAndCsrf` | 1 | C06/C09: registration + login/logout của browser khác không phá account cũ | Session ID/principal cùng identity; toàn row user cũ không đổi; token cũ vẫn qua validation400, thiếu token403; logout B không logout A | 1 PASS / 0 FAIL / 0 SKIP |
| `newAccountCannotReadOrMutateForeignWorkspace` | 1 | E01–E05: registered principal đi qua full security/service/SQL boundaries | Project list rỗng; project/members/files404; PUT/DELETE membership404; upload404; handover read/publish404; chủ cũ vẫn OWNER; DB counts/project row unchanged | 1 PASS / 0 FAIL / 0 SKIP |
| `successfulInvalidAndDisabledDuplicateRequestsDoNotLeakLogs` | 1 | F07 + HTTP disabled duplicate; capture log success/400/409 | 201 public view; invalid byte limit400; disabled duplicate409; row/hash/enabled không đổi; không plaintext/hash trong CapturedOutput | 1 PASS / 0 FAIL / 0 SKIP |
| `unexpectedLookupFailureIsSanitizedWithoutWriting` | 1 | F04/F05/F07/G06: lỗi bất thường chứa chi tiết nhạy cảm | 500 INTERNAL_ERROR; JSON chỉ code/message/requestId; header/body UUID khớp; log không exception message/SQL/credential; counts unchanged và không INSERT | 1 PASS / 0 FAIL / 0 SKIP |
| `additionalMethodsStayProtected` | 3 | D07: HEAD/PATCH/OPTIONS trên register, có CSRF thật | Cả ba401, không user/context/write mới | 3 PASS / 0 FAIL / 0 SKIP |
| `alternatePathsWithoutCsrfCannotWrite` | 5 | D07: trailing slash, semicolon, double slash, encoded letter, encoded slash | Không token ->400 (firewall) hoặc403 (CSRF); không INSERT/DB change/principal;403 có ApiError sạch | 5 PASS / 0 FAIL / 0 SKIP |

Giới hạn bằng chứng: fault injection chỉ áp dụng `UserRepository.existsByEmail` ở đúng một email riêng trong một test, bằng MockitoSpyBean reset sau test. Điều này chứng minh real Spring advice và log sanitation trước lỗi lookup; không giả rằng đã ngắt PostgreSQL hoặc kiểm chứng lỗi commit bằng mock. SQL integrity/constraint/rollback/concurrency dùng PostgreSQL thật trong RP và suite đầy đủ. Các URI probes chạy qua MockMvc/StrictHttpFirewall; không thay thế kiểm tra canonicalization của reverse proxy hoặc servlet container trên hạ tầng triển khai.

Fixture: UUID/email prefix riêng từng test, không TRUNCATE/CASCADE, không phụ thuộc thứ tự; cleanup chỉ owned project/child rows và owned email, sau đó so count 10 bảng với trước test. Lớp mới chạy SAME_THREAD; Maven/JUnit cấu hình hiện hành không bật parallel suites. Ba database riêng được runner R06 tạo và xác minh schema public rỗng trước focused/related/verify; RUN_DB_TESTS=true chỉ truyền vào child process trỏ loopback container do chính task sở hữu. Container có ownership label; cleanup kiểm tra ID và label trước khi xóa.

## D. Security Findings

### Bằng chứng audit source và kiểm thử

- HTTP/public/CSRF: `AuthController.register` chỉ POST JSON + Valid, trả201 sau service; `SecurityConfig.security` permit đúng POST register, không tắt CSRF. Token lấy bằng `AuthController.csrf`, dùng cookie session thật. AF chỉ bypass enabled lookup cho đúng POST register; protected endpoints vẫn kiểm tra DB và fail closed.
- Input: RR + `RegistrationRequest` strict JSON string/null/unknown-field handling; Unicode whitespace; name sau strip <=100 code points; email trước/sau normalize <=254; password >=8 code points, <=72 byte UTF-8; confirmation exact. Client validation không thay backend authority. Các giới hạn này khớp tài liệu R01 và OpenAPI R05; vendor extensions mô tả phép đếm mà maxLength đơn thuần không biểu diễn được.
- Hash: `SecurityConfig.passwordEncoder` là BCrypt cost12; `RegistrationService.register` đưa raw password vào encode trước INSERT, không trim/lowercase password, hash ngoài DB transaction. RR/RS/RP đã kiểm tra 72/73-byte và raw-vs-trim; captured logs R06 kiểm tra thêm success/failure dưới cấu hình log hiện tại.
- Persistence: service trim/lowercase Locale.ROOT, strip tên, revalidate email sau Unicode expansion; lookup tồn tại gồm cả disabled. INSERT bind parameters và ON CONFLICT ON CONSTRAINT uq_user_email DO NOTHING; transaction commit trước trả view. Constraint thật V1 và tests RP xác minh race, unrelated violations, rollback và không đổi account cũ. Không suppress mọi unique violation thành EMAIL_ALREADY_EXISTS.
- Session/quyền: UserView chỉ id/email/displayName; không auto-authentication, không default project/membership; quyền theo DB membership/recipient, không dựa vào việc account mới hay JWT. Không có quy tắc cấm người đang login đăng ký account khác; public registration từ disabled session vẫn được phép nhưng protected access bị chặn theo đặc tả.
- Error: ApiError đúng ba field, requestId do filter sinh UUID; advice không echo rejected input. Handler unexpected chỉ log requestId và simple exception class, không log exception message/SQL/payload. Fault500 mới kiểm chứng điều này qua full MVC và CapturedOutput.
- Datasource nhận qua env; Flyway clean-disabled=true; không sửa schema/config. Cookie chỉ theo cookie tracking, HttpOnly, SameSite=lax; Secure mặc định true, local profile có override cho localhost. Audit local không xác nhận cấu hình cookie/HTTPS trên AWS.

### Findings còn OPEN — rủi ro triển khai public, không phải lỗi bypass đã tái hiện

Các mức dưới đây là đánh giá dựa trên source đã audit; chưa đo tải hoặc kiểm chứng lớp bảo vệ bên ngoài ứng dụng. Không tự đánh dấu ACCEPTED_RISK hay RESOLVED thay chủ dự án.

| ID | Mức độ | Mô tả và bằng chứng | Hậu quả tiềm tàng | Đề xuất cho đợt được phê duyệt sau | Trạng thái |
|---|---|---|---|---|---|
| R06-F01 | MEDIUM | Chưa có application rate limit/chống đăng ký hàng loạt. SecurityConfig permit public POST; service mỗi email mới chạy BCrypt12 và INSERT. Không có throttle/captcha/anti-bot component hoặc dependency trong authentication flow/config đã đọc. CSRF token public không phải cơ chế giới hạn số lần đăng ký. | Có thể tạo nhiều account, tiêu tốn CPU/DB nếu endpoint mở public mà không có bảo vệ bên ngoài. Chưa thực hiện load/abuse test; không khẳng định đã gây DoS. | Chốt chính sách throttle/quota/giám sát trước public exposure; kiểm chứng control ở ứng dụng hoặc gateway theo phê duyệt riêng. Không thêm control trong R06. | OPEN |
| R06-F02 | MEDIUM | Chưa xác minh quyền sở hữu email. Service chỉ format/normalize và tạo enabled=true; schema không có email_verified, không có email verification flow. | Có thể đăng ký bằng email chưa chứng minh thuộc mình, gây chiếm chỗ email hoặc hiểu sai danh tính. Không tự cấp quyền project: boundary404 đã được kiểm thử. | Chốt quy trình xác minh email hoặc provisioning/kiểm tra danh tính trước khi dùng email làm bằng chứng tin cậy. Không triển khai OTP/email verification trong R06. | OPEN |
| R06-F03 | LOW | EMAIL_ALREADY_EXISTS409 khác với201 của email chưa có. Đây là contract R01/R03/R05 có chủ đích, được tests xác nhận. | Endpoint public có thể bị dùng dò email tồn tại; tốc độ/rủi ro phụ thuộc control bên ngoài chưa kiểm chứng. | Chủ dự án cân nhắc trade-off UX/privacy, throttle và monitoring. Chỉ thay response khi được phê duyệt thay contract. | OPEN |
| R06-F04 | LOW | Chưa có công tắc bật/tắt registration riêng: matcher public và controller/service được bật vô điều kiện; application.yml không có registration-enabled flag. | Khi cần đóng đăng ký phải thay code hoặc dùng control triển khai bên ngoài. Chưa kiểm chứng có gateway rule như vậy hay chưa. | Cân nhắc feature flag hoặc runbook kiểm soát exposure trong task được duyệt riêng. Không sửa SecurityConfig/config/hạ tầng ở R06. | OPEN |

Tổng: 0 CRITICAL / 0 HIGH / 2 MEDIUM / 2 LOW. Chưa phát hiện blocking defect từ source và focused tests. Các rủi ro public kể trên nằm ngoài yêu cầu triển khai R06 và chưa được khắc phục.

## E. Regression Results — thực chạy R06

Tất cả lệnh dưới đây đã chạy trên source R05 + test R06 mới, không sao chép kết quả baseline. Maven dùng wrapper, `-B -ntp`; truyền Mockito agent từ cache qua argLine để tương thích JVM hiện có, không sửa dependency/config. RUN_DB_TESTS=true và URL/credentials child process được tạo riêng; không đọc credential DB thật.

| Gate / lệnh | PASS | FAIL | ERROR | SKIP | Bằng chứng |
|---|---:|---:|---:|---:|---|
| `mvnw.cmd -B -ntp -Dtest=RegistrationSecurityRegressionTest test` | 13 | 0 | 0 | 0 | security-focused-result.json; PostgreSQL r06_security |
| `mvnw.cmd -B -ntp -Dtest=RegistrationRequestTest,RegistrationServiceTest,RegistrationPersistenceTest,RegistrationHttpIntegrationTest,ActiveAccountFilterTest,RegistrationSecurityRegressionTest test` | 208 | 0 | 0 | 0 | registration-related-result.json; PostgreSQL r06_related |
| `mvnw.cmd -B -ntp verify` | 268 | 0 | 0 | 0 | backend-verify-result.json; PostgreSQL r06_verify |
| `npm run lint` | PASS | 0 | 0 | 0 | frontend-lint.log |
| `npm test` | 60 | 0 | 0 | 0 | frontend-unit.log |
| `npm run build` | PASS | 0 | 0 | 0 | frontend-build.log |
| `npm run test:e2e` | 356 | 0 | 0 | 0 | frontend-browser-mock.log; browser mock, không phải AWS |
| `python frontend/tools/run_live_check.py` | 3 browser + 268 backend | 0 | 0 | 0 | real-live-verification.json: PASS_LOCAL_REAL_BACKEND; runner nguyên bản |

Kết quả từng registration class của related run (full verify và live runner cũng chạy đủ):

| Test class | PASS | FAIL | ERROR | SKIP |
|---|---:|---:|---:|---:|
| RegistrationRequestTest | 105 | 0 | 0 | 0 |
| RegistrationServiceTest | 32 | 0 | 0 | 0 |
| RegistrationPersistenceTest | 12 | 0 | 0 | 0 |
| RegistrationHttpIntegrationTest | 34 | 0 | 0 | 0 |
| ActiveAccountFilterTest | 12 | 0 | 0 | 0 |
| RegistrationSecurityRegressionTest | 13 | 0 | 0 | 0 |

Backend 268 = toàn bộ 255 test R05 giữ nguyên +13 test mới. Frontend giữ60 và browser mock giữ356; không giảm coverage, không bỏ hoặc nới assertion. Trong 3 live browser tests, test auth hiện có của R05 thực sự gửi UI registration qua Vite → Spring → PostgreSQL, nhận201, auth/me vẫn401, sau đó chủ động login bằng account vừa tạo, project list rỗng và logout. Hai test còn lại kiểm tra permission và S3-disabled fail-closed. Không gọi AWS/S3/Lambda thật.

Database cleanup: PASS. Container R06 có ba DB disposable đã được đối chiếu ownership rồi xóa; runner live độc lập cũng ghi testDatabaseRemoved=true cho container hai DB riêng của nó. Không để lại test DB/container do task tạo. Đây là dữ liệu kiểm thử cục bộ, không production/staging/shared DB.

Evidence R06 trong thư mục Git-ignored `D:/cloud-document-handover-registration/runtime-data/c09-r06-20261111-5cd307212b/`: coverage-initial.json (trước implementation), coverage-final.json, backend-result.json và từng phase log/result, frontend-result.json và logs, real-live-verification.json, real-live-runner.log, tracked-baseline.json, original-files.json, refs-before.txt. Build/browser artifacts và runtime evidence không stage/commit.

## F. Kết luận và giới hạn

**R06 PASS; không phát hiện blocking defect trong phạm vi audit/test đã thực thi; đủ điều kiện nhận yêu cầu C09-R07.** Có bằng chứng thực cho CSRF khác session, session/account isolation, quyền của newly registered account, password hashing/raw preservation, database integrity/rollback/race/disabled duplicate, sanitization của expected errors và injected500, không log credential trong các case đã capture. Bốn finding public-deployment vẫn OPEN (0 critical/0 high/2 medium/2 low); không có bản sửa production trong R06 và không giả rằng các risk đã được owner chấp nhận.

Chưa kiểm thử: AWS E2E (NOT_RUN), kiểm thử tải/abuse, email delivery/verification (chưa có tính năng), kiểm soát gateway/proxy/TLS/logging thực tế, toàn bộ canonicalization ngoài các URI probes đã nêu, log ở cấu hình debug hoặc ingestion bên ngoài, JVM21 runtime (local dùng JDK25 compile release21 theo POM). Local test PASS không chứng minh production/AWS đã an toàn hoặc sẵn sàng triển khai. Không tuyên bố bảo mật tuyệt đối.

Chỉ tạo hai file R06. Toàn bộ source/config/contract/frontend/tests cũ phải giữ nguyên từng byte qua hash baseline trước commit. Không push, không PR, không merge hoặc sửa branch dung/worktree cũ; không deploy AWS; không thực hiện R07. Commit local sau staged diff/scope/security review; commit SHA được ghi ở kết quả cuối để tránh self-reference trong tài liệu đã commit.
