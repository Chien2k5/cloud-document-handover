\# Đề xuất mô hình quyền Nextcloud



\## 1. Mục tiêu



Mỗi Project có workspace riêng trong Nextcloud.



Người thuộc Project A không được truy cập tài liệu của Project B.



\## 2. Vai trò đề xuất



\### Leader

\- Xem file

\- Upload file

\- Download file

\- Sửa file

\- Quản lý thành viên theo luồng Portal

\- Tạo gói bàn giao

\- Tạo hoặc thu hồi link chia sẻ thông qua Portal



\### Member

\- Xem file trong Project

\- Upload file

\- Download file

\- Sửa file theo quyền được cấp

\- Không tự quản lý thành viên

\- Không tự tạo gói bàn giao nếu Portal không cấp quyền



\### Người nhận bên ngoài

\- Không phải thành viên Project

\- Chỉ truy cập tài liệu thông qua link bàn giao

\- Link có thể có mật khẩu

\- Link có thời hạn

\- Quyền mặc định: chỉ đọc / download

\- Khi link bị revoke thì không được truy cập tiếp qua link



\## 3. Nguyên tắc cách ly



\- Project A và Project B phải có vùng tài liệu riêng.

\- User của Project A không được đọc hoặc sửa file Project B.

\- Khi thành viên bị gỡ khỏi Project, quyền truy cập trực tiếp trên Nextcloud cũng phải bị loại bỏ.



\## 4. Trạng thái



Đây là đề xuất tuần 1 của TV2.



Mô hình cuối cùng phụ thuộc các quyết định D04, D05 và D07 của cả nhóm.

