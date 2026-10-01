# Quy tắc phối hợp và merge

## 1. Phạm vi phụ trách
- TV1: infra/, deploy/, ops/ và Compose tổng.
- TV2: nextcloud/, backend/integrations/nextcloud/.
- TV3: backend/ còn lại, migration và contracts/openapi.yaml.
- TV4: frontend/, tests/e2e/, docs/pilot/.

Trước khi sửa phần của người khác, trao đổi và thống nhất.
Không copy đè hoặc xóa code của người khác để xử lý conflict.

## 2. Branch và commit
- Không commit trực tiếp vào main.
- Mỗi nhiệm vụ có Issue và branch: task/MA-ten-ngan.
  Ví dụ: task/A01-moi-truong-local.
- Tạo branch từ main mới nhất.
- Commit ghi rõ thay đổi; chỉ đưa vào các file liên quan.
- Ghép từng phần hoàn thành, không đợi đến cuối dự án.
- Không force push lên branch chung.

## 3. Pull Request và merge
Mỗi Pull Request ghi:
- Issue/nhiệm vụ liên quan.
- Nội dung thay đổi và cách kiểm tra.
- Ảnh hưởng API, database, biến môi trường hoặc build/deploy.

Chủ phần việc review; TV1 điều phối merge.
Riêng contracts/openapi.yaml phải được TV2 và TV4 cùng duyệt.

Sau khi merge, mọi người cập nhật từ main và kiểm tra phần mình.
Conflict do người tạo thay đổi phối hợp với chủ file xử lý.

## 4. Giữ tương thích
- Không tự đổi công nghệ hoặc thiết kế chưa được nhóm chốt.
- Đổi API/adapter: thống nhất với bên sử dụng và cập nhật contract.
- Đổi database portal: có migration do TV3 quản lý.
- Thêm biến môi trường: cập nhật .env.example và hướng dẫn.
- Đổi cổng, volume hoặc cách chạy: thống nhất với TV1.
- Không sửa trực tiếp database hay dữ liệu nội bộ Nextcloud.

## 5. Trước khi bàn giao
- Đã kiểm tra và có hướng dẫn để người khác chạy lại.
- Không có mật khẩu, token, khóa AWS hoặc dữ liệu thật trong repo.
- Ghi rõ lỗi và hạn chế còn tồn tại.
- Chỉ đóng Issue khi người nhận đã thử và xác nhận.
- Chỉ TV1 deploy bản đã duyệt lên AWS.
