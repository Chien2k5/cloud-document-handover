# Evidence bản chốt backend tuần 5

Ngày 29/10/2026, nhánh dung trên nền 3a2c32f + source tuần 5. Windows, Java Temurin 25 target 21, Maven Wrapper 3.9.12, PostgreSQL/client tools 17.9. Mọi DB là fixture riêng trên 127.0.0.1:55434; không dùng tài nguyên hoặc credential AWS.

| Suite | Kết quả | Giới hạn chứng minh |
| --- | --- | --- |
| Maven verify, RUN_DB_TESTS=true | BUILD SUCCESS, 51 tests, 0 failures/errors/skipped; kết thúc 01:29:14 UTC+07 | 3 unit filter, 10 DB nền tảng, 4 contract, 13 upload, 21 handover; StoragePort fixture |
| JAR tools/run_http_smoke.py | 48 request checks PASS | Auth/quyền/CSRF; thiếu adapter phải 503 và bù quota |
| JAR tools/run_phase1_http_regression.py | 70 request checks PASS | JSON/415/406/disabled/public/logout; timeout test 60s, chờ 65s không request để kiểm expiry thật |
| Restore bản chốt | PASS, 11 bảng/hash khớp, 18 FK validated; 51 HTTP request checks nguồn/đích | SQL metadata fixture, target không seed user; không có S3 bytes/Lambda |
| Bundle source/CRC/hash và build giải nén | Thực hiện sau commit theo tool đóng gói | Kết quả/commit/SHA và build portable ở sidecar output, không lấy DB suites SKIPPED làm DB PASS |
| AWS/UI/chi phí Cloud | NOT RUN / chưa có dữ liệu | Chờ các đầu vào nhóm trong checklist tuần 5 |

JAR hash trong source-hashes.json khớp JAR dùng trong restore thành công. Không rebuild main giữa các suite JAR/restore của lần chốt. Test counts và HTTP assertions là đơn vị khác nhau, không cộng thành số kịch bản độc lập.

Các ca C07 mới: concurrentRevokePreservesConfirmedWorkflowAndWritesOneAudit, failedRevokeAuditRollsBackAccessBeforeSuccessfulRetry, revokeHttpAuditUsesAuthenticatedActorAndServerRequestId. Tên/count chi tiết trong junit-summary.txt; HTTP status và tổng ở http-smoke.txt/http-regression.txt/restore-http.txt. Raw Surefire environment/properties, cookie/token/password và log JAR không đưa vào evidence.

DB JUnit/smoke/regression là week5_junit_20261029, week5_http_20261029, week5_regression_20261029. Restore tự tạo hai DB mới có tên trong ../local-restore/restore-result.json. Lượt restore đầu chạy song song bị FATAL too many clients của cluster fixture; không ghi lượt đó là PASS. Đã giới hạn pool chỉ trong JAR script restore (max 3, min idle 1) rồi chạy lại hoàn tất PASS. Log lỗi gốc ở runtime-data bị ignore; run-status.json ghi lượt mới nhất.

Restore cuối đo dump 0,515s, restore 0,219s, target boot 4,922s trên bộ fixture nhỏ; không phải RTO/RPO AWS. Archive có password hashes ở runtime-data, không commit/đóng gói. Mọi bảng khớp trước/sau và sau các request đọc/confirm lặp; quota, pin v1, người nhận, state và confirmedAt được giữ nguyên. Download thiếu adapter trả 503 để không suy DB restore thành S3 thành công.

github-snapshot.json ghi refs và cây mã B01 đã đọc qua GitHub connector; chưa thấy source S3/React mới trên các nhánh đó. Không kết luận về phần các bạn chưa push. source-hashes.json lưu raw workspace bytes của backend/test/tools/config/contracts; evidence lịch sử tuần 1–4 giữ nhãn cũ, không dùng hash cũ làm chứng minh code mới.

Lệnh tái hiện ở docs/week-05/final-handover.md và demo-script.md. Full DB suite phải dùng DB thử có thể xóa dữ liệu; tests TRUNCATE bảng nghiệp vụ. Script restore chỉ loopback và DB mới; mặc định đường evidence tuần 4, tuần 5 thêm --evidence-dir evidence/week-05/local-restore. Chạy tuần tự hoặc điều chỉnh fixture nếu cluster local ít connection. Các script tự dừng JAR; PostgreSQL fixture được dừng sau công việc.

Pattern scan và đọc diff hỗ trợ rà soát; không khẳng định tuyệt đối không có mọi dạng secret. Không tự xác nhận review Nam/Đăng/Chiến, deploy AWS, main merge hoặc G2–G5 Cloud PASS.
