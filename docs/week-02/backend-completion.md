# Kết quả backend tuần 2 của Dũng

Ngày 28/10/2026, nhánh `dung`. GitHub trước cập nhật ở `ef79ee3` (tuần 1). Lần cập nhật này gồm các sửa Phase 1 đang có trên máy và phần UploadService mới; không sửa phần AWS, S3 adapter, Lambda hoặc frontend của thành viên khác.

## Kết luận tiến độ

Đã triển khai phần backend độc lập để ghép tuần 2: auth/quyền, UploadSession/FileVersion, quota, init/complete/state/list/download và đối soát checksum qua StoragePort. PostgreSQL, Spring Security và HTTP chạy thật; storage/JSON trong kiểm thử là fixture ở test source.

**Chưa đủ bằng chứng nghiệm thu toàn bộ tuần 2/G2 với AWS.** Theo trao đổi với Dũng, nhóm vẫn phát triển riêng, chưa xác nhận adapter và môi trường chung. Nhánh này không có AWS SDK adapter hoặc Lambda. Không tự ghi các thành viên đã review.

| Tiêu chí theo process2.pdf | Kết quả phần Dũng | Phần còn cần ghép |
| --- | --- | --- |
| C02: Auth, Project, Membership, quyền dự án | Đã triển khai, kiểm thử PostgreSQL/HTTP | Nam ghép UI; Chiến triển khai môi trường chung |
| C03: FileVersion, complete, AVAILABLE/INTEGRITY_PENDING | Đã triển khai nghiệp vụ và kiểm thử qua StoragePort | Đăng cung cấp adapter và thử PUT/HEAD/GET S3 thật |
| G2: upload/download S3 thật, lưu đúng Object Key/Version ID | Chưa nghiệm thu | Đăng + Dũng + Nam thử trên cấu hình của Chiến |
| Checksum Lambda ở tuần 3 theo PDF | Backend đã có phần đối soát JSON hỗ trợ download | Lambda/event/result-key và parity với Đăng chưa kiểm chứng |
| Bàn giao tuần 3 | Giữ contract-only | Sẽ triển khai sau khi luồng upload được ghép |

Kế hoạch Word đẩy cả checksum thật vào tuần 2, còn PDF đặt checksum và bàn giao ở tuần 3; mã C04/C05 và tổng giờ cũng khác. Cần nhóm chọn bản lịch thống nhất. Báo cáo này không đổi kế hoạch nhóm hoặc tự xác nhận G2 đạt.

## Nghiệp vụ đã triển khai

- Init chỉ cho Owner/Editor hiện tại, bucket/key do server quản lý. Omit fileId tạo tài liệu mới; fileId hiện có tạo version mới trong cùng project, không rename. Kiểu JSON sai/null/field lạ bị từ chối.
- Khóa project rồi kiểm lại quyền, quota và state trong transaction. Size tối đa 100 MiB, quota dùng cấu hình project. Init không idempotent; retry có thể tạo reservation khác.
- Ký PUT sau commit, không giữ khóa qua storage. Signer lỗi hoặc thiếu Content-Type/If-None-Match: * thì FAILED và giải phóng reservation. URL phải HTTPS, còn hạn và không vượt deadline session. Không có adapter thật thì 503, không URL giả.
- Complete chỉ cho người khởi tạo còn quyền ghi. HEAD đúng bucket/key/versionId ngoài transaction rồi khóa và kiểm lại quyền/deadline. Missing giữ PENDING, lỗi storage trả 503, size/type sai chuyển FAILED và giải phóng quota. HEAD trả sai identity bị 503, không pin object nhầm.
- AVAILABLE cùng Version ID trả trạng thái đã lưu, kể cả sau deadline, không HEAD/cộng quota/reset integrity. Version khác trả 409. Expiry chuyển EXPIRED và giải phóng đúng một lần; deadline lưu theo microsecond của PostgreSQL.
- Scheduler xử lý tối đa 20 project, mỗi project 100 session/lượt; init cũng thu hồi session hết hạn trong project. Không có distributed job hoặc migration mới; Flyway V1 giữ nguyên.
- AVAILABLE độc lập VERIFIED. Đọc JSON tối đa 64 KiB, kiểm đầy đủ field/type/identity/size/time/hash, từ chối JSON lặp key hoặc dư nội dung. Missing không VERIFIED; malformed/sai version/Lambda FAILED thành integrity FAILED; FAILED có thể đọc lại, VERIFIED/MISMATCH là terminal.
- List theo project, một item mỗi version, sort created_at/id và phân trang. Download chỉ cho AVAILABLE + VERIFIED, kiểm exact HEAD và quyền hiện tại trước trả URL GET đúng version. Không có thao tác đánh dấu VERIFIED từ browser.

## Kiểm chứng và giới hạn

Kết quả/lệnh và tên ca nằm ở [evidence hiện tại](../../evidence/week-02/backend/README.md). Có test quota đồng thời, complete đồng thời, expiry trong lúc HEAD, rollback và polling sai/trễ không ghi đè VERIFIED. HTTP TCP/Tomcat với cookie/CSRF kiểm luồng init → complete → integrity → download và schema phản hồi OpenAPI. JAR riêng kiểm ứng dụng không có adapter trả lỗi và bù quota.

Không dùng kết quả fake để tuyên bố S3/Lambda PASS. Chưa kiểm browser CORS, chữ ký AWS, IAM, HTTPS AWS, conditional PUT thực, cleanup object mồ côi hoặc hard quota byte S3. Quota database chỉ bảo vệ used/reserved logic; giải phóng reservation không xóa byte trên S3. Điều kiện bucket-policy/CORS/cleanup cần Chiến và Đăng chốt trước bật upload thật.

## Bàn giao cho nhóm

- Đăng: triển khai bean StoragePort theo [port và kết quả lỗi](../../contracts/s3-adapter-contract.md), xác nhận timeout, result-key/schema và signed headers.
- Chiến: xác nhận bucket Versioning, IAM/CORS/event filter, endpoint/DB thử, policy, cleanup và chi phí.
- Nam: review OpenAPI 0.3.0-week2-backend, ghép SHA-256/PUT/Version ID/complete/polling, xử lý retry không idempotent.

[Nội dung câu hỏi để Dũng gửi](team-integration-questions.md) có thể dùng ngay. Công cụ chưa gửi tin cho thành viên nào. Các báo cáo/evidence ngày 22/10 được giữ như lịch sử Phase 1; hash lịch sử không đại diện code sau lần triển khai này.
