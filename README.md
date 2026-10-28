# Backend tuần 4 trên nhánh dung

Cập nhật 29/10/2026: [báo cáo tuần 4 độc lập](docs/week-04/report.md), [ma trận C06](docs/week-04/c06-test-matrix.md), [runbook backup/restore local](docs/week-04/local-restore-runbook.md). Đã kiểm thử 48/48 JUnit và phục hồi PostgreSQL local với 11 bảng khớp, 51 HTTP request checks; G4 AWS chung còn chờ nhóm.

Phần triển khai hiện tại dùng **Spring Boot, PostgreSQL, Flyway** theo báo cáo tiến độ và kế hoạch 5 tuần. Đã có auth/Project/Membership, upload/quota/checksum và nghiệp vụ bàn giao DRAFT → READY → CONFIRMED, download đúng phiên bản, thu hồi cơ bản. StoragePort chưa có adapter S3/Lambda thật hoặc môi trường AWS được xác nhận.

Cập nhật 29/10/2026: [báo cáo backend tuần 3](docs/week-03/backend-report.md), [hướng dẫn Dũng tự kiểm tra và ghép nhóm](docs/week-03/huong-dan-cho-dung.md), [bằng chứng hiện tại](evidence/week-03/backend/README.md). Các báo cáo tuần 1/2 bên dưới là lịch sử của các lần triển khai trước.

Cập nhật ngày 28/10/2026: [báo cáo backend tuần 2](docs/week-02/backend-completion.md), [câu hỏi gửi Đăng/Chiến/Nam](docs/week-02/team-integration-questions.md). Các báo cáo Phase 1 ngày 22/10 là snapshot lịch sử, không đại diện trạng thái triển khai mới.

Khi chưa có adapter thật, ứng dụng trả 503 STORAGE_UNAVAILABLE, không cấp URL giả. Storage fixture chỉ nằm trong test. Chưa nghiệm thu upload S3, conditional PUT, Lambda, IAM/CORS hoặc browser AWS. Xem [hợp đồng adapter để Đăng review](contracts/s3-adapter-contract.md) và [bằng chứng tuần 2](evidence/week-02/backend/README.md).

- [Chạy và kiểm thử backend](backend/README.md)
- [Bàn giao tuần 1 và các điểm cần nhóm review](docs/week-01/README.md)
- [OpenAPI cho Nam và Đăng](contracts/openapi.yaml)
- [ERD sửa được bằng Mermaid](docs/week-01/erd.mmd)
- [Kết quả thực tế và phần còn thiếu](docs/week-01/report.md)

Nội dung phía dưới là mô tả **kiến trúc Nextcloud cũ**, được giữ lại để đối chiếu; không dùng làm hướng dẫn chạy backend tuần 1. Tài liệu cũ trong `docs/tv3/` cũng chưa được chuyển sang kế hoạch S3 mới.

# cloud-document-handover
Dịch vụ lưu trữ, phân quyền và bàn giao tài liệu cho nhóm nhỏ trên AWS
# Dịch vụ lưu trữ và bàn giao tài liệu trên AWS

## Mục tiêu
Tập trung tài liệu theo dự án, phân quyền thành viên,
tạo gói bàn giao có thời hạn truy cập và hỗ trợ khôi phục dữ liệu.

## Phạm vi MVP
- Quản lý dự án và thành viên.
- Upload/download qua giao diện Nextcloud.
- Tạo gói bàn giao từ các tài liệu được chọn.
- Chia sẻ, theo dõi và thu hồi link.
- Backup và kiểm thử restore.

## Phân công
- TV1: AWS, triển khai và vận hành.
- TV2: Nextcloud, quyền file và adapter.
- TV3: Backend, database portal và quy trình bàn giao.
- TV4: Frontend, kiểm thử và pilot.

## Công nghệ
Đã thống nhất: AWS, Nextcloud.
Các lựa chọn còn lại được theo dõi trong docs/decisions.md.

## Hướng dẫn chạy
TV1 cập nhật khi môi trường chung A01 sẵn sàng.

## Quy trình đóng góp
Xem CONTRIBUTING.md.
