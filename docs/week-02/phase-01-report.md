# Báo cáo tuần 2 giai đoạn 1

Nguyễn Huy Dũng, ngày 22/10/2026, branch `dung`. Thay đổi nằm ở working tree trên nền `ef79ee3`; **chưa commit, chưa push** theo yêu cầu. Không sửa frontend, Lambda/S3 adapter hoặc cấu hình AWS của thành viên khác. Các file `docs/tv3/` có sẵn được giữ nguyên.

**Snapshot ban đầu:** Kết quả 14 JUnit / 41 + 43 HTTP dưới đây thuộc lần hoàn tất Phase 1 trước kiểm tra cuối. Filter đã được bổ sung ngoại lệ public/logout; xem [kiểm tra cuối](phase-01-final-review.md) và `evidence/week-02/phase-01-final/` cho trạng thái hiện tại. Hash trong evidence cũ không đại diện code sau finalization.

## Lỗi đã sửa

| Audit finding | Thay đổi | Bằng chứng |
| --- | --- | --- |
| Project ép JSON number/boolean thành string | StrictStringDeserializer chỉ dùng ở DTO tạo Project; sai kiểu, array/object và explicit null bị 400 | JUnit projectJsonStringsAndNullsMatchContract; HTTP phase 1 kiểm số/float/bool/null/array/object cho cả name/description |
| Null không nhất quán | name bắt buộc; description bỏ qua có mặc định chuỗi rỗng, explicit null bị từ chối theo schema | Test invalid không tạo row; hai request hợp lệ tạo thành công, description được trim như cũ |
| Content-Type sai thành 500 | Handler 415 UNSUPPORTED_MEDIA_TYPE; thêm 406 NOT_ACCEPTABLE và JSON error response rõ ràng | JUnit + HTTP text/plain/form-urlencoded trả 415; Accept text/plain trả 406; không thêm row do các lỗi media type |
| Session cũ dùng tiếp sau disable | ActiveAccountFilter kiểm enabled từ DB ở mỗi request; hủy session/cookie và 401 ACCOUNT_DISABLED; lỗi DB fail closed 503 AUTH_UNAVAILABLE | Hai session của cùng user bị chặn đọc/ghi sau UPDATE fixture enabled=false; bật lại user không khôi phục cookie cũ, login mới dùng được |
| Hợp đồng version upload chưa đủ | Optional fileId trên init hiện tại; không dùng filename tìm file; no-rename; key riêng/session; state/quota/idempotence chi tiết | OpenAPI parser/schema/example tests; đây là thiết kế, không phải test UploadService |

Account filter được đặt sau security header writer và trước CSRF/handler: phản hồi lỗi vẫn có header bảo vệ chuẩn. Kiểm tra cuối bổ sung bỏ qua health/CSRF/login/logout; protected request vẫn kiểm enabled theo PK. Đây là trade-off đơn giản cho MVP single instance, không thêm session registry hoặc admin UI. Request đã chạy qua bước kiểm tra trước lúc disable không bị hủy hồi tố.

## Kết quả chạy thật

| Kiểm tra | Kết quả | Phạm vi |
| --- | --- | --- |
| Maven build/package | PASS | Java 25 compile target 21, Maven Wrapper 3.9.12 |
| JUnit | 14/14 PASS; 0 failure, 0 error, 0 skipped | 2 unit tests filter, 8 integration tests PostgreSQL, 4 contract tests |
| OpenAPI và JSON | PASS | Parser không lỗi/ref hỏng; schema/ví dụ mới; phản ví dụ type/null/literal-null Version ID |
| HTTP baseline | 41/41 request checks PASS | Script tuần 1 giữ nguyên; auth/quyền/CSRF/logout và route upload chưa code |
| HTTP phase 1 | 43/43 request checks PASS | Strict JSON, 415/406, disable hai session đọc/ghi, fresh login khi disabled, cookie cũ không hồi sinh sau re-enable |
| Migration từ DB sạch | PASS | JAR chạy Flyway V1 từ Empty Schema trên DB fixture mới; V1 không bị sửa |
| Upload/version/quota/complete/Lambda thật | NOT RUN / CHƯA TRIỂN KHAI | Chỉ hợp đồng và schema ở phase này, không lấy test hợp đồng làm test S3 |
| Conditional PUT, giới hạn byte S3, IAM/CORS/HTTPS AWS | NOT RUN | Chờ review/POC của Đăng/Chiến/Nam |

