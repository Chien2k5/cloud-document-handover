# Tuần 2 giai đoạn 1 Sửa audit và chốt thiết kế upload

Người phụ trách: Nguyễn Huy Dũng. Ngày 22/10/2026. Branch `dung`, nền `ef79ee3`. Tài liệu này thay thế các phần thiết kế upload còn mở trong `docs/week-01/upload-handover-rules.md` khi chuẩn bị viết service tuần 2. Chưa có xác nhận Nam/Đăng/Chiến đã duyệt. Không có UploadService, S3 adapter hoặc nghiệp vụ bàn giao được viết trong giai đoạn này.

## Phạm vi đã triển khai

- Project yêu cầu JSON string cho name/description; không ép số/boolean thành chuỗi. name bắt buộc, không null/blank; description được bỏ qua và mặc định `""`, nhưng explicit null bị 400 theo OpenAPI. Chỉ giới hạn deserialization ở DTO này, không đổi form login/query parameter thành JSON.
- Content-Type không hỗ trợ ở JSON API trả 415 `UNSUPPORTED_MEDIA_TYPE`; Accept không hỗ trợ trả 406 `NOT_ACCEPTABLE`. Error envelope giữ code/message/requestId.
- `ActiveAccountFilter` kiểm `enabled` từ DB cho session đã xác thực trên request được bảo vệ, trước CSRF/handler. Disabled hoặc user đã bị xóa → 401 `ACCOUNT_DISABLED`, hủy session và xóa cookie. Các session khác cũng bị chặn ở request được bảo vệ tiếp theo, không cần session registry hay admin UI. Bật lại user không khôi phục session đã hủy; phải login mới.
- DB lỗi khi kiểm account → 503 `AUTH_UNAVAILABLE`, không chạy handler, không suy đoán user còn quyền; giữ session để retry lỗi hạ tầng. Filter bỏ qua `/health`, `/auth/csrf`, `/auth/login`, `/auth/logout`; login tự kiểm enabled qua authentication provider, logout vẫn cần CSRF hợp lệ. Session hết hạn: GET được bảo vệ trả 401; POST dùng token cũ có thể trả 403, lấy CSRF mới để logout. Health vẫn kiểm DB readiness độc lập. Request đã chạy qua bước kiểm tra trước lúc disable không bị hủy hồi tố.

## Phương án và trade-off đã trình bày trước khi thay hợp đồng

| Lựa chọn | Phương án dùng ở phase 1 | Trade-off |
| --- | --- | --- |
| Endpoint riêng tạo version hay fileId tùy chọn | Thêm optional fileId vào init-upload hiện tại | Giữ URL và request cũ hợp lệ, không tăng endpoint; server phải kiểm fileId thuộc đúng project |
| Filename làm định danh hay ID | UUID fileId là định danh duy nhất; filename chỉ metadata | Cho phép hai tài liệu trùng tên; frontend phải giữ ID, không tự merge theo tên |
| Giữ cùng key cho mọi version hay key riêng mỗi upload | `uploads/{projectId}/{uploadId}` riêng từng session | Dễ cách ly/giữ bất biến, tiếp tục dùng S3 Version ID chính xác; các version cùng tài liệu có thể khác object key |
| Thêm session status/operation/idempotency table | Chưa thêm schema | Dùng FileVersion.upload_status để quyết định reserve/release một lần dưới khóa; init chưa idempotent. Cần V2 nếu thiết kế sau này thực sự cần thêm trạng thái hoặc field |
| Chặn PUT lặp vật lý hay chỉ pin một version ở complete | Backend pin một version; đề xuất conditional PUT write-once chờ Đăng/Chiến | Pin version giữ đúng nghiệp vụ nhưng không tự chặn storage version thừa. Không tuyên bố quota vật lý S3 đã được bảo đảm |
| Trigger bất biến ngay hay service kiểm soát ghi | Ghi rõ invariant/điểm kiểm tra để viết service sau; chưa thêm trigger | Không thay schema đã áp dụng khi chưa có writer upload; trước ghép service phải có test bất biến. Nếu cần trigger thì tạo V2, không sửa V1 |

