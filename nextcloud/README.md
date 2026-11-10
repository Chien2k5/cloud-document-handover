# Nextcloud Local Setup

## Mục đích

Môi trường thử nghiệm Nextcloud local cho dự án Cloud Document Handover.

## Thành phần

- Nextcloud 35.0.1 Apache
- PostgreSQL 17 Alpine
- Redis 7 Alpine

## Chuẩn bị biến môi trường

Từ thư mục gốc của repository, tạo file `.env` từ file mẫu:

```powershell
Copy-Item .\nextcloud\.env.example .\nextcloud\.env
```

Chỉ tạo file khi chưa có `.env`; giữ nguyên cấu hình nếu đã cài Nextcloud trước đó.
Mở `nextcloud/.env`, đặt `NEXTCLOUD_DB_PASSWORD` riêng thay cho `change_me`
và giữ `NEXTCLOUD_PORT=8081` để không trùng cổng backend Java mặc định `8080`.
Không commit file `.env` thật. Compose đọc biến qua `--env-file` trong các lệnh dưới.

## Khởi động và kiểm tra

Chạy từ thư mục gốc repository:

```powershell
docker compose --env-file nextcloud/.env -f nextcloud/compose.nextcloud.yml config --quiet
docker compose --env-file nextcloud/.env -f nextcloud/compose.nextcloud.yml up -d
docker compose --env-file nextcloud/.env -f nextcloud/compose.nextcloud.yml ps
```

Mở <http://localhost:8081>. Lần đầu, tạo tài khoản quản trị trong trình cài đặt
Nextcloud. Database dùng service `db`, với tên database, user và mật khẩu theo
`nextcloud/.env`. Nếu ứng dụng chưa sẵn sàng, xem log rồi thử lại:

```powershell
docker compose --env-file nextcloud/.env -f nextcloud/compose.nextcloud.yml logs --tail 100 app db
```

## Dừng môi trường

```powershell
docker compose --env-file nextcloud/.env -f nextcloud/compose.nextcloud.yml down
```

Lệnh trên giữ các named volume chứa dữ liệu Nextcloud và PostgreSQL.
Mật khẩu database trong `.env` phải khớp database đã khởi tạo; thay biến môi trường
không tự đổi mật khẩu trong database hiện có.

## Phạm vi

Đây là môi trường Nextcloud local độc lập. Backend Java và luồng S3/Lambda
chạy riêng; merge source chưa bổ sung adapter Nextcloud hoặc đồng bộ file/quyền.
