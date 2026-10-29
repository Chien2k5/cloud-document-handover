# Nam xác nhận luồng upload tổng thể

Ngày ghi nhận: 29/10/2026, Asia/Saigon. Người cung cấp minh chứng: Dũng, qua ảnh chụp hội thoại đính kèm trong chat. Đây là bản ghi từ ảnh người dùng cung cấp, không phải kết quả truy cập trực tiếp tài khoản Zalo hoặc biên bản chạy tích hợp.

## Nguồn và nội dung

- Tệp nguồn: `codex-clipboard-3f98e130-3eb5-4193-b13f-116be20795b6.png`.
- SHA-256 tệp ảnh: `f6dbd1e4ec0c68ac28626ca18cc4cbc2d160f282b9d13405feb3238925798746`.
- Dũng xác định người trao đổi là Nam, phụ trách frontend. Ảnh thể hiện tin nhắn phản hồi lúc 08:13; không có mã commit/OpenAPI được Nam chỉ định.
- Không đưa toàn bộ ảnh hội thoại vào Git vì ảnh có nội dung ngoài phạm vi review. Hash giúp đối chiếu bản ảnh Dũng giữ; bản ghi này không thay thế ảnh gốc.

Nội dung Dũng đã gửi trong ảnh: frontend tính SHA-256, gửi tên/dung lượng/loại file/hash; backend trả uploadId/fileId/fileVersionId/URL/headers; frontend PUT S3, lấy Version ID rồi complete; polling để hiển thị trạng thái kiểm tra, thành công hoặc checksum không khớp. Dũng nhấn mạnh complete thành công chưa có nghĩa VERIFIED.

Phản hồi của Nam, chép từ ảnh:

> tôi nghĩ luồng đó là oce rồi, sau có gì có lỗi t bảo ông sau

## Phạm vi xác nhận

| Hạng mục | Kết luận từ ảnh |
| --- | --- |
| Luồng SHA-256 → init → PUT S3 → Version ID → complete → polling | Nam đồng ý về tổng thể |
| Phân biệt complete thành công với VERIFIED | Có trong nội dung Nam phản hồi đồng ý tổng thể; chưa có kiểm thử UI |
| Toàn bộ OpenAPI tại một commit cụ thể | Chưa có xác nhận |
| Mã lỗi, retry, PUT mất response/Version ID, giới hạn polling | Chưa có xác nhận chi tiết trong ảnh |
| Login/session/CSRF, optional fileId, tải file và bàn giao | Chưa có xác nhận trong ảnh |
| Đăng duyệt adapter/Lambda; Chiến duyệt CORS/IAM/môi trường | Chưa có xác nhận trong ảnh |
| Frontend/S3/Lambda/AWS E2E đã chạy PASS | Không có bằng chứng từ ảnh |

## Đối chiếu repo

Đối chiếu source nền `6f5bf9dc9c2932a8845e59389c262c61eb74a8c3` của nhánh `dung`: UploadController có init/complete/state; UploadDtos có các ID và `presignedUpload.headers`; UploadService complete giữ integrity pending và state đối soát checksum qua StoragePort. Bước tính SHA-256, PUT và đọc response S3 thuộc frontend/adapter; chưa được chạy thực tế trong lần ghi nhận này.

Minh chứng bổ sung phần phối hợp C01 tuần 1 và chuẩn bị ghép C03 tuần 2. Không dùng để đóng toàn bộ C01/C03, G2 hoặc các tuần 3–5. Xem [bản đối chiếu chi tiết và mục còn mở](../../docs/week-02/nam-upload-flow-review.md).
