\# Đề xuất kỹ thuật TV2 - Tuần 1



\## D03 - Database



\### Đề xuất

Sử dụng PostgreSQL cho Nextcloud.



\### Cấu hình local đang thử nghiệm

\- PostgreSQL 17 Alpine

\- Database: nextcloud

\- User: nextcloud



\### Kết quả thử nghiệm

\- Nextcloud kết nối PostgreSQL thành công

\- Cài đặt Nextcloud thành công

\- Dữ liệu vẫn tồn tại sau khi container được tạo lại



\### Lưu ý

Đây là đề xuất của TV2.

Phiên bản database cuối cùng cần được TV2 và TV3 cùng chốt theo phiên bản Nextcloud sử dụng.



\---



\## D05 - Mô hình sở hữu file



\### Đề xuất cho MVP

Sử dụng tài khoản dịch vụ theo nhóm kết hợp với thư mục Project và cơ chế share.



Ví dụ:



Project A

└── Workspace A



Project B

└── Workspace B



Backend sẽ thông qua Nextcloud adapter để:

\- tạo workspace

\- cấp quyền

\- tạo link chia sẻ

\- thu hồi link



\### Lý do

\- Phù hợp pilot nhỏ

\- Dễ kiểm soát quyền

\- Không cần thêm app phức tạp trong MVP



\### Phương án khác

Có thể nghiên cứu Team folders nếu nhóm quyết định sử dụng.



\### Lưu ý

Chưa chốt chính thức.



\---



\## D07 - Quota và thời hạn



\### Đề xuất ban đầu



Quota:

\- Quản lý theo phạm vi Project hoặc nhóm nếu triển khai được phù hợp với mô hình D05.

\- Không coi quota của tài khoản là quota thư mục Project nếu chưa kiểm chứng.



Link bàn giao:

\- Có thời hạn

\- Có thể có mật khẩu

\- Mặc định chỉ đọc



Backup:

\- Thời gian lưu backup sẽ do TV1 và cả nhóm thống nhất.



\### Lưu ý

Cần tiếp tục kiểm thử quota và thời hạn link trước khi chốt.



\---



\## Trạng thái



\- D03: Đã thử nghiệm PostgreSQL local thành công

\- D05: Đã có đề xuất mô hình

\- D07: Đã có đề xuất ban đầu



Các mục trên chưa phải quyết định cuối cùng của nhóm.

