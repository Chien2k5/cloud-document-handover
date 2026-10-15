# Thiết kế database PostgreSQL

Nguồn thực thi là Flyway `V1__initial_schema.sql`. Không dùng `ddl-auto=update`, H2 hoặc dữ liệu Nextcloud. File `erd.mmd` mở/sửa bằng VS Code hỗ trợ Mermaid, Mermaid Live hoặc công cụ Markdown có Mermaid. Không cần upload dữ liệu thật để xem sơ đồ. Migration chứa 10 bảng; tất cả định danh do backend tạo bằng UUID, thời gian lưu TIMESTAMPTZ và API xuất UTC.

| Bảng | Mục đích và khóa |
| --- | --- |
| app_users | Email lowercase unique, BCrypt password_hash, display_name, enabled; không có global project role |
| projects | Người tạo, tên/mô tả, quota/used/reserved; tất cả số byte không âm, used + reserved không vượt quota |
| memberships | PK (project_id,user_id), role OWNER/EDITOR/VIEWER; index theo user để list dự án; partial unique index tối đa một OWNER |
| file_metadata | Tài liệu logic trong project; tên file chỉ là metadata, không dùng làm đường dẫn object |
| file_versions | Phiên bản tài liệu: project/file, bucket/key/version, size/type, expected/actual SHA-256 và hai trạng thái |
| upload_sessions | Một session cho một file version, người khởi tạo, reserved_bytes, expiry và completed_at |
| handovers | Project, người tạo, DRAFT/READY/CONFIRMED, ACTIVE/REVOKED, expiry và published_at |
| handover_items | PK (handover_id,file_version_id); tham chiếu phiên bản cụ thể, không trỏ bản latest |
| handover_recipients | PK (handover_id,user_id); người nhận trong/ngoài project, quyền ACTIVE/REVOKED và confirmed_at riêng |
| audit_events | Actor/project/action/target/requestId/thời gian, không payload tùy ý hoặc credential |

## Ràng buộc đã có trong PostgreSQL

- Foreign key giữ liên kết User–Project–Membership và hồ sơ file/gói; không cascade xóa hồ sơ. Xóa version được gói tham chiếu bị từ chối.
- Composite FK `(file_id,project_id)` ngăn file version khác dự án; composite FK của upload và handover item ngăn trộn project. `UNIQUE(id,project_id)` hỗ trợ các FK này.
- `(bucket,object_key,s3_version_id)` unique khi Version ID đã biết. Version ID chưa có được NULL trong PENDING; chuỗi rỗng và literal `null` bị chặn. AVAILABLE bắt buộc Version ID.
- Hash gồm 64 ký tự hex lowercase. VERIFIED đòi AVAILABLE, actualSha256 có giá trị và bằng expected; MISMATCH đòi AVAILABLE, actual khác expected. AVAILABLE một mình không đổi integrity.
- Expiry của upload/gói sau created_at. READY/CONFIRMED cần published_at. Check enum bảo vệ role, trạng thái upload/integrity/workflow/access.
- Index theo project/thời gian, file/thời gian, trạng thái phiên bản, người nhận, membership, upload hết hạn và audit. Không index hash/password không cần thiết.

## Điều service phải bảo đảm thêm

DB không kết nối S3 và không chứng minh HEAD/checksum bằng dữ liệu thật. Điều kiện phát hành AVAILABLE + VERIFIED + retrievable, quota reservation đúng session, bất biến manifest/identity phiên bản, expiry/quyền người nhận và audit các thao tác bàn giao sẽ do service tuần 2–3 kiểm tra trong transaction. Chưa có service hoặc trigger giả lập những chức năng này.

Một file version sau complete phải giữ nguyên bucket/key/version/hash/size. Nếu cần bản mới phải tạo row mới; item gói trỏ row cũ. Tuần 1 chưa có API sửa hoặc xóa file version. Cần kiểm thử bảo vệ tính bất biến trước triển khai service file.

ProjectService hiện tạo project và OWNER trong một transaction; membership mutation khóa project và chặn sửa/xóa Owner. Partial unique index chỉ bảo đảm **tối đa** một Owner, còn service bảo đảm có Owner khi tạo. Chưa có API chuyển quyền sở hữu, xóa user hay xóa project. Chỉ provision user an toàn ở local; provisioning cho môi trường chung cần thống nhất.

## Migration và kiểm thử

Flyway chạy tự động lúc startup; nếu migration lỗi ứng dụng không khởi động. DB phải trống hoặc đã có Flyway history hợp lệ; không bật baseline tự động, không sửa V1 sau khi nhóm đã dùng chung. Thay schema sau này tạo V2 trở đi và thử lại từ DB sạch.

Bộ `BackendIntegrationTest` chạy khi `RUN_DB_TESTS=true`, dùng PostgreSQL thật từ `DB_URL`. Mỗi test xóa **các bảng nghiệp vụ trong DB thử**, vì vậy phải dùng database riêng bỏ được. `mvnw verify` không có cờ này chỉ chạy contract tests và báo các integration test SKIPPED; không được ghi là đã test database.
