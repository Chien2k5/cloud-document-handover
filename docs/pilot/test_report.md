# Kiểm thử frontend tích hợp

Các dòng PASS T01–T05 trong bản Nam `00bc97b` là kết quả lịch sử **chưa xác minh**.
Commit đó có `app.js` rỗng, không kèm bằng chứng để tái lập kết nối backend,
checksum hay bàn giao. Không sử dụng các dòng đó để nghiệm thu bản tích hợp.

Kết quả checkpoint được cập nhật sau khi thực sự chạy. Unit/mock, browser fixture,
Spring Boot/PostgreSQL và AWS thật phải được ghi riêng. AWS S3/Lambda E2E: **NOT_RUN**.
