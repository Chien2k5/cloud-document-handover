# Ma trận C06 và kiểm tra phục hồi local

Ngày 29/10/2026. PASS local dưới đây thuộc lần Maven verify 48 tests, không phải kết quả AWS. Tên ca là method trong `backend/src/test/java/vn/edu/uet/handover/`; chi tiết đếm ở `evidence/week-04/backend/junit-summary.txt`.

| Mã | Yêu cầu/ca lỗi | Bằng chứng | Kết quả và phạm vi |
| --- | --- | --- | --- |
| C06-01 | Project A không đọc project B; Owner do server gán | BackendIntegrationTest.projectsAreIsolatedAndOwnerIsAssignedByServer | PASS PostgreSQL/HTTP local |
| C06-02 | Đổi upload/file/project ID qua HTTP không đọc/complete nhầm, không đổi quota | UploadIntegrationTest.httpCrossProjectUploadAndFileIdsAreHiddenWithoutStateChanges | PASS, mới tuần 4 |
| C06-03 | Đổi handover/item ID qua HTTP không xem/publish/confirm/revoke gói khác | HandoverIntegrationTest.httpForeignHandoverAndFileIdsCannotReadOrMutateAnotherProject | PASS, mới tuần 4 |
| C06-04 | Không giả mạo actor/status, CSRF bắt buộc; session disabled bị chặn | HandoverIntegrationTest.httpRejectsForgedFieldsBadTypesNoBodyCsrfAndDisabledSession; BackendIntegrationTest.disabledAccountLosesExistingReadAndWriteSessions | PASS local |
| C06-05 | Người nhận ngoài project chỉ đọc đúng gói; recipient bị revoke mất quyền | HandoverIntegrationTest.externalRecipientGetsOnlyNamedPackageAndItem | PASS local; SQL revoke recipient là fixture, không có API quản trị mới |
| C06-06 | Chưa AVAILABLE/VERIFIED, mismatch hoặc lỗi integrity không được phát hành | HandoverIntegrationTest.publicationRejectsUnverifiedStatesAndDisabledRecipient | PASS local |
| C06-07 | JSON checksum sai bucket/key/version/size/time/type/duplicate field không VERIFIED | UploadIntegrationTest.checksumMalformedWrongIdentityAndTerminalStates | PASS; tuần 4 bổ sung bucket/key/time, storage fixture |
| C06-08 | Kết quả lỗi/trễ không ghi đè VERIFIED | UploadIntegrationTest.staleConcurrentPollCannotOverwriteVerifiedResult | PASS concurrent PostgreSQL + fixture |
| C06-09 | Upload v2 không đổi phiên bản trong gói đã chốt | HandoverIntegrationTest.completeWorkflowPinsV1AndRecordsEachRecipientOnce | PASS logic DB/StoragePort; chưa tải byte S3 |
| C06-10 | Quota concurrent không vượt giới hạn; rollback không để metadata/reservation lệch | UploadIntegrationTest.quotaConcurrentReservationsUseRealSeparateTransactions; databaseRollbackLeavesNoReservationOrMetadata | PASS PostgreSQL thật |
| C06-11 | Complete lặp/concurrent hoặc gặp expiry không tăng dung lượng hai lần | UploadIntegrationTest.concurrentCompleteOnlyMovesQuotaAndAuditsOnce; expiryWinsWhileHeadIsInFlightWithoutDoubleRelease | PASS PostgreSQL thật |
| C06-12 | Publish/confirm đồng thời không trùng audit, aggregate status đúng | HandoverIntegrationTest.concurrentPublishAndConfirmRemainIdempotent | PASS, 4 publish / 6 confirm cho 2 người nhận |
| C06-13 | Lỗi audit khi confirm rollback cả timestamp và aggregate status | HandoverIntegrationTest.failedConfirmationAuditRollsBackAcknowledgementAndAggregateStatus | PASS, mới tuần 4 |
| C06-14 | Gói nhiều file, một HEAD thiếu thì không phát hành một phần | HandoverIntegrationTest.multiItemPublicationIsAtomicWhenOneHeadIsMissing | PASS, mới tuần 4 |
| C06-15 | Thu hồi một recipient trong signer chặn trả URL | HandoverIntegrationTest.individualRecipientRevocationDuringSigningBlocksTheResponse | PASS, mới tuần 4 |
| C06-16 | Deadline qua trong signer không trả URL hết hạn | HandoverIntegrationTest.expiryDuringSigningPreventsReturningAnExpiredUrl | PASS, mới tuần 4 |
| C06-17 | Owner mất quyền trong HEAD thì không READY | HandoverIntegrationTest.ownerDemotionDuringHeadPreventsPublication | PASS, mới tuần 4; SQL đổi role là fixture |
| C06-18 | Revoke/expiry trong HEAD; signer vượt hạn hoặc HTTP URL bị chặn | HandoverIntegrationTest.revokeOrExpiryDuringHeadCannotPublish; signerCannotExtendLifetimeOrBypassRevoke | PASS local |
| C06-19 | Revoke giữ lịch sử và chặn confirm/download mới | HandoverIntegrationTest.revokeIsIdempotentAndPreservesConfirmationHistory | PASS local; hiệu lực URL đã cấp trên S3 chưa đo |
| R-01 | pg_dump/pg_restore sang DB mới, dữ liệu mọi bảng khớp | tools/run_local_restore_check.py; evidence/week-04/local-restore/restore-result.json | PASS, 11 bảng gồm Flyway |
| R-02 | FK, quota và HandoverItem liên kết đúng sau restore | Cùng script: invariants | PASS, 18 FK validated, 0 project sai quota, 0 item sai liên kết |
| R-03 | Đăng nhập không seed target; manifest, quyền và confirmedAt giữ nguyên | Cùng script: verify_http và snapshot sau HTTP | PASS, 51 HTTP request checks nguồn + đích |
| R-04 | Storage chưa cấu hình không biến DB restore thành download thành công giả | Cùng script: project/handover download trả 503 STORAGE_UNAVAILABLE | PASS fail closed; S3 NOT RUN |

## Các mục vẫn cần môi trường chung

| Mục | Trạng thái tuần 4 | Người phối hợp |
| --- | --- | --- |
| B04: S3 events/Lambda trùng, trễ, timeout trên AWS | NOT RUN | Đăng |
| A05: Beanstalk/HTTPS/IAM/networking và DB không public | NOT RUN | Chiến |
| A06: backup tới S3, restore trên môi trường chung | NOT RUN | Chiến; Dũng kiểm metadata, Đăng kiểm S3 version |
| D04: browser E2E trên AWS và đo URL đã phát hành trước revoke | NOT RUN | Nam, Đăng, Chiến, Dũng |
| Servlet session expiry TCP bằng chờ thực | Không chạy lại tuần 4; có evidence lịch sử tuần 2 | Dũng/Nam chạy lại khi cấu hình/session code thay đổi |

Không lấy fixture HEAD/checksum làm kết quả Lambda thật. C06 local có thể ghi đạt ở phạm vi trên; G4 nhóm chưa nghiệm thu vì AWS E2E/restore S3 và truy xuất version thật còn thiếu. Các số test JUnit là test methods, số HTTP của restore là request assertions; không cộng chúng thành số kịch bản độc lập.
