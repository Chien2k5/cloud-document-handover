# Backend lưu trữ và bàn giao tài liệu

Phần backend của Dũng cho dự án nhóm 5: Spring Boot, PostgreSQL/Flyway, auth/quyền theo dự án, upload theo phiên bản, đối soát SHA-256 và bàn giao DRAFT → READY → CONFIRMED. Nhánh làm việc: `dung`.

Kiến trúc mục tiêu của nhóm dùng React, S3/Lambda và Elastic Beanstalk. Repo trên nhánh này hiện có backend và hợp đồng tích hợp; chưa có adapter S3/Lambda hoặc frontend mới được nhóm cung cấp. Các kết quả local không thay nghiệm thu AWS.

## Bản bàn giao tuần 5

- [Báo cáo tuần 5](docs/week-05/report.md) và [checklist nghiệm thu](docs/week-05/acceptance-checklist.md).
- [Hướng dẫn bàn giao kỹ thuật](docs/week-05/final-handover.md): phạm vi, cách chạy, cấu hình, API và giới hạn.
- [Kịch bản demo](docs/week-05/demo-script.md) và [bảng đóng góp theo commit](docs/week-05/contributions.md).
- [Bằng chứng hiện tại](evidence/week-05/backend/README.md), [restore local bản chốt](evidence/week-05/local-restore/restore-report.md).

## Chạy backend

Cần Java 21–25, PostgreSQL và kết nối Maven Central ở lần tải dependency đầu. Java target 21; môi trường kiểm thử đã dùng Java 25/PostgreSQL 17.9. Dùng [backend/README.md](backend/README.md) để tạo role/database, đặt biến môi trường và chạy:

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

Spring Boot không tự nạp `.env`. Các tên biến backend nằm trong [backend/.env.example](backend/.env.example); không đưa giá trị secret vào Git. Profile local chỉ phục vụ HTTP trên máy và seed demo tùy chọn, không dùng trên AWS.

Khi chưa có storage adapter, auth/Project/Membership vẫn chạy; thao tác storage trả 503 STORAGE_UNAVAILABLE. Storage giả chỉ nằm trong test source.

## Kiểm thử và phục hồi

Từ `backend`, chạy `mvnw.cmd -B -ntp verify`. Mặc định integration suites bị SKIPPED. Để kiểm PostgreSQL, đặt RUN_DB_TESTS=true và DB_URL/DB_USERNAME/DB_PASSWORD tới DB thử riêng có thể xóa dữ liệu, theo hướng dẫn backend. Không dùng DB chung: tests TRUNCATE bảng nghiệp vụ.

- [Ma trận C06](docs/week-04/c06-test-matrix.md) và [checklist C07/bản chốt](docs/week-05/acceptance-checklist.md).
- [Runbook restore local](docs/week-04/local-restore-runbook.md); script tạo DB nguồn/đích mới và không drop DB.
- Lượt chạy tuần 5 lưu bằng `--evidence-dir evidence/week-05/local-restore` để giữ riêng evidence lịch sử.

## Ghép nhóm

Đăng cung cấp bean [StoragePort](backend/src/main/java/vn/edu/uet/handover/upload/StoragePort.java) và Lambda theo [hợp đồng adapter](contracts/s3-adapter-contract.md); Nam ghép [OpenAPI](contracts/openapi.yaml); Chiến phụ trách môi trường/triển khai AWS. Ngày 29/10/2026, [Nam đã đồng ý luồng upload tổng thể](evidence/week-01/nam-upload-flow-confirmation.md). [Đối chiếu luồng và phần còn mở](docs/week-02/nam-upload-flow-review.md) ghi rõ review API/mã lỗi/retry chi tiết và xác nhận Đăng/Chiến còn thiếu; G2–G5 Cloud chưa được nghiệm thu.

Đăng đã gửi bản POC Python/boto3 ngày 29/10; xem [phân tích adapter và thứ tự tích hợp](docs/week-02/dang-s3-adapter-review.md). POC chưa tương thích trực tiếp StoragePort/JSON checksum và chưa có bean AWS thật trong ứng dụng. Review offline đã thực hiện, AWS/browser vẫn chưa được kiểm chứng trong lần này.

Đọc [câu hỏi phối hợp](docs/week-03/huong-dan-cho-dung.md) và [các mục còn cần nhóm](docs/week-05/acceptance-checklist.md). Không sửa trực tiếp hoặc copy đè phần của thành viên khác; [PRINCIPLE.MD](PRINCIPLE.MD) giữ quy tắc review/merge và TV1 triển khai. Những chỗ trong quy tắc còn nhắc Nextcloud cần nhóm đồng bộ với kế hoạch S3 mới.

## Đóng gói phần Dũng

Sau khi commit và có working tree sạch ở phần được đóng gói:

```powershell
python backend/tools/build_handover_bundle.py
```

Tool tạo `output/backend-handover-dung.zip` và manifest SHA-256 theo commit. Gói chứa source backend, contracts, hướng dẫn và evidence đã chọn; không có JAR/dependency, dữ liệu runtime, bản dump, secret hoặc phần frontend/AWS chưa được cung cấp. Đọc mục đóng gói trong hướng dẫn bàn giao để kiểm lại nội dung.

## Lịch sử và bằng chứng theo tuần

[Tuần 1](docs/week-01/report.md) · [Tuần 2](docs/week-02/backend-completion.md) · [Tuần 3](docs/week-03/backend-report.md) · [Tuần 4](docs/week-04/report.md). Mỗi kết quả thuộc source/commit và thời điểm ghi trong evidence tương ứng; dùng tuần 5 cho trạng thái chốt mới nhất. Tài liệu TV3 cũ ngoài phạm vi được giữ nguyên trên máy, không đưa vào bundle.
