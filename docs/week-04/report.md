# Báo cáo phần độc lập tuần 4 của Dũng

Ngày 29/10/2026, nhánh dung trên nền a44a78a. Phạm vi: rà soát C06, bổ sung test còn thiếu, kiểm chứng backup/restore PostgreSQL local và hồ sơ chạy lại. Không sửa frontend, AWS/S3 adapter, Lambda hoặc cấu hình triển khai của thành viên khác.

## Kết quả

| Đầu ra | Kết quả thực tế |
| --- | --- |
| C06 và hồi quy backend | 48/48 JUnit PASS, 0 failures/errors/skipped; PostgreSQL/Tomcat thật, storage fixture |
| Bổ sung coverage | 7 test methods mới, thêm các phản ví dụ checksum sai bucket/key/time vào ca có sẵn |
| Lỗi nghiệp vụ mới | Chưa phát hiện lỗi cần sửa trong phạm vi ca đã chạy; không có thay đổi production code/API/schema/config |
| Backup/restore local | pg_dump → DB target mới → pg_restore PASS; 11 bảng khớp row count và hash |
| Toàn vẹn sau restore | 18 FK validated; 0 project sai quota, 0 HandoverItem sai liên kết |
| API sau phục hồi | Tổng 51 HTTP request checks trên nguồn/đích PASS; target không seed lại user |
| AWS/G4 chung | Chưa nghiệm thu; S3/Lambda/browser/môi trường chung NOT RUN |

## Rà soát và thay đổi

Các ca cũ đã có về quyền dự án, quota/complete đồng thời, checksum sai/trễ, pin v1/v2, publish/confirm/revoke được giữ và chạy lại. Bảy ca mới kiểm:

1. Thay upload/file/project ID qua HTTP không đọc/complete sai dự án hoặc đổi quota.
2. Thay handover/item ID qua HTTP không đọc, publish, confirm hoặc revoke gói khác.
3. Lỗi audit khi confirm rollback cả confirmedAt và aggregate status.
4. Gói nhiều item có một HEAD missing thì không READY một phần.
5. Recipient bị thu hồi riêng trong signer không nhận URL.
6. Gói hết hạn trong signer không nhận URL.
7. Owner bị đổi quyền trong HEAD không phát hành được.

Các thay đổi quyền/role bằng SQL chỉ là fixture để thử race, không thêm endpoint quản trị. [Ma trận C06](c06-test-matrix.md) ánh xạ yêu cầu tới từng test và tách ca AWS chưa chạy.

## Phục hồi dữ liệu

Script mới `backend/tools/run_local_restore_check.py` tự tạo DB nguồn/đích riêng, không drop hoặc nhận DB đang có. Archive/raw log ở runtime-data bị ignore; evidence chỉ counts/hash/status/timing. Người dùng/dự án tạo qua app, metadata/version/gói là fixture SQL tổng hợp.

Sau restore, mọi bảng khớp nguồn; trạng thái DRAFT/READY/CONFIRMED/REVOKED, quan hệ membership, quota, Version ID v1 và thời điểm xác nhận được giữ. Target không có local demo seed; login chứng minh dữ liệu tài khoản được phục hồi. Request đọc và confirm lặp không đổi snapshot. API storage trả 503 khi chưa có adapter, nên không có tuyên bố tải file S3 thật.

[Biên bản restore](../../evidence/week-04/local-restore/restore-report.md) có số đo và bảng đối chiếu. [Runbook local](local-restore-runbook.md) có lệnh để Dũng/người kiểm tra chéo chạy lại. Các số đo nhỏ trên máy local không suy ra HA, RTO/RPO hoặc khả năng phục hồi AWS.

## Việc còn lại cho nghiệm thu chung

- Chiến: A05/A06, môi trường AWS an toàn, backup tới S3 và restore DB chung tách biệt.
- Đăng: B04, event/Lambda trùng/trễ/timeout/sai version và kiểm object/version thật sau restore.
- Nam: D04, browser E2E, lỗi UI và bằng chứng URL trước/sau revoke.
- Dũng: ghép và kiểm lại metadata/API trên môi trường nhóm, lưu commit/thời điểm/PASS-FAIL, nhờ kiểm tra chéo. Hợp đồng hiện tại vẫn cần review theo quy tắc nhóm.

Phần độc lập tuần 4 đã có sản phẩm và bằng chứng local. G4 nhóm vẫn phụ thuộc các bước tích hợp trên; không ghi toàn bộ tuần 4 Cloud đã hoàn thành.
