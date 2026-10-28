# Biên bản backup và restore PostgreSQL local

Kết quả: **PASS**. Bắt đầu 2026-10-29T01:38:17.456698+07:00; kết thúc 2026-10-29T01:38:35.331734+07:00 (UTC+07).

Source DB: `handover_restore_20261028_183817_a0e8ca79_src`. Target DB mới: `handover_restore_20261028_183817_a0e8ca79_dst`.

| Phép đo local | Kết quả |
| --- | --- |
| pg_dump định dạng custom | 0.515 giây |
| pg_restore trong một transaction | 0.219 giây |
| Khởi động backend trên target | 4.922 giây |
| HTTP request checks | 51 PASS |
| Khóa ngoại đã validated | 18 |
| Project sai quota / HandoverItem sai liên kết | 0 / 0 |

| Bảng | Số dòng nguồn | Số dòng phục hồi | SHA-256 dữ liệu |
| --- | --- | --- | --- |
| app_users | 4 | 4 | Khớp |
| projects | 2 | 2 | Khớp |
| memberships | 3 | 3 | Khớp |
| file_metadata | 1 | 1 | Khớp |
| file_versions | 3 | 3 | Khớp |
| upload_sessions | 3 | 3 | Khớp |
| handovers | 4 | 4 | Khớp |
| handover_items | 4 | 4 | Khớp |
| handover_recipients | 5 | 5 | Khớp |
| audit_events | 7 | 7 | Khớp |
| flyway_schema_history | 1 | 1 | Khớp |

Trạng thái DRAFT/READY/CONFIRMED/REVOKED, phiên bản v1 trong gói, người nhận và thời điểm xác nhận được giữ nguyên. Target không seed lại tài khoản; đăng nhập dùng tài khoản và password hash đã phục hồi. Các thao tác đọc và confirm lặp không làm thay đổi snapshot sau restore.

Dữ liệu file/version/handover là fixture SQL tổng hợp, người dùng/dự án tạo qua ứng dụng. API thiếu adapter S3 trả 503; không có byte S3 hoặc Lambda nào được kiểm chứng. Archive và raw log nằm trong runtime-data bị ignore; không đưa password hash/cookie/token vào evidence. Database fixture được giữ lại để kiểm tra, script không xóa hoặc ghi đè DB có sẵn.

Chi tiết và hash nằm trong restore-result.json; trạng thái lần chạy mới nhất nằm trong run-status.json. Các số đo local này không phải RTO/RPO hoặc kết quả backup S3 trên AWS.
