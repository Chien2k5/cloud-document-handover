# Đối chiếu tài liệu TV3 với backend S3 hiện hành

Ngày 08/11/2026. Hướng dẫn hiện hành là [bàn giao backend](../backend-integration-2026-11-08.md), [OpenAPI](../../contracts/openapi.yaml), [schema SQL](../../backend/src/main/resources/db/migration/V1__initial_schema.sql) và [ERD Mermaid](../week-01/erd.mmd). Tài liệu Word/ERD Nextcloud được giữ như bản thiết kế lịch sử; không dùng các bản đó làm contract cho Nam/Đăng.

Đã đọc hai bản `Tai_lieu_thiet_ke_backend_TV3_da_dinh_dang.docx` trong thư mục Cloud và docs/tv3 của workspace chính, gồm OpenAPI YAML và JSON mẫu bên trong; hai bản khác PostgreSQL 17.9/17.11 nhưng cùng thiết kế Nextcloud. `Ke_hoach_TV3_backend_5_tuan.docx` ở hai vị trí giống SHA-256. ERD PNG/drawio/SVG cùng mô hình cũ. Các binary gốc chưa được sửa trong lượt này; bảng dưới xác định nội dung thay thế cần áp dụng khi xuất lại Word và sơ đồ.

| Tài liệu/vị trí | Nội dung cũ | Nội dung hiện hành để thay |
| --- | --- | --- |
| Thiết kế TV3 mục 1.1–1.4, D06, 4.5 | PROJECT_LEADER/MEMBER; trưởng dự án ghi nhận thủ công, người nhận có thể không đăng nhập | OWNER/EDITOR/VIEWER theo Membership; Owner tạo/phát hành/thu hồi. Người nhận ACTIVE được chỉ định đăng nhập và tự confirm; backend ghi actor/time. Gói còn hạn/chưa revoke mới được confirm |
| D02, mục truy cập dữ liệu | Spring Data JPA | JdbcTemplate, Controller/Service/Repository, transaction Spring và Flyway |
| D03/D04 và mục 3.2–3.10 | Hai DB portal/Nextcloud, nc_user_id, workspace, package folder, file/share mapping, team | PostgreSQL metadata của ứng dụng; nội dung file và checksum trên S3. 10 bảng nghiệp vụ theo V1: app_users, projects, memberships, file_metadata, file_versions, upload_sessions, handovers, handover_items, handover_recipients, audit_events |
| Mục 4.2–4.4 | Copy/share Nextcloud; PREPARING/REVOKING/ERROR; thu hồi URL tức thời sau verify | DRAFT → READY qua publish, rồi CONFIRMED; access ACTIVE/REVOKED, expiry được kiểm khi truy cập. Pin exact S3 version. Revoke chặn URL mới, URL đã cấp còn chịu TTL |
| Mục 5.1 và YAML 5.3 | JSON login, snake_case, Idempotency-Key, tạo workspace trả 202 | Login form-urlencoded email/password với session/CSRF; DTO camelCase; OpenAPI 0.5.0. Init/create chưa có idempotency key. Publish/confirm/revoke xử lý lặp trên resource hiện có |
| YAML 5.3 và ví dụ 5.4 | nc_file_ids, share_password, recipient_name/evidence_note; 422 | fileVersionIds, recipientUserIds, expiresAt khi create. Chỉ AVAILABLE + VERIFIED. Publish/confirm/revoke không body. Lỗi input 400, trạng thái 409; code theo OpenAPI/examples hiện hành |
| Mục 5.2/5.3 | API list gói và events đã được phác thảo | Những API đó chưa có trong runtime; không ghi đã triển khai. Audit tối thiểu hiện lưu DB. Không thêm endpoint chỉ để khớp bản nháp cũ |
| Kế hoạch TV3 các mục 1–14 | C01–C06 theo Nextcloud, thao tác copy/share và xác nhận thủ công | Đối chiếu C01–C07 của Pr2/process2.pdf: C01 contract/schema; C02 auth/project/membership; C03 metadata/complete; C04 checksum; C05 bàn giao/xác nhận; C06 test; C07 revoke/audit |
| ERD_C01_portal.drawio/png/svg | team, team_membership, share_ref và các trường nc_* | Dựng lại từ ERD Mermaid hiện hành. HandoverItem FK tới FileVersion trong cùng project; HandoverRecipient quản lý người nhận. UploadSession cung cấp uploadId bền vững cho từng version |
| Bảng giờ và nghiệm thu | 520 giờ hoặc kế hoạch backend cũ | Pr2 dự kiến 320 giờ, Dũng 86 giờ; đó là ước lượng, không phải giờ đã thực hiện. Ghi local PostgreSQL/fake và AWS thật riêng |

Không thêm bảng ShareRef/Team hoặc đổi lại JPA để làm source giống bản Word cũ. Không đổi V1 khi DB đã dùng; các thay đổi nghiệp vụ/API lần này không cần migration. Nếu nhóm đổi phạm vi trong tương lai, cần quyết định và migration riêng.

Các nội dung chưa chốt: phê duyệt contract với Đăng/Nam, AWS Lab/IAM/CORS, chính sách cleanup/quota byte thực, bằng chứng restore kết hợp GET đúng version. Không ghi các mục này PASS từ kết quả test local.
