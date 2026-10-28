# Chạy lại backup restore PostgreSQL local

Mục tiêu: kiểm chứng bản backup phục hồi được dữ liệu portal và hành vi API trên database khác. Script chỉ nhận host loopback, tự tạo tên DB nguồn/đích duy nhất, không nhận DB có sẵn, không drop database. Đây là công cụ kiểm tra của backend, không thay runbook backup AWS của Chiến.

## Chuẩn bị

- JDK 21–25 và PostgreSQL client tools tương thích server (lần này 17.9).
- PostgreSQL local đang chạy; role local có quyền CREATEDB. Không cần AWS credentials.
- Đã build JAR bằng `backend/mvnw.cmd -B -ntp verify`. Có thể bật RUN_DB_TESTS trên DB thử riêng để kiểm toàn bộ C06; hướng dẫn trong backend/README.md.
- Cổng 18086/18087 còn trống. Có thể thay bằng --source-port/--target-port.

Từ thư mục `backend`:

```powershell
$restorePassword = Read-Host 'Mat khau role PostgreSQL local' -AsSecureString
$env:PGPASSWORD = [System.Net.NetworkCredential]::new('', $restorePassword).Password
try {
    python tools/run_local_restore_check.py --pg-bin 'C:\Program Files\PostgreSQL\17\bin' --host 127.0.0.1 --port 5432 --user handover
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
```

Thay port/user theo PostgreSQL local của bạn. Role `handover` trong ví dụ phải có CREATEDB; nhờ tài khoản quản trị local cấp quyền phù hợp cho môi trường thử nếu chưa có. Script không tự cấp quyền hoặc sửa role. Python chỉ dùng standard library. `.env` không tự được nạp.

## Những bước script thực hiện

1. Kiểm JAR/cổng, tạo `handover_restore_<thời điểm>_<UUID>_src` mới.
2. Start JAR; Flyway chạy V1 từ DB trống; local seed tạo user mẫu với mật khẩu ngẫu nhiên trong bộ nhớ.
3. Tạo project/membership qua API. Tạo fixture SQL gồm v1 VERIFIED, v2 MISMATCH, một upload PENDING, gói DRAFT/READY/CONFIRMED/REVOKED và audit. Đây là dữ liệu tổng hợp, không mô phỏng thành công AWS.
4. Kiểm API nguồn rồi dừng JAR để nguồn ổn định. Lấy row count và SHA-256 dữ liệu canonical của 10 bảng nghiệp vụ + Flyway.
5. Chạy pg_dump custom; tạo DB `_dst` mới, chạy pg_restore với --exit-on-error/--single-transaction, không --clean hoặc ghi đè DB cũ.
6. Đối chiếu toàn bộ bảng, FK validated, used/reserved quota và liên kết HandoverItem.
7. Start JAR trỏ target, **không seed lại user**. Login bằng tài khoản đã phục hồi; kiểm manifest/quyền/confirmedAt, confirm lặp và state. Download thiếu adapter phải trả 503.
8. Dừng JAR; so snapshot target lần nữa để chắc request đọc/confirm lặp không thay dữ liệu.

## Đọc đầu ra

- `evidence/week-04/local-restore/run-status.json`: trạng thái lần chạy mới nhất. Chỉ lấy kết quả khi PASS và stage complete; nếu FAIL/RUNNING thì không dùng report cũ để ghi lần chạy mới đạt.
- `restore-result.json`: counts/hash/timing và các kết luận đã kiểm chứng.
- `restore-report.md`: biên bản đọc được, giờ UTC+07.
- `runtime-data/week4-restore-*/portal-fixture.dump`: archive, chỉ ở vùng ignore; chứa password hashes nên không đưa vào Git hoặc hồ sơ chia sẻ.
- Log JAR/tool và fixture byte mẫu cũng nằm trong runtime-data. Không lưu cookie/token/password vào evidence.

Lần thực hiện 29/10 đạt: 11 bảng khớp, 18 FK validated, 51 HTTP request checks. Thời gian đo của lần đó là dump 0,468 giây, restore 0,297 giây, backend target khởi động 4,938 giây. Đây là bộ fixture nhỏ trên máy local, không phải RTO/RPO hoặc tốc độ phục hồi AWS.

Các database fixture được giữ lại để kiểm tra; script không xóa DB. Các lần chạy tiếp dùng tên mới. Nếu cần dọn, đọc chính xác tên DB trong restore-result.json và chỉ dọn fixture của mình bằng công cụ PostgreSQL; không dùng wildcard hoặc tên database ứng dụng chung.

## Khi có lỗi

- Tool thiếu: kiểm --pg-bin có psql/createdb/pg_dump/pg_restore.
- Connection/auth lỗi: kiểm server local, port/user và PGPASSWORD, không đổi sang DB chung để thử.
- CREATEDB bị từ chối: dùng role thử có quyền tạo DB hoặc nhờ quản trị local chuẩn bị quyền.
- Port bận/JAR không ready: chọn cổng trống, xem log trong runtime-data.
- Restore hoặc snapshot lệch: run-status phải FAIL; giữ archive/log để điều tra, không đổi kết luận thành PASS hoặc bỏ qua bảng.

Khi ghép AWS, Chiến chuẩn bị backup/restore tách biệt; Dũng kiểm FK, quota, manifest và lịch sử trên DB đã phục hồi, Đăng xác minh HEAD/GET đúng Version ID và SHA-256 trên S3, Nam chạy browser E2E. Chỉ sau bước đó mới nghiệm thu G4 chung.
