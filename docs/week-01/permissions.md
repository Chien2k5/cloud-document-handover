# Ma trận quyền theo dự án

Quyền được lấy từ Membership trong PostgreSQL trên mỗi request. UUID/projectId ở URL chỉ là tài nguyên được yêu cầu; không phải chứng cứ caller có quyền. Không nhận role, ownerId hoặc userId đăng nhập từ frontend. User có thể OWNER ở A và VIEWER ở B.

| Thao tác | Owner | Editor | Viewer | Ngoài project | Tình trạng |
| --- | --- | --- | --- | --- | --- |
| Tạo project mới | Mọi tài khoản đăng nhập đều tạo được và trở thành Owner của project mới | Tương tự | Tương tự | Tương tự | Đã code |
| List project | Chỉ project có membership | Tương tự | Tương tự | Không thấy project khác | Đã code |
| Xem project và danh sách thành viên | Có | Có | Có | 404 | Đã code |
| Thêm/gán/gỡ Editor hoặc Viewer | Có | 403 | 403 | 404 | Đã code |
| Đổi/xóa Owner | 409 nếu target là Owner; role OWNER trong body bị 400 | Không | Không | Không | Chưa hỗ trợ transfer |
| Khởi tạo/complete upload | Có | Có | Không | Không | Contract-only; complete cần là người khởi tạo |
| List/download file đã VERIFIED | Có | Có | Có | Không | Contract-only |
| Tạo/phát hành/thu hồi gói | Có | Không | Không | Không | Contract-only |
| Xem/tải gói phát hành | Có | Chỉ nếu là người nhận được chỉ định | Tương tự | Chỉ tài khoản là người nhận được chỉ định | Contract-only |
| Xác nhận gói | Chỉ nếu là người nhận được chỉ định | Tương tự | Tương tự | Tương tự | Contract-only |

Các API đã code: GET không có session trả 401; thao tác thay đổi thiếu/sai CSRF có thể trả 403 trước khi kiểm tra authentication. Project không tồn tại và project caller không tham gia cùng trả 404 `PROJECT_NOT_FOUND`; tránh lộ sự tồn tại. Thành viên có quyền đọc nhưng thiếu quyền Owner nhận 403 `OWNER_REQUIRED` khi sửa membership. Response không chứa password_hash.

Session: Spring Security form login, BCrypt strength 12; JSESSIONID HttpOnly, SameSite=Lax, Secure mặc định true (local HTTP được tắt ở profile local), timeout 30 phút không hoạt động. Có bảo vệ session fixation, xoay CSRF khi login/logout, logout hủy session. API CSRF trả masked token để gửi qua X-CSRF-TOKEN. Không tắt CSRF, không auth header cho client tự chọn user, không HTTP Basic hoặc tài khoản admin mặc định.

Giới hạn tuần 1: chưa registration/invitation/reset password/rate limiting, chưa session lưu bền hoặc vô hiệu hóa mọi session khi admin disable user, chưa CORS nhiều origin. Nam dùng proxy cùng origin. Không đưa local demo profile lên AWS. Thiết kế quyền gói và quota cần review Nam/Đăng trước khi hiện thực các API tuần sau.
