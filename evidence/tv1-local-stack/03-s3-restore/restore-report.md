# Biên bản Backup S3 & Restore DB tách biệt (TV1 - A05 / K11)

- **Trạng thái**: `PASS` (`localstack-emulation`)
- **Commit**: `d7b23139e0cb945a414caa42c9a7eb29676edd7e`
- **Thời điểm hoàn tất**: `2026-11-11T02:36:27+0700`
- **Nguồn backup S3**: `s3://handover-backups-local/postgres/20261110T193617Z-e2e-verified/portal.dump` (VersionId: `AaHG9aL7Q5Yd8x8smGmJUVetFb2hb3QG`)
- **DB nguồn**: `handover` -> **DB đích tách biệt**: `handover_s3restore_20261110_193624_dst`
- **Kiểm tra rollback nguyên tử (`_rollback`)**: `PASS=True` (exit code `1`, giữ nguyên bảng sentinel)
- **Đối chiếu 11 bảng (row count + canonical SHA-256)**: `allMatched=True`
- **Khóa ngoại đã xác thực (`convalidated`)**: `18/18`
- **Đối chiếu liên kết DB <-> S3 (`file_versions` AVAILABLE -> exact S3 VersionId + `results/` JSON)**: `3 phiên bản, allMatched=True`
- **Thời gian đo thực tế**:
  - Tải dump từ S3 & kiểm SHA-256: `2071.0 ms`
  - Kiểm tra rollback nguyên tử: `847.8 ms`
  - `pg_restore` vào DB đích mới: `474.9 ms`
  - Đối chiếu 11 bảng + 18 FK + S3 VersionId: `1884.9 ms`
  - Tổng cộng: `5278.5 ms`
