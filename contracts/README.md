# Hợp đồng tích hợp cho Nam và Đăng

Mở `openapi.yaml` bằng Swagger Editor hoặc VS Code có hỗ trợ OpenAPI. Mỗi operation có `x-implementation-status` và tag để phân biệt `implemented` với `contract-only`. Đây là bản nháp chờ Nam/Đăng review, không phải chứng nhận đã tích hợp AWS. Giữ `openapi: 3.0.3` để dễ dùng các công cụ phổ biến.

Phiên bản thiết kế hiện tại: **0.3.0-week2-backend**. Có 22 operations: 16 implemented (11 nền tảng + 5 upload), 6 handover contract-only. StoragePort chưa có adapter AWS thật; storage chưa sẵn sàng trả 503. Đọc `docs/week-02/phase-01-upload-contract.md`: optional fileId dùng cho version mới, quota logic/PUT lặp, complete/expiry và integrity state machine. `x-review-status` ghi riêng các bên chưa xác nhận; không có phê duyệt nhóm được tự ghi nhận.

Kiểm tra cuối: [hợp đồng S3 adapter đề xuất](s3-adapter-contract.md) ghi input/output/errors và gate AWS để Đăng review; [kế hoạch Phase 2](../docs/week-02/phase-02-plan.md) tách test fake khỏi AWS thật. Auth CSRF/login/logout công khai không chạy enabled-account filter; logout vẫn bắt CSRF, kể cả khi session cũ đã hết hạn.

## Ví dụ JSON

| Nhóm | File | Tình trạng runtime |
| --- | --- | --- |
| Project | project-create.request/response.json | API đã triển khai; ID/thời gian trong file là minh họa |
| Upload init | upload-init.request/response.json | Backend đã triển khai qua StoragePort; URL example.invalid chỉ là minh họa |
| Version mới | upload-new-version.request.json | Backend đã triển khai; fileId trỏ tài liệu đã có trong project, không lookup bằng filename |
| Complete | upload-complete.request/response.json | Backend đã triển khai; AVAILABLE vẫn INTEGRITY_PENDING |
| Integrity | upload-verified.response.json, upload-mismatch.response.json | Backend đã triển khai đối soát JSON qua StoragePort; Lambda thật chưa kiểm chứng |
| Handover | handover-create.request.json, handover-ready.response.json, handover-confirm.response.json | Thiết kế tuần 3 |
| Lỗi | error-validation/forbidden/hidden-project/quota/publish/version.json | Validation/quyền/quota/version đã triển khai; publish còn thiết kế |
| Lambda | checksum-success.json, checksum-failed.json | Mẫu đúng schema, chưa chạy Lambda thật |

Ví dụ lỗi mới: `error-unsupported-media-type.json` và `error-account-disabled.json` là lỗi backend đã sửa; `error-upload-expired.json` và `error-upload-already-completed.json` đã có xử lý nghiệp vụ và kiểm thử PostgreSQL. `contracts/review/presigned-put-write-once.candidate.json` có If-None-Match nhưng là **candidate chưa được Đăng/Chiến POC/duyệt**, AWS enforcement chưa được kiểm chứng; backend hiện yêu cầu signer trả header này.

Tương thích: endpoint và request tạo tài liệu mới cũ giữ nguyên; optional fileId là bổ sung. Project trước đây chấp nhận số/null trái schema nay từ chối; description omit vẫn hợp lệ. Complete schema nay cấm literal `"null"` như mô tả trước; UploadService đã triển khai, adapter AWS chưa có; V1 migration giữ nguyên.

Đăng dùng `checksum-result.schema.json` (JSON Schema draft 2020-12), đọc quy tắc identity/result key trong `docs/week-01/upload-handover-rules.md`. `SUCCEEDED` chỉ cho biết Lambda tính được hash; backend mới quyết định VERIFIED/MISMATCH. Không có endpoint nhận JSON checksum từ browser.

Login là form-urlencoded với email/password (password do người dùng nhập, không có sample secret). Chuỗi bước trong `backend/README.md`: lấy CSRF → login với cùng cookie jar → lấy CSRF mới → API JSON. Không paste session/token hoặc presigned URL còn hiệu lực vào repo.

Validation: từ `backend`, chạy `mvnw verify`; parser resolve toàn bộ OpenAPI không lỗi, validate các JSON API examples theo schema chuyển từ OpenAPI và validate schema Lambda thành công/lỗi cùng các ca phản ví dụ. Đây là kiểm tra contract/schema, không phải test S3 hoặc UI thật.

Bằng chứng hiện tại: `../evidence/week-02/backend/README.md`. Các snapshot Phase 1 ngày 22/10 là lịch sử. Chưa có xác nhận Nam/Đăng/Chiến; xem `../docs/week-02/team-integration-questions.md`.