Không có thay đổi lớn ở database/API runtime trong phase 1. Optional fileId là bổ sung cho endpoint **chưa triển khai**. Những request sai kiểu/null trước đây được chấp nhận nay trả 400; đây là thay đổi hành vi có chủ ý để khớp schema hiện hành, cần Nam bỏ dựa vào coercion cũ.

## Quyết định nội bộ backend

Các mục dưới đây được chốt làm thiết kế nội bộ để Dũng triển khai sau. Chúng không phải bằng chứng các thành viên khác đã duyệt hoặc service đã chạy.

### Tài liệu và phiên bản

`POST /api/v1/projects/{id}/files/uploads` giữ bốn field bắt buộc filename/contentType/size/expectedSha256. Bổ sung fileId tùy chọn, kiểu UUID, không nullable:

- Không gửi fileId: tạo FileMetadata mới; cùng filename không nhập chung với tài liệu cũ.
- Có fileId: chỉ tạo UploadSession/FileVersion mới cho FileMetadata thuộc project trong URL. Caller phải còn Owner/Editor trong project đó. File khác project/không thấy trả 404 `FILE_NOT_FOUND`, không tiết lộ metadata.
- Không thêm rename vào MVP này: filename của version mới phải bằng filename hiện tại của FileMetadata, khác trả 409 `FILENAME_MISMATCH`. Kiểm ID trước; so tên chỉ để phát hiện request không nhất quán, không dùng tên để tìm file. Không sửa tên/identity v1 khi upload v2.
- Mỗi version có UUID riêng, key riêng, S3 Version ID riêng. fileId nhóm các version; không suy phiên bản mới nhất bằng filename, ETag hoặc Version ID thứ tự từ điển. Danh sách trả một item mỗi version, sort created_at rồi id; UI nhóm theo fileId.

Ví dụ: `contracts/examples/upload-init.request.json` tạo tài liệu mới; `upload-new-version.request.json` thêm version. Cả hai dùng cùng endpoint và response shape. Chưa có controller nhận hai request này; hiện route vẫn 404.

### UploadSession và quota logic

Quota mặc định project đang dùng cấu hình 1 GiB. 100 MiB/file và URL 300 giây là đề xuất tích hợp, chưa có số đo hoặc duyệt nhóm. Schema giữ con số đề xuất và đánh dấu review; chưa có service thực thi upload size/TTL.

1. Transaction khóa `projects` bằng `SELECT FOR UPDATE`, sau đó session/version nếu có. Thứ tự khóa này phải giống nhau ở init/complete/expire; không khóa ngược.
2. Kiểm quyền hiện tại và `size <= quota - used - reserved` bằng BIGINT. Reserve size, tạo metadata/version/session trong cùng transaction. Không tăng used khi mới cấp URL.
3. Init không có idempotency key trong MVP này: mỗi POST là session mới, kể cả sau timeout. Nam không retry vô hạn; nếu phản hồi init bị mất, reservation cũ giữ đến expiry. Retry có thể tạo tài liệu/session nữa và phải tính đủ quota; không dùng filename để gộp request.
4. Dùng FileVersion.upload_status làm điều kiện chuyển trạng thái một lần. PENDING → AVAILABLE: trừ session.reserved_bytes khỏi reserved, cộng cùng lượng vào used, ghi completed_at. PENDING → FAILED/EXPIRED: trừ reserved đúng một lần, không tăng used. Mọi chuyển trạng thái/counter cùng transaction và kiểm row count/expected state; không trừ lại trên retry.
5. AVAILABLE/FAILED/EXPIRED không quay về PENDING. Muốn upload lại tạo session và key mới. Integrity FAILED là trạng thái kiểm tra riêng, không tự giải phóng used vì object/version vẫn được giữ.
6. Quota tính mọi **version đã hoàn tất được giữ và mọi reservation còn hiệu lực**. Gói chỉ tham chiếu version nên không tính thêm bản copy. Quota logic PostgreSQL không tự bảo đảm giới hạn byte lưu thực tế trên S3 trong lúc upload hoặc khi có object bị bỏ dở.

