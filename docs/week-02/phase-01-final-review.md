# Kiểm tra cuối tuần 2 Phase 1

Nguyễn Huy Dũng, 22/10/2026. Branch `dung`, HEAD `ef79ee3e0019e63b030fd5c405e2ac15ef5252b9`. **Phase 1 hoàn tất trong phạm vi backend, validation/auth và thiết kế.** Có thể bắt đầu Phase 2 nội bộ với fake S3 adapter; còn gate review/tích hợp AWS, không phải blocker của phần DB/domain. Chưa commit/push, chưa viết nghiệp vụ Phase 2, chưa viết bàn giao tuần 3.

## Rà soát Git và con số 31 / 19

Đã đọc `git status --short`, `git status --porcelain=v1 --untracked-files=all`, `git diff` cho thay đổi tracked và nội dung file mới. `git diff` thông thường không chứa untracked; `git status` mặc định có thể gom cả thư mục thành một dòng.

Bộ Phase 1 trước kiểm tra cuối có **31 file ứng viên = 12 file tracked sửa + 19 file mới**. Sáu file `docs/tv3/` đã có từ trước, không thuộc bộ này và không được chỉnh sửa/đưa vào đề xuất commit. Số 19 khớp số file mới, nhưng chưa có bằng chứng xác định cơ chế đếm cụ thể của giao diện đang xem; không kết luận UI chỉ hiển thị file mới. Ngoài ra nhiều evidence/file được sinh bằng script nên số tệp trong phần hiển thị thao tác patch có thể khác Git. Danh sách Git đầy đủ là căn cứ, không dùng số dòng UI thay số path.

Sau kiểm tra cuối có **41 file ứng viên: 12 sửa + 29 mới**, thêm 10 file tài liệu/evidence. Filter/test/script và OpenAPI đã có trong 31 file cũ được sửa tiếp, không tính là file mới lần nữa. Tổng working tree còn thêm 6 file docs/tv3 độc lập, tức 47 path khi mở rộng untracked. Danh sách từng file và nhóm commit: [phase-01-files.md](phase-01-files.md). Không stage file nào.

## Kết quả kiểm tra code và OpenAPI

| Nội dung | Kết luận / bằng chứng |
| --- | --- |
| StrictStringDeserializer | Chỉ được annotate ở CreateProject.name và description; không đăng ký SimpleModule/Jackson global customizer. Test global String vẫn coercion như cũ, DTO SetMember và form login giữ hành vi; CreateProject number bị từ chối |
| Validation Project | name string bắt buộc, NotBlank/max150; description omit thành rỗng, explicit null bị 400, string/max2000; unknown fields bị từ chối. DTO + schema thống nhất phạm vi này; service trim chuỗi sau validation như trước |
| Content-Type | JSON Project sai Content-Type trả 415, không 500; Accept không hỗ trợ trả 406 JSON. Không phát sinh row từ các request bị từ chối |
| Account filter | Phát hiện filter cũ chặn public CSRF/login/logout khi có principal disabled. Đã giới hạn account lookup cho protected request; bỏ qua health/CSRF/login/logout, login provider vẫn kiểm enabled, logout vẫn bắt CSRF |
| Disabled / DB lỗi | Protected read/write vẫn 401 ACCOUNT_DISABLED và invalidate session; lookup DB lỗi unit test 503 fail closed, giữ session để retry. Public bỏ qua lookup, không có nghĩa readiness health bỏ kiểm DB |
| Session hết hạn | HTTP JAR thật timeout test 60s, idle 65s: GET me 401, POST token cũ 403, refresh CSRF 200 rồi logout 204. Không đổi production timeout/không tắt CSRF |
| OpenAPI auth | CSRF public bỏ mô tả/account-lookup 401/503 cũ; logout security=[] vì anonymous có valid CSRF vẫn logout được, response 204/403; login form giữ 200/401/403, không hứa 503 từ filter bỏ qua |
| OpenAPI upload | Vẫn 22 operations: 11 implemented, 11 contract-only; không đánh dấu upload đã chạy. Giữ request/response shape, optional fileId và các đề xuất có review status |
| Schema/dependency | Không đổi V1, không migration/dependency mới. V1 có field cho hướng hiện tại; không có trigger bảo đảm mọi UPDATE identity bất biến, phải có writer tests ở Phase 2 |

Ngoại lệ public không trả dữ liệu bảo vệ: CSRF chỉ token, login vẫn xác thực, logout chỉ hủy session. Filter không @Component nên không bị đăng ký hai lần. Session đã bị invalidate không hồi sinh khi re-enable; session khác chỉ bị phát hiện khi request protected tiếp theo. Request đang chạy trước disable không bị hủy hồi tố. Mỗi protected request có principal PortalUser thêm một query theo PK, trade-off chấp nhận cho MVP.

## Kết quả chạy lại

