# Checklist chốt backend và nghiệm thu nhóm

Ngày 29/10/2026. PASS LOCAL là kết quả kiểm trên máy với PostgreSQL/Tomcat thật; fixture storage chỉ ở test. NOT RUN là chưa có lượt kiểm chứng, không phải PASS. Evidence hiện tại ở evidence/week-05/backend và local-restore.

| Hạng mục | Trạng thái phần Dũng | Bằng chứng/đầu ra |
| --- | --- | --- |
| C07 Owner thu hồi gói, chặn URL/xác nhận mới, giữ lịch sử | PASS LOCAL | HandoverIntegrationTest.revokeIsIdempotentAndPreservesConfirmationHistory; signerCannotExtendLifetimeOrBypassRevoke |
| Thu hồi gói đã CONFIRMED đồng thời | PASS LOCAL | concurrentRevokePreservesConfirmedWorkflowAndWritesOneAudit: 5 request, 1 audit, timestamps giữ nguyên |
| Lỗi audit rollback thu hồi | PASS LOCAL | failedRevokeAuditRollsBackAccessBeforeSuccessfulRetry |
| Audit đúng actor/target/requestId/thời điểm server | PASS LOCAL | revokeHttpAuditUsesAuthenticatedActorAndServerRequestId; không tin X-Request-Id client |
| C06 quyền, checksum, quota, phiên bản, race và rollback | Bộ test hiện tại PASS LOCAL; chưa đủ chốt C06 theo PDF | Còn thiếu điều kiện VERIFIED ngay ở create-handover theo process2.pdf trang 8–9; test hiện cho phép unverified trong DRAFT. Cần sửa logic/contract/test riêng |
| HTTP JAR, CSRF/login/logout/disabled/session expiry thật | PASS LOCAL | 48 smoke + 70 regression request checks; token/cookie/password không giữ trong evidence |
| Backup/restore DB local bản chốt | PASS LOCAL | run-status.json PASS/complete; 11 bảng/hash, 18 FK và 51 HTTP checks |
| README/config/OpenAPI/hướng dẫn chạy | Đã rà soát | README bỏ hướng dẫn Nextcloud cũ gây nhầm; backend/.env.example và root tên biến upload đồng bộ |
| Source bundle và manifest commit/SHA | Có tool đóng gói, kiểm CRC/hash | build_handover_bundle.py; output/backend-handover-dung.zip và sidecar manifest sau commit |
| Build gói sau giải nén | Kiểm riêng sau tạo ZIP | Maven verify với DB suites SKIPPED nếu không bật RUN_DB_TESTS; không lấy lượt đó làm PostgreSQL PASS |

## Những mục cần nhóm thực hiện trước nộp Cloud

| Mục | Trạng thái | Người xử lý/đầu vào cần có |
| --- | --- | --- |
| Review OpenAPI/StoragePort và retry UX | Nam đồng ý luồng upload tổng thể; Đăng gửi POC, review chi tiết còn mở | [Nam](../../evidence/week-01/nam-upload-flow-confirmation.md), [review Đăng](../week-02/dang-s3-adapter-review.md); chưa duyệt commit/schema/error/retry chung, Chiến chưa xác nhận |
| S3 adapter/Lambda thật, checksum đúng Version ID | Đã nhận POC Python; Java/Lambda/AWS integration NOT RUN | [Khác biệt và hướng ghép](../week-02/dang-s3-adapter-review.md): Java port, HEAD exact version, signed headers, JSON/result key; cần source Lambda/commit/log thật |
| Beanstalk/HTTPS/IAM/DB/private bucket/CORS | NOT RUN | Chiến cung cấp môi trường, region/bucket, runbook và log; không đưa secret vào Git |
| Tài khoản người dùng/người nhận trên môi trường chung | Chưa được xác nhận | Nhóm chốt provisioning tài khoản enabled; backend chưa có registration/invitation, không bật local demo seed trên AWS |
| Upload → VERIFIED → READY → CONFIRMED trên browser | NOT RUN | Nam ghép UI, Dũng/Đăng/Chiến hỗ trợ; lưu commit, thời điểm và PASS/FAIL |
| Thu hồi URL thực tế và hard quota/cleanup S3 | NOT RUN | Nam/Đăng/Chiến đo URL đã cấp, conditional PUT, size/chi phí/orphan cleanup |
| Backup tới S3, restore chung và HEAD/GET đúng version | NOT RUN | Chiến restore DB tách biệt; Dũng kiểm metadata/audit, Đăng kiểm file S3, Nam thử UI |
| A07 CloudWatch/chi phí/dọn tài nguyên | Chưa có dữ liệu tài khoản để đối chiếu | Chiến xuất log/bảng chi phí thực; chỉ dọn tài nguyên được phép sau demo và giữ dữ liệu cần nộp |
| D05 README/video/gói minh chứng toàn nhóm | Phần backend đã chuẩn bị; bản toàn nhóm chưa nghiệm thu | Nam tổng hợp clip/E2E, Chiến tổng hợp báo cáo/đóng góp; nhóm kiểm tra chéo |

GitHub được đọc trực tiếp: main ở 0e70ee2, dung ở nền 3a2c32f trước bản chốt, nhánh task/B01-nextcloud-local ở c83f36a chỉ có Nextcloud cũ. Chưa thấy frontend hoặc adapter AWS mới trong các nhánh đó. Không suy ra phần làm riêng chưa push của thành viên khác đã/chưa hoàn thành.

G2/G3/G4/G5 Cloud chưa được tự đánh dấu đạt. Chỉ đóng mốc khi có người kiểm tra chéo, commit triển khai, môi trường và evidence thật. Không tạo số chi phí, URL, clip hoặc kết quả Lambda giả để hoàn thiện báo cáo.
