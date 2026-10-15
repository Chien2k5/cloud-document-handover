# Hợp đồng tích hợp cho Nam và Đăng

Mở `openapi.yaml` bằng Swagger Editor hoặc VS Code có hỗ trợ OpenAPI. Mỗi operation có `x-implementation-status` và tag để phân biệt `implemented` với `contract-only`. Đây là bản nháp chờ Nam/Đăng review, không phải chứng nhận đã tích hợp AWS. Giữ `openapi: 3.0.3` để dễ dùng các công cụ phổ biến.

## Ví dụ JSON

| Nhóm | File | Tình trạng runtime |
| --- | --- | --- |
| Project | project-create.request/response.json | API đã triển khai; ID/thời gian trong file là minh họa |
| Upload init | upload-init.request/response.json | Thiết kế; URL example.invalid không hoạt động |
| Complete | upload-complete.request/response.json | Thiết kế; AVAILABLE vẫn INTEGRITY_PENDING |
| Integrity | upload-verified.response.json, upload-mismatch.response.json | Thiết kế; backend tương lai đối soát Lambda |
| Handover | handover-create.request.json, handover-ready.response.json, handover-confirm.response.json | Thiết kế tuần 3 |
| Lỗi | error-validation/forbidden/hidden-project/quota/publish/version.json | Validation/quyền project đã có; quota/publish/version mới thiết kế |
| Lambda | checksum-success.json, checksum-failed.json | Mẫu đúng schema, chưa chạy Lambda thật |

Đăng dùng `checksum-result.schema.json` (JSON Schema draft 2020-12), đọc quy tắc identity/result key trong `docs/week-01/upload-handover-rules.md`. `SUCCEEDED` chỉ cho biết Lambda tính được hash; backend mới quyết định VERIFIED/MISMATCH. Không có endpoint nhận JSON checksum từ browser.

Login là form-urlencoded với email/password (password do người dùng nhập, không có sample secret). Chuỗi bước trong `backend/README.md`: lấy CSRF → login với cùng cookie jar → lấy CSRF mới → API JSON. Không paste session/token hoặc presigned URL còn hiệu lực vào repo.

Validation: từ `backend`, chạy `mvnw verify`; parser resolve toàn bộ OpenAPI không lỗi, validate các JSON API examples theo schema chuyển từ OpenAPI và validate schema Lambda thành công/lỗi cùng các ca phản ví dụ. Đây là kiểm tra contract/schema, không phải test S3 hoặc UI thật.
