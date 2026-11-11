# Vận hành, Backup/Restore S3, Chi phí & Kiểm chứng Hạ tầng (TV1 — Hoàng Hải Chiến | A01, A05, A06)

Thư mục `ops/` chứa các công cụ vận hành của **TV1 (Hoàng Hải Chiến)**: sao lưu PostgreSQL lên S3 bucket tách quyền, phục hồi vào database đích tách biệt kèm đối chiếu liên kết S3 Version ID (**K11**), kiểm thử tích hợp toàn luồng hạ tầng tại local, cũng như tài liệu giới hạn quyền AWS Lab, dự toán chi phí và kế hoạch dọn dẹp tài nguyên sau bảo vệ.

## 1. Danh mục công cụ và tài liệu trong `ops/`

| Đường dẫn | Mã việc | Mô tả |
| --- | --- | --- |
| [`backup_db_to_s3.py`](backup_db_to_s3.py) | A05, K11, K12 | Chụp snapshot số dòng + SHA-256 canonical của 11 bảng, chạy `pg_dump --format=custom --no-owner --no-acl`, tải file dump lên bucket backup riêng (`s3://<backup-bucket>/postgres/<run-id>/portal.dump`) với mã hóa `AES256`, kiểm tra `VersionId` của S3 và xuất manifest không chứa secret. File dump nhị phân chỉ lưu ở `backups/` (đã `.gitignore`). |
| [`restore_db_from_s3.py`](restore_db_from_s3.py) | A05, K11 | Tải đúng `VersionId` của bản backup từ S3, kiểm tra SHA-256 của file dump, thử nghiệm rollback nguyên tử trên DB `_rollback` có bảng xung đột (`--single-transaction --exit-on-error`), khôi phục vào DB đích mới (`_dst`), đối chiếu toàn bộ 11 bảng + 18 khóa ngoại (`convalidated`), và **đối chiếu từng bản ghi `file_versions` (`AVAILABLE`) với S3 thật (`head_object` đúng `VersionId` + JSON `results/`)**. |
| [`verify_tv1_local_stack.py`](verify_tv1_local_stack.py) | A01–A06, K03–K05, K07, K11–K13 | Kịch bản kiểm thử tự động chạy xuyên suốt trên Docker local (`postgres:17` + `localstack:4.4` + `nginx:stable-alpine` + `app.jar`): kiểm tra Nginx `/portal/` & `/api/v1/health`, upload v1/v2 qua Presigned PUT, Lambda tính SHA-256 (`VERIFIED`/`MISMATCH` + chống lặp sự kiện), phát hành & xác nhận gói bàn giao ghim v1, backup lên S3, restore sang DB tách biệt, và khởi động lại app trên DB đã restore để tải lại file v1. |
| [`aws-lab-permissions-and-cost.md`](aws-lab-permissions-and-cost.md) | A01, A05, A06 | Checklist quyền và giới hạn của AWS Academy Learner Lab, bảng ước tính chi phí 5 tuần so với ngân sách Lab, và quy trình dọn tài nguyên sau đánh giá. |

## 2. Chạy Backup & Restore với S3 (LocalStack hoặc AWS thật)

### 2.1. Trên môi trường giả lập LocalStack

```powershell
# Sao lưu DB 'handover' lên s3://handover-backups-local/postgres/<run-id>/portal.dump
python ops/backup_db_to_s3.py `
    --endpoint-url http://localhost:4566 `
    --label manual-check `
    --evidence-out evidence/tv1-local-stack/manual-backup.json

# Phục hồi từ S3 vào một DB đích tách biệt và đối chiếu 11 bảng + 18 FK + S3 VersionId
python ops/restore_db_from_s3.py `
    --endpoint-url http://localhost:4566 `
    --backup-key "postgres/<run-id>/portal.dump" `
    --evidence-dir evidence/tv1-local-stack/manual-restore
```

### 2.2. Trên môi trường AWS RDS thật

```powershell
$env:PGPASSWORD = "<RDS_PASSWORD_NOT_IN_GIT>"
python ops/backup_db_to_s3.py `
    --pg-container "" `
    --host "<rds-endpoint>.rds.amazonaws.com" `
    --port 5432 `
    --user handover `
    --dbname handover `
    --backup-bucket "nhom5-handover-backups-<account>-<region>" `
    --region "us-east-1" `
    --label week4-rds `
    --evidence-out evidence/week-04/tv1-rds-backup.json

python ops/restore_db_from_s3.py `
    --pg-container "" `
    --host "<rds-endpoint>.rds.amazonaws.com" `
    --port 5432 `
    --user handover `
    --backup-bucket "nhom5-handover-backups-<account>-<region>" `
    --backup-key "postgres/<run-id>/portal.dump" `
    --region "us-east-1" `
    --evidence-dir evidence/week-04/tv1-rds-restore
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
```


## Backup snapshot consistency (F004)

Backup giu mot transaction `REPEATABLE READ READ ONLY`, export snapshot va cho ca
11 truy van metadata lan `pg_dump --snapshot` nhap dung snapshot do. Transaction
duoc dong truoc khi upload S3, ke ca khi query/dump bi loi. Khong can CREATE DATABASE
tren database nguon. Docker mode dung client PostgreSQL trong container; host mode
can `psql`, `pg_dump`, `pg_restore` tuong thich voi server. Khong dua password vao
command arguments; cung cap `PGPASSWORD` qua environment.

Manifest van giu `schemaVersion=1` va cac field hien hanh. Run ID co them UUID de
khong ghi de artifact khi backup lien tiep. Dump duoc kiem tra custom archive truoc
upload. Neu upload manifest that bai sau dump, backup chua hoan tat; dump da upload
khong bi xoa. `handover_items` duoc canonicalize theo khoa chinh
`handover_id, file_version_id` de loai bo thu tu khong xac dinh khi nhieu item cung
project. Manifest cu tao tu thu tu co tie khong co bao dam digest on dinh; khong duoc
bo qua mismatch hoac sua hash de lam ket qua PASS.

Moi lan backup can `--evidence-out` moi; script tu choi duong dan evidence da ton tai de tranh nham ket qua cu voi run vua that bai.
