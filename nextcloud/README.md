\# Nextcloud Local Setup



\## Mục đích

Môi trường thử nghiệm Nextcloud local cho dự án Cloud Document Handover.



\## Thành phần

\- Nextcloud 35.0.1 Apache

\- PostgreSQL 17 Alpine

\- Redis 7 Alpine



\## Chạy hệ thống



Từ thư mục gốc của repository:



```powershell

docker compose -f .\\nextcloud\\compose.nextcloud.yml up -d

