# Kết quả backend bàn giao tuần 3

Ngày 29/10/2026, Dũng, nhánh dung trên nền bd4a897. Phần triển khai mới là HandoverController/Dtos/Repository/Service và bộ kiểm thử. Không sửa adapter AWS, Lambda, frontend hoặc tài nguyên của thành viên khác. Flyway V1 giữ nguyên, không có dependency hoặc biến môi trường mới.

## Kết quả

Đã triển khai sáu operation có sẵn trong hợp đồng: tạo DRAFT, xem manifest, publish READY, confirm, download item và revoke cơ bản. OpenAPI 0.4.0-week3-backend đánh dấu 22 operation implemented ở backend. Điều này không có nghĩa AWS hoặc UI đã tích hợp.

- Owner tạo gói từ FileVersion AVAILABLE thuộc đúng dự án, tài khoản người nhận enabled và deadline trong tương lai. DRAFT có thể chứa integrity đang chờ; duplicate UUID và dữ liệu giả mạo bị chặn. Title/expiry kiểm kiểu JSON chặt chẽ.
- Publish yêu cầu tất cả item AVAILABLE + VERIFIED, người nhận còn hợp lệ và exact HEAD khớp identity/size/type. Không giữ transaction qua network; trước READY khóa lại project → handover, kiểm quyền/state/deadline và manifest không đổi. Repeat publish không gọi HEAD hoặc ghi audit lại khi gói đã phát hành còn hiệu lực.
- Manifest không có API chỉnh sửa. HandoverItem trỏ đúng FileVersion; các writer của ứng dụng không đổi S3 identity của AVAILABLE version. Upload v2 thêm row, không đổi v1. Không tuyên bố bảo vệ được SQL sửa DB thủ công ngoài ứng dụng.
- Owner có thể xem lịch sử DRAFT/hết hạn/thu hồi. Người nhận ACTIVE chỉ xem/tải READY/CONFIRMED còn hạn, chưa thu hồi; quyền này không cho phép xem project. Download chỉ item trong gói, kiểm exact HEAD, ký GET với hạn tối đa min(300 giây, hạn gói), kiểm lại quyền sau storage.
- Confirm lấy actor từ session và thời gian server. Chỉ người nhận ACTIVE xác nhận chính mình; gói CONFIRMED khi mọi recipient ACTIVE có confirmedAt. Repeat confirm giữ timestamp và không ghi audit trùng.
- Revoke cơ bản chỉ Owner, idempotent, giữ lịch sử và chặn quyền/cấp URL/xác nhận mới. URL đã cấp hoặc request đã vượt bước kiểm tra cuối có thể còn hiệu lực theo TTL; không hứa thu hồi tức thời.
- Các POST publish/confirm/revoke không nhận body. Audit tạo/phát hành/xác nhận/thu hồi ghi trong cùng transaction. Không log hoặc lưu signed URL trong evidence.

## Kiểm thử

Xem [bằng chứng](../../evidence/week-03/backend/README.md). Có PostgreSQL thật, transaction đồng thời và Tomcat/HTTP TCP với cookie/CSRF; schema phản hồi được đối chiếu OpenAPI. Storage chỉ là fixture trong test source. Các ca bao gồm publish/confirm đồng thời, hết hạn/revoke giữa hai bước network và DB, chặn người ngoài danh sách, người nhận ngoài project, rollback, pin v1 sau upload v2 và lỗi HEAD/signer.

Các bảng handovers/items/recipients/audit đã có trong V1. Không cần migration mới cho luồng hiện tại. Thử thu hồi từng người nhận là fixture kiểm quyền, chưa có API quản trị recipient riêng. Registration/invitation, sửa draft, danh sách gói, lịch sử UI nâng cao và C07 đầy đủ không được tự mở rộng trong lần này.

## Phần cần phối hợp

C04 còn cần ghép adapter/result-key và chạy Lambda thật với Đăng; môi trường/IAM/CORS/HTTPS do Chiến xác nhận; UI/E2E do Nam ghép. C05 đã có logic backend và bằng chứng local, còn nghiệm thu AWS/G3 cần nhóm chạy chung. Hợp đồng vẫn chờ Nam/Đăng review, không có phê duyệt nào được tự ghi nhận.

[Hướng dẫn cho Dũng](huong-dan-cho-dung.md) có lệnh tự chạy test, tin nhắn gửi từng người, đầu vào cần lấy và kịch bản nghiệm thu Cloud. Các bằng chứng tuần 2 là snapshot lịch sử của commit trước, không đại diện source mới.