Không có job hoặc service reservation được triển khai ở phase 1. Cần hiện thực minimal expiry reconciliation trước khi cho upload thật; không được chỉ viết tài liệu rồi coi quota đã chạy. API init phải xử lý hết hạn hoặc có tác vụ expire tối thiểu để reservation mồ côi không giữ quota mãi.

### PUT lặp và quota lưu trữ thực tế

URL PUT có thể dùng nhiều lần trước hạn. Backend chỉ chấp nhận **một version cho một session**, nhưng pin tại complete không ngăn một URL tạo nhiều S3 version hoặc payload lớn trước HEAD. Vì vậy chưa được gọi quota S3 là hard limit.

Ứng viên đơn giản cần review: mỗi key upload chỉ được tạo một lần bằng signed header `If-None-Match: *`; browser gửi mọi header backend trả, Đăng ký header, Chiến kiểm IAM/bucket policy/CORS. Xem candidate JSON ở `contracts/review/presigned-put-write-once.candidate.json`; không dùng nó như cấu hình đã duyệt. Với versioning, điều kiện kiểm current version và có ngoại lệ delete marker; cần chặn đường xóa/tái dùng key trong khi URL còn hạn theo quyền Lab thực tế.

Đăng cần POC lỗi 412 khi PUT lặp. Đề xuất MVP khi PUT có thể đã thành công nhưng mất response/Version ID: không complete bằng latest; ngừng dùng URL cũ, để reservation cũ hết hạn, yêu cầu upload mới với key mới khi quota cho phép. Nhược điểm: mất công upload lại và quota có thể bị giữ tới expiry; Nam cần xác nhận UX. Không tự release reservation chỉ vì browser báo timeout/412. Chưa thêm recovery endpoint hoặc thay complete body. Nếu conditional PUT không khả thi, phải review cách quản lý version thừa/chi phí trước bật AWS upload. Chi tiết quota, lỗi và tiêu chí AWS ở [hợp đồng adapter đề xuất](../../contracts/s3-adapter-contract.md).

Đăng/Chiến cũng phải xác minh cách giới hạn size trong request S3 và dọn exact version của upload bị từ chối/đến trễ. HEAD sau upload chỉ bảo vệ việc ghi nhận AVAILABLE, không ngăn byte đã được ghi. Cleanup không xóa version đã được complete/pin; không lấy rule lifecycle xóa noncurrent tùy tiện làm cách xử lý gói bàn giao.

Nguồn kỹ thuật: [AWS presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html). Đây là cơ sở đề xuất; AWS Lab chưa được thử trong task này.

### Complete lặp và hết hạn

Body vẫn chỉ có versionId từ header S3; versionId là chuỗi opaque, không null/rỗng/toàn khoảng trắng/literal `"null"`. Không trim/normalize hoặc thay bằng latest. Bucket/key/size/type/hash kỳ vọng lấy từ DB, không tin client.

| Trạng thái và tình huống | Kết quả thiết kế | Quota và dữ liệu |
| --- | --- | --- |
| Caller không phải người khởi tạo hoặc mất Owner/Editor | 403; project/file không thấy dùng 404 | Không đổi trạng thái/quota |
| AVAILABLE, cùng versionId | 200 trạng thái đã lưu, kể cả sau expires_at | Không HEAD lại, không reset integrity, không chuyển quota lần nữa; không có nghĩa URL download sẽ được cấp |
| AVAILABLE, versionId khác | 409 UPLOAD_ALREADY_COMPLETED | Không đổi |
| PENDING nhưng hết hạn | Chuyển EXPIRED; 409 UPLOAD_EXPIRED | Release đúng một lần dưới khóa; không hoàn tất muộn |
| PENDING, HEAD không thấy exact object/version | 409 OBJECT_NOT_READY | Giữ PENDING/reservation tới expiry để caller thử lại có giới hạn |
| PENDING, storage timeout/thiếu quyền/lỗi hạ tầng | 503 STORAGE_UNAVAILABLE | Không ghi AVAILABLE giả hoặc release do timeout chưa rõ kết quả |
| PENDING, HEAD size/type không khớp | Chuyển FAILED; 409 UPLOAD_OBJECT_INVALID | Release một lần; ghi nhận object cần cleanup theo quy tắc được review |
| PENDING, HEAD đúng và trước hạn | AVAILABLE + INTEGRITY_PENDING, 200 | Move reserved → used đúng một lần, pin S3 Version ID, ghi completed_at |
| FAILED | 409 UPLOAD_FAILED | Không hồi sinh session, tạo upload mới |
| EXPIRED | 409 UPLOAD_EXPIRED | Không release lần hai |