| Kiểm tra | Kết quả |
| --- | --- |
| Maven verify/package | PASS / BUILD SUCCESS |
| JUnit | 17/17 PASS; 0 fail/error/skipped (3 unit, 10 PostgreSQL, 4 contract) |
| OpenAPI parse/ref và JSON schema/examples/negative cases | PASS trong ContractTest |
| HTTP baseline | 41/41 PASS |
| HTTP regression mở rộng | 70/70 PASS, gồm disable/public/logout và expiry thật |
| Git whitespace / migration diff / secret review | Xem review-checks.json, không stage/commit/push |
| AWS / conditional PUT / Lambda / Phase 2 service | NOT RUN; chưa triển khai |

[Evidence mới](../../evidence/week-02/phase-01-final/README.md) ghi lệnh, môi trường, output an toàn và hash. Bản 14 JUnit / 41+43 HTTP ở phase-01-report là lịch sử trước kiểm tra cuối; không lấy hash lịch sử làm bằng chứng code mới. Mockito agent/deprecated API có warning, build vẫn thành công; không phát sinh lỗi test.

## Quota / PUT lặp và hợp đồng Đăng

Chốt nội bộ: reserve/move/release đúng một lần theo PENDING state và project lock; fileId định danh logical file; key riêng mỗi upload; complete pin exact version; AVAILABLE độc lập VERIFIED; không HEAD latest hoặc dùng ETag thay SHA-256. Quota backend chỉ tính reservation + mọi version đã hoàn tất được giữ, không bảo đảm byte S3 thực tế khi PUT lặp, sai size hoặc upload mồ côi.

Ưu tiên đề xuất MVP key riêng + signed If-None-Match + policy không tái dùng/xóa key; **conditional PUT chưa được thử trên AWS**. Mất response PUT và Version ID: đề xuất dừng session cũ, chờ expiry rồi upload mới khi quota cho phép, không thêm recovery API. Trade-off là giữ quota tạm và upload lại, cần Nam review. Không release chỉ vì 412/timeout browser. Nếu conditional không khả thi, phải review kiểm soát chi phí/cleanup khác trước bật upload thật.

[Hợp đồng adapter đề xuất](../../contracts/s3-adapter-contract.md) ghi bốn operation, SDK-independent input/output, lỗi Missing khác AccessDenied/timeout, checksum/result-key, giới hạn signing/size và AWS POC checklist. Tất cả là đề xuất của Dũng để review; không tự ghi Đăng đã đồng ý. Theo [tài liệu AWS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), URL presigned có thể được dùng lại; thiết kế reservation của backend không biến URL thành single-use.

## Review và readiness Phase 2

| Người | Cần xác nhận | Gate |
| --- | --- | --- |
| Đăng | Port signatures/outcomes/timeout, exact HEAD/GET, checksum schema/result key, signed conditional header và POC; phối hợp cleanup | Trước ghép adapter/Lambda thật |
| Nam | fileId/no-rename/group versions; retry init không idempotent; 412/mất Version ID cần upload lại/chờ reservation; CSRF/state UI; size/TTL | Trước ghép luồng UI |
| Chiến + Đăng | Versioning, IAM/no delete-marker reuse, bucket policy/CORS/header expose, TTL/credentials, size/chi phí/cleanup upload trễ/mồ côi | Trước bật upload AWS |

Không có blocker cho session service, transaction quota/expiry, quyền/list query và complete/integrity tests với fake. Hợp đồng adapter chưa thống nhất và AWS POC chưa có là **gate tích hợp**, ngăn tuyên bố upload thật hoặc Phase 2 hoàn tất. [Kế hoạch Phase 2](phase-02-plan.md) chia sáu bước và acceptance tests, phân biệt unit/fake, PostgreSQL/HTTP nội bộ và AWS opt-in. Không triển khai các bước đó trong tác vụ này.

## File đề xuất commit và dữ liệu loại trừ

Đề xuất commit 41 file trong [danh sách](phase-01-files.md), có thể tách commit sửa backend/test/contract và commit thiết kế/evidence nếu muốn, nhưng phải giữ tài liệu auth khớp code. Chưa thực hiện commit hoặc staging. Các file dự thảo/candidate vẫn ghi rõ chưa review.

Giữ script tạm dựng/sửa contract và snapshot trong runtime-data bị ignore; chỉ script regression có thể chạy lại ở backend/tools được đề xuất commit. Không đưa runtime-data, .env, PostgreSQL data/log, raw Surefire XML (environment properties), target/JAR, cookie/token/presigned URL thật hoặc docs/tv3 vào bộ này. Không xóa/move dữ liệu người dùng. Evidence chỉ trạng thái, UUID fixture, timestamp và hash, không có password/cookie/credential thật; kiểm tra theo mẫu secret có giới hạn và được kết hợp đọc file/diff.
