# Hợp đồng tích hợp cho Nam và Đăng

Mở `openapi.yaml` bằng Swagger Editor hoặc VS Code có hỗ trợ OpenAPI. Mỗi operation có `x-implementation-status` và tag để phân biệt `implemented` với `contract-only`. Đây là bản nháp chờ Nam/Đăng review, không phải chứng nhận đã tích hợp AWS. Giữ `openapi: 3.0.3` để dễ dùng các công cụ phổ biến.

Phiên bản hiện hành: **0.5.0-backend-integration**, giữ 22 operations. Adapter Java AWS SDK đã có ở local và mặc định tắt; bật bằng UPLOAD_S3_ENABLED, UPLOAD_BUCKET và AWS_REGION. Tích hợp AWS thật và sự thống nhất với Nam/Đăng còn cần kiểm chứng. [Hướng dẫn hiện hành](../docs/backend-integration-2026-11-08.md) mô tả phần bổ sung uploadId và điều kiện tạo gói. Các tài liệu phase/tuần cũ ghi thiết kế tại thời điểm lập, không thay contract hiện hành.

FileVersion trong list và UploadState có thêm trường bắt buộc `uploadId` lấy từ PostgreSQL. Nam lấy lại danh sách rồi gọi endpoint trạng thái upload hiện có để tiếp tục kiểm checksum sau reload; chưa thêm endpoint hay migration. Backend vẫn kiểm membership, đúng version và schema. List chỉ đọc trạng thái đã lưu, không tự polling S3.

Tạo DRAFT chỉ nhận AVAILABLE + VERIFIED. Non-AVAILABLE trả 409 FILE_NOT_AVAILABLE; integrity pending/mismatch/failed trả 409 FILE_NOT_VERIFIED. Publish kiểm lại các điều kiện và HEAD đúng object/version trước READY. Thay đổi này chặn sớm những request trước đây tạo được DRAFT không thể phát hành; frontend cần hiển thị lỗi từ server.

Kiểm tra cuối: [hợp đồng S3 adapter đề xuất](s3-adapter-contract.md) ghi input/output/errors và gate AWS để Đăng review; [kế hoạch Phase 2](../docs/week-02/phase-02-plan.md) tách test fake khỏi AWS thật. Auth CSRF/login/logout công khai không chạy enabled-account filter; logout vẫn bắt CSRF, kể cả khi session cũ đã hết hạn.

## Ví dụ JSON

| Nhóm | File | Tình trạng runtime |
| --- | --- | --- |
| Project | project-create.request/response.json | API đã triển khai; ID/thời gian trong file là minh họa |
| Upload init | upload-init.request/response.json | Backend đã triển khai qua StoragePort; URL example.invalid chỉ là minh họa |
| Version mới | upload-new-version.request.json | Backend đã triển khai; fileId trỏ tài liệu đã có trong project, không lookup bằng filename |
| Complete | upload-complete.request/response.json | Backend đã triển khai; AVAILABLE vẫn INTEGRITY_PENDING |
| Integrity | upload-verified.response.json, upload-mismatch.response.json | Backend đã triển khai đối soát JSON qua StoragePort; Lambda thật chưa kiểm chứng |
| Khôi phục polling | file-page.response.json | Mỗi FileVersion có uploadId; tiếp tục bằng GET upload-state hiện có |
| Handover | handover-create.request.json, handover-ready.response.json, handover-confirm.response.json | Backend tuần 3 đã triển khai; AWS/UI pending |
| Lỗi | error-validation/forbidden/hidden-project/quota/publish/version.json | Validation/quyền/quota/version/publish đã triển khai |
| Lambda | checksum-success.json, checksum-failed.json | Mẫu đúng schema, chưa chạy Lambda thật |

Ví dụ lỗi mới: `error-unsupported-media-type.json` và `error-account-disabled.json` là lỗi backend đã sửa; `error-upload-expired.json` và `error-upload-already-completed.json` đã có xử lý nghiệp vụ và kiểm thử PostgreSQL. `contracts/review/presigned-put-write-once.candidate.json` có If-None-Match nhưng là **candidate chưa được Đăng/Chiến POC/duyệt**, AWS enforcement chưa được kiểm chứng; backend hiện yêu cầu signer trả header này.

Tương thích: endpoint, request và page/size giữ nguyên; response thêm uploadId. Consumer có validator đóng cần cập nhật schema 0.5.0. Complete vẫn nhận exact opaque Version ID và cấm literal `"null"`. Adapter AWS SDK đã có; V1 migration giữ nguyên. Error examples publish/version đã dùng code runtime FILE_NOT_VERIFIED/UPLOAD_ALREADY_COMPLETED.

Đăng dùng `checksum-result.schema.json` (JSON Schema draft 2020-12), đọc quy tắc identity/result key trong `docs/week-01/upload-handover-rules.md`. `SUCCEEDED` chỉ cho biết Lambda tính được hash; backend mới quyết định VERIFIED/MISMATCH. Không có endpoint nhận JSON checksum từ browser.

Login là form-urlencoded với email/password (password do người dùng nhập, không có sample secret). Chuỗi bước trong `backend/README.md`: lấy CSRF → login với cùng cookie jar → lấy CSRF mới → API JSON. Không paste session/token hoặc presigned URL còn hiệu lực vào repo.

Validation: từ `backend`, chạy `mvnw verify`; parser resolve toàn bộ OpenAPI không lỗi, validate các JSON API examples theo schema chuyển từ OpenAPI và validate schema Lambda thành công/lỗi cùng các ca phản ví dụ. Đây là kiểm tra contract/schema, không phải test S3 hoặc UI thật.

Bằng chứng chốt hiện tại: `../evidence/week-05/backend/README.md`; hướng dẫn bàn giao: `../docs/week-05/final-handover.md`. Bằng chứng tuần 2–4 là lịch sử. Các snapshot Phase 1 ngày 22/10 là lịch sử. Chưa có xác nhận Nam/Đăng/Chiến; xem `../docs/week-02/team-integration-questions.md`.