Cần check schema/quyền trước; khi đã AVAILABLE xử lý idempotence trước check expiry. GET state/download vẫn kiểm quyền hiện tại. Completed file không trở thành EXPIRED chỉ vì URL PUT hết hạn.

Không giữ transaction PostgreSQL qua network HEAD kéo dài. Đọc snapshot và HEAD exact identity; sau đó transaction khóa project → session/version, kiểm lại quyền, expected state, expiry và identity trước update. Nếu complete khác/job expire đã thắng, trả kết quả hiện tại theo bảng. `now` quyết định expiry là thời điểm kiểm lại trong transaction; không lấy timestamp client. Cần test race thật ở service tuần 2, chưa có ở phase 1.

### Identity bất biến và SHA-256

- expectedSha256 cố định từ init. Server sinh key riêng; client không chọn key/bucket/actualSha256/integrityStatus.
- Khi AVAILABLE, không sửa file_id/project_id/bucket/object_key/s3_version_id/size/contentType/expectedSha256 để tạo v2. Dữ liệu mới là row/version khác. HandoverItem chỉ tham chiếu row v1 và tải đúng key+version v1; không tìm latest.
- Chưa có API ghi version trong phase 1. V1/FK **không tự đóng băng row**; writer service sắp viết phải dùng update có expected state và không cung cấp đường sửa identity đã complete. Trước publish cần regression test giữ v1 khi có v2. Nếu nhóm muốn DB trigger bổ sung thì tạo Flyway V2, không sửa V1 đã dùng.
- Lambda result schema v1 giữ nguyên bucket/objectKey/versionId/size/status/actualSha256/errorCode/processedAt. Match **đúng cả bucket + objectKey + Version ID + size** trước khi so actual với expected lưu DB. Result key đề xuất ba SHA-256 vẫn cần Đăng xác nhận; không nhận JSON/hash thực tế do browser cung cấp.
- Chỉ reconcile khi upload AVAILABLE. Event/JSON đến trước complete không làm version PENDING thành VERIFIED. `SUCCEEDED` của Lambda nghĩa là tính hash xong, không tự có nghĩa backend VERIFIED.

| Integrity hiện tại | Kết quả đọc đúng identity | Chuyển trạng thái thiết kế |
| --- | --- | --- |
| INTEGRITY_PENDING | Chưa có JSON | Giữ pending |
| INTEGRITY_PENDING/FAILED | JSON SUCCEEDED đúng schema/identity/size, hash khớp | VERIFIED |
| INTEGRITY_PENDING/FAILED | JSON SUCCEEDED đúng identity/size, hash khác | MISMATCH |
| INTEGRITY_PENDING/FAILED | JSON lỗi schema/sai identity hoặc Lambda FAILED | FAILED, không VERIFIED |
| INTEGRITY_PENDING/FAILED | Timeout/thiếu quyền S3 | 503; giữ trạng thái trước, không dùng lỗi mạng làm bằng chứng hash sai |
| VERIFIED/MISMATCH | Poll/event/JSON lặp hoặc đến trễ | Trả terminal state đã lưu, không hạ cấp hay đổi hash/identity |

FAILED có thể được đọc lại khi GET state sau đó; không cần recovery endpoint nâng cao trong phase này. Cập nhật bằng compare-and-set trên id + immutable identity + trạng thái cho phép, để poll lỗi đến chậm không ghi đè VERIFIED. Viewer chỉ GET trạng thái theo quyền đọc, không được khởi tạo/complete upload. Backend quyết định mọi trạng thái; UI chỉ hiển thị/poll có giới hạn theo review của Nam.

