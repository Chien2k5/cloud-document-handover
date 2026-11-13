# Bằng chứng backend bàn giao tuần 3

Ngày 29/10/2026, nhánh dung trên nền bd4a897 + source mới. Windows, Java Temurin 25 target 21, Maven Wrapper 3.9.12, PostgreSQL 17.9. DB fixture riêng week3_junit_20261029 trên cluster 127.0.0.1:55434, dữ liệu runtime bị ignore; không dùng DB chung hoặc tài nguyên AWS.

| Kiểm tra | Kết quả | Phạm vi |
| --- | --- | --- |
| `mvnw.cmd -B -ntp verify`, RUN_DB_TESTS=true | BUILD SUCCESS, 41 tests, 0 failure/error/skipped | 3 filter unit, 10 nền tảng PostgreSQL, 4 contract, 12 upload, 12 handover |
| Handover HTTP TCP/Tomcat | PASS trong HandoverIntegrationTest | Cookie/CSRF, tạo/publish/get/download/confirm/revoke, schema response; người nhận ngoài project |
| Transaction đồng thời | PASS | 4 publish cùng lúc chỉ một audit; 6 confirm cho 2 người nhận chỉ 2 audit và đúng CONFIRMED |
| Race storage/state | PASS | Revoke/expiry trong HEAD chặn READY; revoke trong signer chặn trả URL; kiểm lại trạng thái sau network |
| Quyền/version/rollback | PASS | Chặn người ngoài danh sách và quyền project; pin v1 sau upload v2; duplicate/disabled recipient; rollback cả gói khi audit insert lỗi |
| Schema/HEAD/expiry | PASS | JSON title/expiry sai kiểu, forged actor/status, CSRF, disabled session; Missing/timeout/wrong identity/size/delete marker; expiry đúng deadline |
| Migration từ DB trống | PASS | V1 chạy từ Empty Schema; không sửa migration hoặc thêm V2 |
| AWS S3/Lambda, IAM/CORS/HTTPS, browser UI, G3 chung | NOT RUN | Chưa có adapter và môi trường/nhánh tích hợp được nhóm xác nhận |

Verify kết thúc lúc 00:22:45 UTC+07 ngày 29/10/2026. Các fixture trực tiếp tạo metadata/version để thử nghiệp vụ; fixture S3 HEAD/URL/checksum chỉ nằm ở test source. Không gọi đó là upload byte, Lambda hay download S3 thật. HandoverService chạy cùng StoragePort với UploadService; ứng dụng mặc định thiếu adapter trả 503 ở thao tác storage.

`junit-summary.txt` chỉ trích tên ca và count từ XML cuối. `migration-and-run.txt` chỉ giữ dòng migration/startup/tổng/thời điểm an toàn. Raw Surefire properties/environment/log nằm trong target, không đưa vào evidence. `source-hashes.json` lưu hash source/test/config/tools/contracts hiện tại, không hash báo cáo/evidence tự tham chiếu. Những tệp evidence tuần 2 là snapshot cũ, không đại diện code tuần 3.

Chạy lại: cấu hình DB_URL/DB_USERNAME/DB_PASSWORD tới **DB thử riêng có thể xóa dữ liệu**, bật RUN_DB_TESTS=true rồi chạy Maven verify. Tests TRUNCATE bảng nghiệp vụ trước từng ca. [Hướng dẫn cho Dũng](../../../docs/week-03/huong-dan-cho-dung.md) có lệnh cho riêng HandoverIntegrationTest. Không đưa secret, cookie hoặc signed URL vào báo cáo.

Không chạy lại bộ JAR 48+70 checks của tuần 2 trong lần này; không nhận kết quả lịch sử đó làm bằng chứng JAR tuần 3. Có HTTP TCP thật qua SpringBootTest/Tomcat và schema assertion trong bộ mới. Revoke không vô hiệu hóa tức thời URL đã cấp; không chứng minh hard quota byte S3, xóa object, downtime DB thật hoặc phê duyệt nhóm.
