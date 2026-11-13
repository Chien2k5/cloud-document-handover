# Hướng dẫn Portal tích hợp

1. Mở http://127.0.0.1:5173 khi frontend và backend đang chạy, đăng nhập bằng email
   và mật khẩu tài khoản portal. Tài khoản Nextcloud là hệ thống riêng.
2. Chọn dự án hoặc tạo dự án. Xem vai trò, quota và thành viên. Owner có thể
   thêm/đổi vai trò EDITOR/VIEWER hoặc gỡ thành viên theo UUID tài khoản hiện có.
3. Owner/Editor chọn file 1 byte–100 MiB. Frontend tính hash, xin URL từ backend,
   PUT trực tiếp S3 và complete đúng Version ID. Chờ trạng thái từ backend.
   AVAILABLE chỉ nói upload hoàn tất; VERIFIED mới cho tải và chọn bàn giao.
4. Xem danh sách từng version/phân trang. Có thể thêm bản mới cùng filename;
   v1 vẫn giữ nguyên. Reload rồi chọn lại dự án để tiếp tục đối soát bằng Upload ID.
   Nếu mất Version ID trước complete, không đoán latest; chờ hết hạn và tạo upload mới.
5. Owner chọn các phiên bản AVAILABLE + VERIFIED, nhập title, UUID người nhận và
   hạn tương lai, tạo DRAFT. Copy Handover ID để người nhận mở lại gói.
6. Owner mở gói và phát hành. Người nhận được chỉ định đăng nhập tài khoản của mình,
   nhập Handover ID và xác nhận. Gói chỉ CONFIRMED khi backend kết luận đủ người nhận.
7. Owner thu hồi gói khi cần. Hết hạn/thu hồi chặn cấp link mới; link cũ còn chịu TTL.
8. Nếu lỗi, đọc thông báo; 403 có thể làm mới CSRF rồi thử lại. Không tự lặp PUT
   khi timeout/412 hoặc thiếu Version ID. Không lưu/chia sẻ presigned URL/token.

Ứng dụng này chưa có hộp thư danh sách gói, tìm mọi người dùng, đăng ký hay reset
password vì chưa có endpoint backend. Dùng UUID gói và tài khoản enabled do nhóm cấp.
Hướng dẫn cài/chạy/test/deploy và phân loại bằng chứng: `frontend/README.md`.
AWS thật và pilot người dùng vẫn cần nhóm tổ chức; không coi fixture test là pilot.
