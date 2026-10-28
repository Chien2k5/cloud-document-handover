# Câu hỏi Dũng gửi nhóm để ghép tuần 2

Ngày 28/10/2026. Chưa có xác nhận từ các thành viên. Đây là nội dung để Dũng gửi; công cụ không tự gửi tin nhắn.

## Đăng — S3 adapter và Lambda

Dũng đang hoàn thiện backend tuần 2. Bạn đã có S3 adapter cấp presigned PUT/GET, HEAD đúng Version ID và đọc JSON checksum chưa? Nếu có, gửi giúp tên nhánh/commit, vị trí mã và hướng dẫn tích hợp. Mình cần chốt:

- Bốn operation của `backend/.../upload/StoragePort.java`, cách đăng ký bean và timeout hữu hạn.
- PUT ký `Content-Type` và `If-None-Match: *`; thử upload lặp/đồng thời trên bucket thử. Backend hiện từ chối signer không trả conditional header. Đây chưa phải bằng chứng AWS đã chặn PUT lặp.
- HEAD/GET phải dùng đúng bucket/key/versionId; phân biệt Missing với AccessDenied/timeout/5xx. Version ID là chuỗi opaque, giữ nguyên.
- JSON theo `contracts/checksum-result.schema.json`, result key trong `contracts/s3-adapter-contract.md`, giới hạn 64 KiB khi đọc. Event sai version/lặp/trễ không được làm VERIFIED nhầm.
- Bộ file mẫu và log đối chiếu expectedSha256/actualSha256/Version ID; lỗi và phần chưa triển khai.

## Chiến — môi trường và quyền AWS

Nhóm đã có môi trường AWS thử cho tuần 2 chưa? Gửi giúp vị trí cấu hình/runbook và người cấp quyền; không gửi access key/password/token vào chat hoặc Git.

- Region, bucket private bật Versioning, prefix uploads/results, IAM role của backend và Lambda.
- CORS theo origin của Nam, cho phép PUT/GET và signed headers, expose `x-amz-version-id`.
- S3 notification chỉ từ uploads, không tạo vòng lặp khi Lambda ghi results.
- Endpoint/HTTPS, DB độc lập không public, cách cấu hình `UPLOAD_BUCKET`, TTL và đường lấy log.
- Quyền/policy ngăn tái dùng hoặc xóa key trong thời hạn URL, cleanup orphan/late upload và theo dõi chi phí. Quota database không phải hard quota byte S3.

## Nam — UI và nghiệm thu chung

Backend đã có request upload, complete, trạng thái, danh sách version và download qua StoragePort. Bạn kiểm tra giúp OpenAPI và luồng browser:

- Tính SHA-256 trước init; gửi đầy đủ signed headers; giữ `x-amz-version-id` sau PUT và gửi nguyên giá trị cho complete.
- Bỏ fileId để tạo tài liệu mới; dùng fileId để thêm version, không dùng filename làm định danh hoặc tự đổi tên.
- Hiển thị riêng uploadStatus và integrityStatus; chưa có JSON hợp lệ thì chưa VERIFIED. Download chỉ cho AVAILABLE + VERIFIED.
- Init không idempotent. Khi mất response/Version ID, không đoán bằng latest hoặc retry init vô hạn; thống nhất thông báo và chờ reservation hết hạn.
- Chuẩn bị E2E đúng/sai hash, Viewer upload, tải chéo dự án, URL hết hạn và complete lặp trên môi trường AWS chung.

## Điều kiện ghi hoàn thành

Dũng có thể kiểm chứng transaction/quyền/state bằng PostgreSQL và storage fixture riêng. Nghiệm thu tuần 2 với AWS cần Đăng cung cấp adapter, Chiến cấu hình môi trường và Nam ghép browser, kèm commit, thời điểm và PASS/FAIL thực tế. Chưa có các bằng chứng đó thì ghi rõ chờ tích hợp.
