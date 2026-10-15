# Bàn giao tuần 1 của Nguyễn Huy Dũng

Phần backend/database cho kế hoạch 5 tuần của Nhóm 5, INT3319. Đây là nền tảng local và bản hợp đồng để Nam/Đăng review; không phải biên bản nghiệm thu AWS hay xác nhận nhóm đã duyệt API.

## Căn cứ và cách xử lý tài liệu khác nhau

- Đã đọc toàn bộ báo cáo `BAO_CAO_TIEN_DO_DU_AN.pdf` (14 trang) và `KE_HOACH_5_TUAN_NHOM_5_BAN_DE_DOC.docx` do Dũng cung cấp. Báo cáo thiết kế Spring Boot/PostgreSQL/React/S3/Lambda; kế hoạch mới rút lịch 8 tuần xuống 5 tuần và ưu tiên tuần 1: DB/migration, API/quyền/trạng thái, khung auth/project.
- README, PRINCIPLE.MD và `docs/tv3/` có nội dung kiến trúc Nextcloud cũ. Giữ nguyên hồ sơ cũ, không sửa cấu hình hoặc phần việc của thành viên khác. Nhánh này triển khai Spring Boot/PostgreSQL theo yêu cầu trực tiếp của Dũng và hai tài liệu mới. Không dùng schema/trạng thái Nextcloud cho luồng S3 mới.
- Giữ quy tắc không commit main, không secret, không sửa AWS/frontend/adapter người khác. Dùng đúng branch cá nhân `dung` theo yêu cầu của Dũng. Hợp đồng OpenAPI vẫn cần Nam và Đăng review trước tích hợp. Chưa có Issue nhóm được cung cấp; không tự nhận đã đóng C01/C02 hay đã duyệt contract.

## Các đầu ra

| Đầu ra | Đường dẫn | Tình trạng |
| --- | --- | --- |
| Spring Boot, session auth, CSRF, Project/Membership | `backend/` | Đã triển khai; xem bằng chứng kiểm thử |
| Flyway schema PostgreSQL | `backend/src/main/resources/db/migration/V1__initial_schema.sql` | Schema cho toàn luồng, chưa có service upload/bàn giao |
| ERD sửa được bằng Mermaid | `docs/week-01/erd.mmd` | Thiết kế khớp migration |
| Giải thích DB | `docs/week-01/database.md` | Bao gồm ràng buộc và phần chỉ service tương lai bảo đảm |
| OpenAPI và ví dụ JSON | `contracts/` | Auth/project/member đã code; file/bàn giao chỉ hợp đồng |
| Ma trận quyền | `docs/week-01/permissions.md` | Quyền hiện tại và đề xuất tuần sau ghi riêng |
| Quy tắc quota/complete/integrity/gói | `docs/week-01/upload-handover-rules.md` | Hợp đồng chờ xác nhận, chưa tích hợp AWS |
| Kết quả và phần còn thiếu | `docs/week-01/report.md`, `evidence/week-01/README.md` | Ghi theo các lần chạy thật |

## Những việc cần phối hợp

- **Nam:** review form login + session cookie + CSRF; React gọi qua proxy cùng origin, dùng `credentials: 'include'`. Lấy CSRF trước login và lấy lại sau login/logout. Review schema và mã lỗi trước dựng mock; không gọi API contract-only như API đã có.
- **Đăng:** chốt request/response adapter HEAD/presign/read-result, Version ID, JSON checksum, thuật toán result key, signed headers, URL TTL, content type và giới hạn file. Chưa có SDK AWS hoặc adapter giả trong backend này.
- **Chiến:** chốt PostgreSQL độc lập, Java runtime trên Beanstalk, endpoint health, DB_URL/TLS, cookie HTTPS, quota/TTL và cách provision user. Build target Java 21; máy kiểm thử dùng Java 25. Không sửa Compose tổng hoặc tài nguyên AWS trong nhánh này.
- **Dũng:** nhận review trước chốt API ngày 3; thống nhất JSON checksum ngày 4; cung cấp ERD, migration, API/test và hạn chế cho báo cáo ngày 6. Các ngày là ngày tương đối, chưa được gán lịch thực tế.
