# Backend lưu trữ và bàn giao tài liệu

Bản backend local hiện hành: [hướng dẫn tích hợp ngày 08/11/2026](docs/backend-integration-2026-11-08.md), OpenAPI `0.5.0-backend-integration`. Tạo DRAFT yêu cầu AVAILABLE + VERIFIED; FileVersion trả uploadId để tiếp tục kiểm checksum sau reload. Tài liệu TV3/Nextcloud cũ được đối chiếu tại [bảng cập nhật tài liệu](docs/tv3/doi-chieu-tai-lieu-cu.md).

Phần backend của Dũng cho dự án nhóm 5: Spring Boot, PostgreSQL/Flyway, auth/quyền theo dự án, upload theo phiên bản, đối soát SHA-256 và bàn giao DRAFT → READY → CONFIRMED. Nhánh làm việc: `dung`.

Kiến trúc mục tiêu của nhóm dùng React, S3/Lambda và Elastic Beanstalk. Nhánh này có backend và adapter AWS SDK cho hợp đồng checksum v1. Adapter mặc định tắt. Lambda trên nhánh của Đăng cần đồng bộ đường dẫn và schema trước khi thử ghép trên AWS.

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

Khi S3 tắt, auth/Project/Membership vẫn chạy và thao tác storage trả 503 STORAGE_UNAVAILABLE. Cách bật adapter và yêu cầu với Lambda nằm trong [hướng dẫn backend](backend/README.md#kết-nối-s3).

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

## C09 — Đăng ký tài khoản

Tính năng được triển khai trên feature branch `task/C09-registration`: API
`POST /api/v1/auth/register` tạo tài khoản PostgreSQL, kiểm tra dữ liệu, bắt buộc
CSRF và hash mật khẩu bằng BCrypt. Frontend chuyển Đăng nhập/Đăng ký trong cùng
Card, không đổi URL; đăng ký thành công không tự đăng nhập hoặc tạo project/membership.

Xem [hướng dẫn frontend](frontend/README.md#c09--đăng-ký-tài-khoản),
[hướng dẫn API backend](backend/README.md#c09--đăng-ký-tài-khoản),
[contract C09](docs/registration/C09-R01-contract.md),
[security review](docs/registration/C09-R06-security-review.md) và
[final review R08](docs/registration/C09-R08-final-review.md).
Trạng thái review và các rủi ro public registration nằm trong báo cáo R08;
việc merge vào `dung` và triển khai production cần quyết định riêng.
