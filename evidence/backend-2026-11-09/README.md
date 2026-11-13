# Kiểm thử backend trước khi push nhánh dung

Ngày 09/11/2026. Kết quả **PASS LOCAL**: Maven clean verify và JAR build thành công; 62 test, 0 failure/error/skipped. Source nền là `b95bc0c1778916f802c0ce20307a152d4e00aaf3` cộng các thay đổi backend/contract/tài liệu được đưa vào cùng commit với bằng chứng này. `verification.json` ghi hash source đã kiểm, từng bộ test và hash JAR. File evidence được thêm sau khi test; source đã được kiểm lại không thay đổi.

| Bộ test | Tests | Failures | Errors | Skipped |
| --- | --- | --- | --- | --- |
| ActiveAccountFilterTest | 3 | 0 | 0 | 0 |
| BackendIntegrationTest | 10 | 0 | 0 | 0 |
| ContractTest | 5 | 0 | 0 | 0 |
| HandoverIntegrationTest | 22 | 0 | 0 | 0 |
| S3StorageAdapterTest | 6 | 0 | 0 | 0 |
| UploadIntegrationTest | 16 | 0 | 0 | 0 |
| Tổng | 62 | 0 | 0 | 0 |

Kiểm bằng Java 25, target Java 21, Maven 3.9.12, PostgreSQL 17 thật trong DB fixture mới riêng trên loopback. RUN_DB_TESTS=true; UPLOAD_S3_ENABLED=false; Hikari max 8/min idle 0 chỉ ở môi trường test. Dùng Mockito javaagent qua argLine cho hạn chế attach của Windows. Cluster fixture đã được dừng. Không lưu credential, cookie, signed URL hoặc dump trong bằng chứng.

Để tái lập: tạo DB test riêng có thể bỏ dữ liệu, đặt DB_URL/DB_USERNAME/DB_PASSWORD trong môi trường và RUN_DB_TESTS=true, UPLOAD_S3_ENABLED=false; từ backend chạy `mvnw.cmd -B -ntp clean verify` (Linux dùng `sh mvnw`). Lần này Maven được chạy offline từ cache với các flag `-o -B -ntp`, cùng argLine javaagent Mockito 5.17.0. Cần thêm javaagent tương tự nếu môi trường Windows chặn self-attach. Integration tests TRUNCATE fixture, chỉ dùng DB thử riêng.

Coverage gồm create chỉ nhận AVAILABLE + VERIFIED, rollback manifest/audit, recovery polling từ session mới và nhiều version, missing/failed/late/wrong-identity checksum, quyền/quota/concurrency, complete/publish/confirm/revoke, exact S3 version và các lỗi/stream/config của adapter.

Storage dùng fake/mock; signer dùng credential giả. AWS và browser E2E **CHƯA CHẠY**. Lambda của Đăng và React của Nam vẫn cần ghép theo [hướng dẫn tích hợp](../../docs/backend-integration-2026-11-08.md). Không lấy kết quả local làm bằng chứng S3/Lambda/Beanstalk hoặc restore Cloud đã thành công.
