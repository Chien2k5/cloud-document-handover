# Kết quả tuần 1 của Nguyễn Huy Dũng

Thực hiện ngày 15/10/2026, múi giờ Asia/Ho_Chi_Minh, trên branch `dung`, từ commit nền `0e70ee2`. Phạm vi C01 và nền C02 theo kế hoạch 5 tuần mới: một backend Spring Boot/PostgreSQL, schema Flyway, hợp đồng API và khung đăng nhập/dự án. Chưa có lịch ngày bắt đầu tuần của nhóm, Issue hoặc xác nhận review; không tự nhận đã hoàn thành nghiệm thu nhóm.

## Đã triển khai

- Spring Boot 3.5.16, Maven Wrapper 3.9.12, Java target 21, cấu hình PostgreSQL/env; BCrypt, session cookie, CSRF, health kiểm DB và requestId/lỗi JSON.
- Auth form login, me, logout, lấy CSRF; tạo/list/xem project; list/gán/gỡ membership Editor/Viewer bởi Owner. Caller được xác định từ session, quyền lấy từ DB; thay projectId không vượt quyền. Owner bất biến trong phạm vi tuần 1.
- Transaction tạo Project + Owner + audit; thay membership có kiểm tra Owner và khóa project. Không nhận quyền/quota tùy ý từ frontend.
- Flyway V1 gồm User, Project, Membership, FileMetadata, FileVersion, UploadSession, Handover, HandoverItem, HandoverRecipient, AuditEvent. PK/FK/unique/index/check quota/hash/trạng thái; composite FK ngăn file/gói khác project.
- ERD Mermaid có thể sửa; OpenAPI 3.0.3 có 22 operations (11 implemented, 11 contract-only), 25 schemas; 19 JSON examples và schema checksum Lambda.
- README, ma trận quyền, quy tắc upload/complete/quota/integrity/phát hành, và các điểm cần thành viên khác xác nhận. Nội dung Nextcloud cũ được giữ nguyên để đối chiếu, không commit các file `docs/tv3/` có sẵn.

## Kết quả kiểm tra thực tế

| Kiểm tra | Kết quả | Bằng chứng và giới hạn |
| --- | --- | --- |
| Build/package JAR | PASS | Maven verify, Java 25, target Java 21 |
| PostgreSQL thật, Flyway từ schema trống | PASS | PostgreSQL 17.9; V1 tự tạo 10 bảng và history; không H2/ddl-auto |
| Constraint/FK/hash/trạng thái/quota DB | PASS | Integration test chặn version sai project, AVAILABLE thiếu version, VERIFIED sai hash, item chéo project, membership trùng, quota quá mức, xóa version được tham chiếu |
| API/security với DB thật | PASS | 5 integration tests qua Spring MockMvc: auth, CSRF, logout, hai project/4 role test, owner mutation, validation, thu hồi membership, route upload chưa code |
| OpenAPI/schema/examples | PASS | 3 contract tests: parser không lỗi/không ref hỏng, JSON API examples hợp schema, JSON checksum có ca hợp lệ và thiếu/sai identity/hash bị chặn |
| JAR/Tomcat qua HTTP thật | PASS | 41 request checks; session ID xoay, token CSRF cũ bị chặn, cookie jar riêng cho 4 user; JAR tự dừng sau smoke |
| S3/Lambda/Beanstalk thật | NOT RUN | Chưa nhận cấu hình, adapter hoặc môi trường AWS; không thuộc code tuần 1 này |
| UI React ghép API, HTTPS/cookie Secure thực tế | NOT RUN | Chờ Nam/Chiến; smoke local dùng HTTP và profile local |
| Test complete/quota đồng thời/publish/restore nghiệp vụ | NOT RUN | Chưa triển khai service tuần 2–4; constraint test không thay các bài này |

Tổng JUnit ở lần verify: **8 tests, 0 failures, 0 errors, 0 skipped** khi `RUN_DB_TESTS=true`. HTTP smoke là bộ kiểm tra riêng trên database trống thứ hai. Log tóm tắt đã bỏ secret ở `evidence/week-01/README.md`; raw build/JAR/data nằm ở đường dẫn Git ignore. Không ghi bản thiết kế hoặc data giả là tích hợp AWS thành công.

## API đã chạy và phần mới thiết kế

API đã chạy: `/api/v1/health`, `/auth/csrf`, `/auth/login`, `/auth/me`, `/auth/logout`, POST/GET `/projects`, GET `/projects/{id}`, GET `/projects/{id}/members`, PUT/DELETE `/projects/{id}/members/{userId}`. Login là form-urlencoded; nghiệp vụ dùng JSON.

Contract-only: init/complete/state upload, list/download file, create/get/publish/confirm/download-item/revoke handover. Chưa có S3 SDK/adapter/Lambda service hoặc mock endpoint trả AVAILABLE/VERIFIED/READY giả. Hiện gọi route upload chưa code nhận lỗi 404, không phản hồi thành công.

## Việc cần thống nhất và còn thiếu

1. Nam/Đăng review OpenAPI, ví dụ/mã lỗi; Nam chốt same-origin proxy, form login/CSRF và cách hiển thị hai nhóm trạng thái. Chưa có phản hồi/duyệt của hai bạn.
2. Đăng chốt HEAD exact version, upload headers/Version ID, schema và result key checksum, error/retry/idempotency; chạy POC thật. JSON/adapter mới là đề xuất, chưa tự nhận đã thống nhất.
3. Chiến chốt DB độc lập, Java runtime, HTTPS, provisioning user, quota/max-size/TTL, môi trường và AWS Lab. Local có demo-user seed tùy chọn, chưa có registration/invitation/account lifecycle cho môi trường chung.
4. Giới hạn đề xuất cần số đo: 1 GiB/project, 100 MiB/file, URL 300 giây. Chỉ quota mặc định khi tạo project hiện được cấu hình; service reservation/complete/release sẽ hiện thực tuần 2.
5. Thiếu bằng chứng frontend/adapter ghép chung ngày 4, Beanstalk/DB và POC S3→Lambda của nhóm, người nhận chạy lại/nghiệm thu. Không đóng Issue C01/C02 hoặc ghi toàn tuần 1 của nhóm đã đạt chỉ dựa trên local.
6. Tuần 2: hoàn thiện auth/quyền theo review, service upload/complete/quota và đối soát Lambda đúng Version ID; các API handover thuộc tuần 3. Không triển khai trước để tăng số lượng code.

## Git và cách đối chiếu

Chỉ commit `.env.example`, `.gitignore`, `.gitattributes`, phần dẫn README và các file mới trong `backend/`, `contracts/`, `docs/week-01/`, `evidence/week-01/`. Không commit tài liệu cũ chưa theo dõi, `.env`, runtime data, JAR hoặc credentials. Hash bàn giao chính xác xem `git log -1 --format=%H dung` và báo cáo cuối trong chat; không chèn hash của chính commit vào file thuộc commit đó.

Lịch sử GitHub/push và review không thay bằng chứng chạy. Branch cá nhân `dung` được dùng theo yêu cầu; không merge main, không force push, không tự tạo nhận xét/Issue/email cho người khác.