### Phát hành gói và phạm vi tuần 3

Không viết service bàn giao trong task này. DRAFT chỉ chọn AVAILABLE có Version ID cố định; có thể còn pending integrity. READY yêu cầu từng item AVAILABLE + VERIFIED và HEAD exact version còn truy xuất được. Manifest/recipient không sửa sau READY. Confirmation.status là trạng thái xác nhận của **người nhận hiện tại**, còn Handover.status là tổng thể gói, chỉ CONFIRMED khi mọi người nhận ACTIVE xác nhận. Chính sách nhiều người nhận/hiển thị vẫn cần Nam review.

## Quyết định cần xác nhận bên ngoài

| Quyết định | Backend đã có gì | Cần ai xác nhận trước upload thật |
| --- | --- | --- |
| Optional fileId và no-rename | Thiết kế backend, OAS và JSON examples | Nam review luồng chọn ID/nhóm version; Đăng hiểu key riêng từng session |
| Adapter | Bảng thao tác presignPut/headVersion/readChecksum/presignGet; chưa viết interface giả định thay Đăng | Đăng chốt Java signatures/result/error mapping, nhất là NotReady, 412, exact version và timeout |
| Write-once và PUT mất response | Candidate signed If-None-Match; backend chỉ nhận một completed version | Đăng POC/presign, Chiến IAM/policy/CORS/không tái dùng key, Nam UX recovery |
| Size/quota/TTL/retention/cleanup | Quy tắc quota logic và giá trị đề xuất | Chiến/Đăng xác nhận giới hạn/chi phí/cleanup, Nam thông báo quota |
| JSON checksum và result key | Schema đã có, backend match exact identity và terminal-state policy | Đăng xác nhận/POC event decoded key + Version ID và schema; không tự nhận đã đồng thuận |
| Session/CSRF và origin | Backend sửa disable/session; local có test | Nam/Chiến xác nhận proxy cùng origin và HTTPS; CORS khác origin chưa được thêm |

## Schema và tính tương thích

- Không sửa V1 và không thêm migration vì phase 1 chỉ sửa auth/validation và thiết kế; các bảng hiện có lưu được fileId/phiên bản, session, reservation, trạng thái và identity.
- URL, form login, shape Project/Member và error envelope giữ nguyên. Description bị bỏ qua vẫn hợp lệ và trả chuỗi rỗng như trước; explicit null/type coercion trước kia được nhận nay 400. Unsupported Content-Type nay 415 thay 500; disabled session nay 401 thay được đi tiếp. Client phải xử lý ACCOUNT_DISABLED và login lại.
- Upload vẫn contract-only. Optional fileId giữ request mới-tài-liệu cũ hợp lệ; cấm literal null versionId làm schema đúng mô tả cũ. Chưa có claim nhóm duyệt, chưa đổi backend sang công nghệ khác.
- Bất kỳ quyết định sau review nào cần thay field/schema lớn, database hoặc endpoint phải được trình bày trade-off rồi cập nhật OpenAPI + migration V2 trở đi khi cần. Không âm thầm biến candidate thành quyết định nhóm.

## Trước khi viết UploadService

1. Nhận review optional fileId/no-rename và retry UX từ Nam; ghi nhận phiên bản contract được dùng.
2. Dũng/Đăng chốt adapter/result schema/key/errors, phương án 412/mất PUT response và thử conditional write/size thật cùng Chiến. Không giả lập PASS AWS.
3. Xác nhận values và minimal cleanup/expire policy để quota logic/chi phí không bị hiểu sai.
4. Có thể bắt đầu domain/state/quota và test PostgreSQL với fake adapter theo [kế hoạch phase 2](phase-02-plan.md). Chữ ký tích hợp, luồng UI và bật upload AWS phải qua các gate review tương ứng. Các test Phase 2 chưa được chạy trong Phase 1.
