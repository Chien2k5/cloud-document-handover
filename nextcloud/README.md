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