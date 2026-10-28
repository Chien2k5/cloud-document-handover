# Đóng góp backend theo lịch sử Git

Nguyễn Huy Dũng phụ trách Spring Boot/PostgreSQL, hợp đồng dữ liệu/API, quyền, metadata/trạng thái upload, đối soát checksum, bàn giao và kiểm thử backend. Bảng này đối chiếu đầu ra repo; không tự xác nhận số giờ thực tế hoặc phần đã triển khai trên AWS.

| Commit | Thời điểm commit UTC+07 | Đầu ra | Evidence tương ứng |
| --- | --- | --- | --- |
| ef79ee3 | 15/10/2026 23:09 | Khung backend, Flyway/ERD/OpenAPI, auth/Project/Membership | evidence/week-01 |
| bd4a897 | 29/10/2026 00:04 | Sửa auth/validation và upload workflow qua StoragePort, quota/expiry/integrity/version/download | evidence/week-02/backend, 29 JUnit và các snapshot Phase 1 được ghi riêng |
| a44a78a | 29/10/2026 00:30 | DRAFT/READY/CONFIRMED, quyền người nhận ngoài dự án, pin version, revoke/audit cơ bản | evidence/week-03/backend, 41 JUnit |
| 3a2c32f | 29/10/2026 01:20 | C06 thêm 7 ca, kiểm checksum identity, công cụ pg_dump/pg_restore và runbook | evidence/week-04: 48 JUnit, restore 11 bảng và 51 HTTP checks |
| Bản chốt tuần 5 | Commit chứa tài liệu này; manifest ZIP ghi SHA đầy đủ | C07 revoke/audit coverage, hồi quy cuối, tài liệu/config và gói source có manifest | evidence/week-05 và output sidecar manifest |

Tuần 1–5 là nhãn phân rã công việc theo kế hoạch, không phải bằng chứng đã trôi qua năm tuần lịch. Thời điểm commit khác thời điểm bắt đầu công việc hoặc ngày chạy test; xem ngày/source hash trong từng evidence. Các báo cáo Phase 1 ngày 22/10 được commit cùng thay đổi sau đó, không sửa lịch sử để giả thời gian.

Các ranh giới còn lại: Đăng sở hữu adapter S3/Lambda; Chiến sở hữu AWS/deploy/backup/chi phí; Nam sở hữu frontend/E2E/demo toàn nhóm. Repo được kiểm chưa có các module S3/React mới; kết quả làm riêng chưa push phải do thành viên xác nhận. Dũng cần đọc hiểu code, chạy lại theo hướng dẫn và phối hợp kiểm tra chéo trước nộp.
