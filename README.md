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