Tổng HTTP là 84 request checks từ hai script riêng, không phải 84 kịch bản độc lập. Bằng chứng có tên test và output status an toàn ở `evidence/week-02/phase-01/`. Các unit test mô phỏng lỗi repository chỉ chứng minh filter fail closed; không ghi là đã dừng DB thật để thử outage.

## Quyết định nội bộ backend đã chốt

1. Giữ endpoint init, thêm optional fileId: omit tạo tài liệu mới; có ID tạo row FileVersion/UploadSession mới cho tài liệu cùng project. Tên không phải định danh. Không thêm rename trong phase này.
2. Key server sinh riêng theo projectId/uploadId, không tái dùng; expected hash cố định từ init; version đã AVAILABLE không sửa identity để biến thành v2. Handover luôn tham chiếu version cố định. Chưa có writer/service upload; phải kiểm chứng bất biến khi hiện thực service, không tuyên bố FK tự khóa identity.
3. Reserve/move/release quota một lần theo trạng thái FileVersion, transaction khóa project → session/version; quota tính version được giữ và reservation đang hiệu lực. Init không idempotent; retry không được gộp theo filename và có thể tạo session/reservation mới.
4. Complete đã AVAILABLE cùng version trả trạng thái đã lưu kể cả sau deadline; không reset integrity hoặc cộng quota lại. Version khác 409. PENDING hết hạn chuyển EXPIRED/release một lần và 409; HEAD network error không thành AVAILABLE.
5. AVAILABLE độc lập với VERIFIED. Reconcile chỉ chạy cho AVAILABLE, match exact bucket/key/version/size; missing JSON giữ pending, JSON lỗi không VERIFIED; FAILED được đọc lại có kiểm soát, VERIFIED/MISMATCH terminal không bị poll lỗi ghi đè.
6. Không thay database trong phase 1: V1 đã đủ field cho thiết kế trên. Không sửa V1, chưa cần V2. Nếu review dẫn tới schema/trigger mới, tạo migration mới và trình bày trade-off trước khi làm.

Các quyết định này là thiết kế nội bộ backend, không phải xác nhận Nam/Đăng/Chiến đã duyệt.

## Những việc vẫn cần nhóm review

- Nam: optional fileId/no-rename, grouping version, init timeout/retry, trạng thái UI, session/CSRF và origin.
- Đăng: chữ ký adapter presignPut/headVersion/readChecksum/presignGet, lỗi NotReady/timeout/412, JSON và result-key; cách xử lý PUT thành công nhưng mất response/Version ID.
- Đăng/Chiến: POC signed If-None-Match để write-once, quyền không xóa/tái dùng key khi URL còn hạn, IAM/policy/CORS; size/TTL/cleanup/cost. Candidate nằm riêng trong contracts/review và chưa được áp dụng vào adapter hoặc AWS.
- Giá trị 1 GiB/project, 100 MiB/file, URL 300 giây chưa có bằng chứng nhóm chốt/đo thực tế. PostgreSQL quota logic và HEAD sau upload không chứng minh hard quota vật lý S3.

## Tương thích và file thay đổi

URL runtime, form login, response Project/Member và error envelope giữ nguyên. Input Project trước đây được nhận sai schema (số/null) nay trả 400; Content-Type sai nay 415, disabled session nay 401. Client cần xử lý các thay đổi này. Upload chỉ thêm field tùy chọn vào hợp đồng, chưa triển khai endpoint nên không giả lập thành công.

Danh sách cụ thể trong `docs/week-02/phase-01-files.md`. Nhóm file: auth filter/security, DTO/deserializer/handler/service, JUnit/HTTP regressions, OpenAPI/examples/candidate, README/tài liệu phase 1 và evidence. Không thay dependency hoặc migration.

## Trước khi viết UploadService

Hoàn thành review fileId/no-rename và retry UX; thống nhất adapter/errors/checksum với Đăng; xác nhận conditional PUT hoặc phương án quản lý byte/version thừa và cleanup với Chiến; ghi lại giới hạn được chọn. Sau đó mới viết request → complete → list/download → integrity, kèm test concurrent quota/complete/expire, version/hash sai và event lặp/trễ. Không cần viết nghiệp vụ bàn giao tuần 3 hoặc restore tuần 4 để hoàn thành phase 1 này.
