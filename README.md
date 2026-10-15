# Backend tuần 1 trên nhánh dung

Phần triển khai hiện tại dùng **Spring Boot, PostgreSQL, Flyway** theo báo cáo tiến độ và kế hoạch 5 tuần mới do Dũng cung cấp. Phần S3/Lambda/bàn giao đang ở mức hợp đồng API, chưa tích hợp AWS.

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
