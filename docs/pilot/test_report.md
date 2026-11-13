# Kiểm thử frontend tích hợp

Các dòng PASS T01–T05 trong bản Nam `00bc97b` là kết quả lịch sử **chưa xác minh**.
Commit đó có `app.js` rỗng, không kèm bằng chứng để tái lập kết nối backend,
checksum hay bàn giao. Không sử dụng các dòng đó để nghiệm thu bản tích hợp.

## Bản tích hợp kiểm tra ngày 10/11/2026

Base `dung`: `e58a382`. Source Nam nhập có kiểm soát: `00bc97b`.
Nhánh làm việc: `task/F04-frontend-integration-dung`. Chỉ frontend/docs pilot được
sửa; backend, contracts, migration, S3/Lambda, Nextcloud không đổi. Kế hoạch 5 tuần
được đối chiếu: React là yêu cầu hiện hành, không bổ sung framework nghiệp vụ khác.

| Lớp kiểm tra | Kết quả | Phạm vi và bằng chứng |
| --- | --- | --- |
| Lint/build | PASS | ESLint và Vite production build; `checkpoints.json` |
| Unit | PASS — 17 | API client, CSRF/cookie/form, SHA-256 bytes, signed headers, Version ID, PUT lỗi/timeout, complete retry, polling, quyền, draft/expiry, exact download |
| Browser với fixture | PASS — 17 | Chrome headless thật; API/S3 mock có khai báo rõ, không dùng làm bằng chứng AWS |
| Spring Boot/PostgreSQL | PASS — 62, 0 failure/error/skipped | Database container PostgreSQL 17 mới; backend storage fixture/mock, `live-verification.json` |
| Browser → Vite → backend/DB thật | PASS — 3 | Không mock API: auth/session/CSRF, Owner/Editor/Viewer, project/membership, 401/403/404 và S3-disabled 503 |
| AWS S3 → Lambda → backend | NOT_RUN | Chưa deploy hoặc dùng credentials/tài nguyên AWS |
| Browser bàn giao/storage với AWS thật | NOT_RUN | Các ca publish/download/revoke/version trong browser hiện dùng fixture; backend có test DB thật + storage giả |
| Pilot người dùng | NOT_RUN | Không có khảo sát/8 người dùng được xác minh cho bản này |

## Ma trận browser fixture

- Auth: form email/password, header CSRF do server trả về, token mới sau login,
  logout, sai mật khẩu và không lưu password/token vào web storage.
- Project/role: payload membership, Viewer bị ẩn quyền sửa, mất membership,
  phân trang page/size, lỗi 403 và refresh CSRF không tự gửi lại request ghi.
- Upload: SHA-256 `abc`, bytes nguyên gốc, đủ signed headers, không cookie/CSRF
  sang S3, thiếu Version ID không complete, quota 409/storage 503 không PUT.
- Version/recovery: reload dùng uploadId lấy từ list; FAILED có thể kiểm tra lại
  khi kết quả muộn tới; MISMATCH chặn download; endpoint dùng FileVersion ID.
- Handover: đủ payload DRAFT, chỉ chọn AVAILABLE + VERIFIED, chọn v1 vẫn giữ v1
  sau v2; Owner publish/revoke, chỉ recipient confirm, 1/2 người xác nhận vẫn READY,
  người không được chỉ định nhận 404; expiry/revoke chặn link mới.

Unit còn kiểm PUT 409/412/403/503, mất mạng, timeout, abort, file rỗng/quá 100 MiB,
giữ Version ID khi complete 503 và không tự retry PUT. Không dùng ETag/latest.

## Tái lập và giới hạn

Từ frontend: `npm ci`, `npm run lint`, `npm test`, `npm run build`,
`npm run test:e2e`, `python tools/run_live_check.py`.
Runner live tạo riêng hai DB mới, port ngẫu nhiên, mật khẩu trong bộ nhớ,
tự dừng JAR và xóa container thử. Không chạy test TRUNCATE vào DB chung.
Log riêng nằm trong runtime-data bị ignore; summary không lưu credential hoặc URL ký.

`checkpoints.json` ghi kết quả sau từng giai đoạn và hash source đã test;
`live-verification.json` ghi hash runtime frontend/JAR/backend tree. Parent commit
là commit trước checkpoint; commit chứa evidence được xác định bởi lịch sử Git/PR.
Không cộng unit với browser/backend thành một con số để ngụ ý AWS đã qua.

Chưa phát hiện lỗi backend cần thay đổi qua phạm vi đã kiểm. Thiếu API danh sách gói
và directory người dùng được xử lý bằng UUID, không tự tạo endpoint. Nhóm còn cần
review frontend/React, API integration, tài khoản recipient enabled, HTTPS/proxy,
IAM/CORS/Versioning/Lambda và thực hiện E2E AWS. Bản này chưa đủ nghiệm thu Cloud.
