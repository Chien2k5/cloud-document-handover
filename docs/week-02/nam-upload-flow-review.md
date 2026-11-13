# Đối chiếu luồng upload sau phản hồi của Nam

Ngày cập nhật: 29/10/2026. Nền source đã đối chiếu: `6f5bf9dc9c2932a8845e59389c262c61eb74a8c3`, nhánh `dung`. [Minh chứng từ ảnh Dũng cung cấp](../../evidence/week-01/nam-upload-flow-confirmation.md) ghi nhận Nam đồng ý luồng tổng thể. Không có commit hợp đồng, lượt chạy frontend hoặc AWS được Nam xác nhận trong ảnh.

## Luồng đã trao đổi và phần backend hiện có

| Bước | Contract/source hiện tại | Mức kiểm chứng |
| --- | --- | --- |
| Frontend tính SHA-256 | Init nhận `expectedSha256`: 64 ký tự hex thường; kèm `filename`, `contentType`, `size` | DTO/service đã kiểm input; chưa kiểm tính hash trên browser |
| Init | `POST /api/v1/projects/{id}/files/uploads` | Controller và service có; cần session/CSRF và quyền Owner/Editor |
| Nhận thông tin upload | `uploadId`, `fileId`, `fileVersionId`, `presignedUpload.method/url/headers/expiresAt` | Khớp DTO; URL/headers nằm trong object `presignedUpload`, không phải field phẳng |
| PUT S3 | Gửi file theo URL và mọi header backend trả; hiện signer phải trả `Content-Type` và `If-None-Match: *` | Chưa có AWS adapter; CORS/conditional PUT thực tế còn chờ Đăng/Chiến |
| Lấy Version ID | Frontend đọc `x-amz-version-id` từ response S3 | Cần Versioning và CORS expose header; chưa có browser/AWS proof |
| Complete | `POST /api/v1/projects/{id}/files/uploads/{uploadId}/complete`, body chỉ có `versionId` | Backend HEAD đúng bucket/key/version; thành công trả `AVAILABLE` và ban đầu `INTEGRITY_PENDING` |
| Polling | `GET /api/v1/projects/{id}/files/uploads/{uploadId}` | Response dùng `fileVersion.uploadStatus` và `fileVersion.integrityStatus`; backend đọc kết quả checksum đúng identity qua StoragePort |

Frontend giữ nguyên Version ID opaque; không dùng ETag thay SHA-256 hoặc Version ID, không suy đoán latest. Một lượt complete lặp có thể trả integrity đã cập nhật trước đó, không reset về pending. Không gửi actualSha256 hoặc trạng thái VERIFIED từ frontend để backend tin theo.

Ví dụ init response được bổ sung `If-None-Match: *` để khớp yêu cầu signer trong UploadService hiện có. Không đổi endpoint, DTO, schema hoặc chính sách runtime trong lần cập nhật tài liệu này.

## Lỗi và retry cần Nam xác nhận chi tiết

Các dòng dưới là hành vi backend và điểm cần ghép UX, chưa phải nội dung Nam đã duyệt:

| Tình huống | Hành vi hiện tại / việc frontend cần thống nhất |
| --- | --- |
| Init mất response | Init không idempotent; không tự lặp vô hạn vì mỗi request có thể tạo session/reservation khác. Cần chốt thông báo và thao tác thử lại có chủ đích |
| PUT timeout hoặc không đọc được Version ID | Không complete bằng latest, không đoán Version ID; quy trình recovery và conditional PUT/412 còn cần Nam/Đăng/Chiến chốt |
| Complete mất response | Có thể gửi lại cùng project/uploadId/Version ID; nếu đã AVAILABLE, backend trả trạng thái đã lưu, không tính quota lần nữa |
| Complete bằng Version ID khác sau khi thành công | `409 UPLOAD_ALREADY_COMPLETED`; không thay version đã chốt |
| Object chưa sẵn sàng | `409 OBJECT_NOT_READY`; chưa chuyển AVAILABLE. Có thể thử complete lại có giới hạn với đúng ID còn hiệu lực |
| Upload hết hạn / thất bại | `409 UPLOAD_EXPIRED` / `UPLOAD_FAILED`; không tiếp tục complete session cũ |
| Object sai size/type | `409 UPLOAD_OBJECT_INVALID`, upload FAILED; không báo thành công |
| Hạ tầng storage lỗi | `503 STORAGE_UNAVAILABLE`; không diễn giải lỗi mạng thành checksum MISMATCH. Khoảng nghỉ, số lần thử và thông báo chờ còn cần chốt |
| Poll chưa có JSON | Integrity giữ `INTEGRITY_PENDING`; UI chưa báo VERIFIED. Cần chốt nhịp/số lần polling và nút kiểm tra lại; timeout UI không tự thay trạng thái server |
| Poll trả MISMATCH / FAILED | Hiển thị khác nhau. MISMATCH là kết quả cuối cho version đó; FAILED có thể được backend đối soát lại khi đọc trạng thái sau, chưa phải upload mới |

Session/CSRF, lỗi quyền, quota, chọn fileId khi thêm version và cách nhóm version vẫn cần Nam review riêng. Phản hồi hiện tại không thay thế các mục này.

## Tác động tới kế hoạch và nghiệm thu

- C01 tuần 1: có thêm minh chứng phối hợp frontend–backend về luồng upload tổng thể; hợp đồng chi tiết và review Đăng còn mở.
- C03 tuần 2: có cơ sở ghép frontend; G2 vẫn cần PUT/HEAD/GET đúng version trên S3 thật và log PASS/FAIL.
- C04/C05/C06/C07: tin nhắn này không xác nhận checksum Lambda, bàn giao, thu hồi, audit hoặc hoàn thành tuần 3–5.
- Điểm lệch PDF đã phát hiện vẫn còn: process2.pdf trang 8–9 yêu cầu chọn AVAILABLE + VERIFIED vào gói, nhưng HandoverService.create hiện chỉ kiểm AVAILABLE. Cần sửa logic/contract/test riêng; lần cập nhật này không sửa nghiệp vụ đó.

Các báo cáo, source-hashes và bundle trước đây vẫn đại diện snapshot commit/lượt chạy đã ghi trong chúng. Việc thêm minh chứng và sửa mô tả OpenAPI không biến kết quả cũ thành kiểm thử cho commit tài liệu mới. Không có lượt AWS/browser hoặc xác nhận bổ sung của thành viên khác được tự ghi PASS.

## Kiểm tra bản cập nhật

Chạy từ `backend`: `mvnw.cmd -B -ntp -Dtest=ContractTest test`, kết thúc 29/10/2026 lúc 08:18:08 UTC+07: **4 test PASS, 0 failure/error/skipped**. Bộ test kiểm OpenAPI resolve, JSON examples/schema, checksum schema và input contract; không chạy lại 51 DB tests hoặc kiểm frontend/AWS trong lần cập nhật này.
