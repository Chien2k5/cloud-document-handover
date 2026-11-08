# Bàn giao tích hợp backend ngày 08 tháng 11 năm 2026

Backend nhánh Dũng dùng Java/Spring Boot, JdbcTemplate, PostgreSQL/Flyway và adapter AWS SDK tùy chọn. OpenAPI hiện hành là `0.5.0-backend-integration`. Thay đổi local này chặn file chưa VERIFIED ngay khi tạo gói và cung cấp uploadId bền vững để frontend kiểm lại checksum sau reload. Không thêm endpoint hoặc migration; không sửa Python của Đăng.

## Quy tắc bàn giao

| Thao tác | Điều kiện và kết quả |
| --- | --- |
| Create | Owner hiện tại; mọi phiên bản thuộc project, AVAILABLE, VERIFIED, có S3 Version ID hợp lệ; người nhận enabled, không lặp, hạn tương lai. Thành công tạo DRAFT và audit trong cùng transaction |
| Publish | DRAFT còn hạn/chưa revoke, kiểm lại integrity và người nhận; HEAD từng exact bucket/key/version ngoài transaction; khóa và kiểm lại trước READY. API publish chính là bước chuyển DRAFT sang READY, không có bước READY riêng trước publish |
| Confirm | Người nhận ACTIVE được chỉ định, đăng nhập, gói READY/CONFIRMED còn quyền/còn hạn; xác nhận chính mình và ghi audit. Tất cả người nhận ACTIVE xác nhận thì gói CONFIRMED |
| Revoke | Owner thu hồi toàn gói, giữ trạng thái workflow và lịch sử xác nhận; API không cấp URL mới |
| Download | Đúng quyền project hoặc người nhận gói; AVAILABLE + VERIFIED; HEAD exact version; kiểm lại quyền/trạng thái sau S3 calls; URL gói không vượt min(300 giây, hạn gói) |

Create trả 409 FILE_NOT_AVAILABLE nếu upload chưa AVAILABLE; 409 FILE_NOT_VERIFIED nếu integrity là INTEGRITY_PENDING/MISMATCH/FAILED. File project khác trả 404 FILE_NOT_FOUND. Editor/Viewer không tạo gói; caller ngoài project không được dùng ID để vượt quyền. Request bị từ chối không tạo một phần manifest, recipient hoặc audit HANDOVER_CREATED.

Điều kiện VERIFIED ngay tại create dựa trên `process2.pdf`, Bảng 2.2 trang 8 và mục 2.5.2 trang 9. Các tài liệu cũ cho phép pending trong DRAFT là hành vi trước sửa. Vẫn kiểm HEAD tại publish vì trạng thái DB lúc create không chứng minh object còn truy xuất được về sau.

## Công việc Nam cần thực hiện

1. Sau reload, đăng nhập hoặc mở lại project, gọi `GET /api/v1/projects/{projectId}/files?page=0&size=20`. Tải các trang tiếp theo theo nhu cầu giao diện.
2. Mỗi item FileVersion có `id`, `fileId`, `uploadId`, `versionId`, hai nhóm trạng thái và hash. `uploadId` lấy từ UploadSession trong PostgreSQL, không phải S3 Version ID. Nó có trong mọi FileVersion response, kể cả nested `UploadState.fileVersion`.
3. Với AVAILABLE + INTEGRITY_PENDING/FAILED, gọi lại `GET /api/v1/projects/{projectId}/files/uploads/{uploadId}`. Endpoint tự kiểm membership và đối soát đúng tuple/version. List chỉ trả trạng thái DB; bấm tải lại list chưa tự kích hoạt đối soát.
4. Poll có giới hạn và có nút kiểm tra lại; 503 cho phép người dùng thử lại có kiểm soát. INTEGRITY_PENDING là chờ; FAILED khác MISMATCH. VERIFIED/MISMATCH là kết quả cuối của version đó. FAILED có thể được đọc lại khi Lambda tạo kết quả hợp lệ muộn hơn.
5. PENDING upload chưa complete không đọc checksum. Chỉ người khởi tạo còn quyền ghi được complete với Version ID của response PUT đã giữ được. Nếu mất Version ID, không suy latest hoặc dùng uploadId/fileVersionId thay thế; để session hết hạn và tạo upload mới khi quota cho phép.
6. Gửi nguyên mọi signed header backend trả về trong PUT, lấy `x-amz-version-id` từ response và complete như trước. Đừng tự gán VERIFIED hoặc gửi actualSha256 cho backend.
7. Cập nhật validator/type response theo schema 0.5.0 nếu frontend dùng schema đóng. Endpoint, request body và page/size giữ nguyên; FileVersion thêm uploadId. Chỉ chọn AVAILABLE + VERIFIED để tạo gói; xử lý 409 FILE_NOT_AVAILABLE/FILE_NOT_VERIFIED từ server vì UI có thể đang giữ trạng thái cũ.

Ví dụ list: [file-page.response.json](../contracts/examples/file-page.response.json). Ví dụ trạng thái: [verified](../contracts/examples/upload-verified.response.json), [mismatch](../contracts/examples/upload-mismatch.response.json). Không có signed URL hoạt động hoặc credential trong các ví dụ.

Việc ghép React do Nam thực hiện. Backend đã kiểm recovery bằng một session HTTP mới lấy uploadId từ list, xử lý hai version riêng và gọi lại endpoint hiện có; chưa phải browser E2E sau sửa.

## Contract S3 và công việc Đăng cần thực hiện

Adapter Java đang thực thi bốn method trong [StoragePort](../backend/src/main/java/vn/edu/uet/handover/upload/StoragePort.java). Giữ signed Content-Type và If-None-Match `*`; HEAD và GET luôn truyền exact VersionId. Backend chỉ dùng bucket/key server đã lưu. PUT response phải trả Version ID không rỗng/không phải literal null. Nam gửi đủ header; Chiến/Đăng cấu hình CORS cho origin thật, cho hai request headers và expose x-amz-version-id.

Nguồn Đăng đã đối chiếu: nhánh `task/s3-lambda`, commit `15973c334e0dbc19e2965fa1897ce5a3faa9a8ef`. Nhánh đó có Python presigner và Lambda; Java backend không chạy Python adapter. Python presigner hiện thiếu signed ContentType/IfNoneMatch, HEAD là latest và result key/payload khác contract v1. Nếu tiếp tục sử dụng Python POC thì Đăng cần đồng bộ riêng; luồng Java backend dùng presigner Java đã có.

Lambda phải nhận event uploads/, decode object key đúng một lần, giữ Version ID opaque và đọc đúng object version. Ghi JSON UTF-8 tối đa 64 KiB tại key:

```text
results/{sha256hex(UTF8(bucket))}/{sha256hex(UTF8(objectKey))}/{sha256hex(UTF8(versionId))}.json
```

Hash lowercase, không trim hoặc thêm newline. Event results/ không được kích hoạt lại Lambda. Fixture key dùng chung với Java test:

```text
bucket = fixture-bucket
objectKey = uploads/a +%=.pdf
versionId = v+/=%
resultKey = results/fbbc3334e2325e09e43cb32dd41ba6e63d0f3ffad0bf108a1cb0db971610f8b7/552e151a9beecf2fac5516946aeda4c549ef15326dc59f62256c776c527cbeac/ca01fa40730897dffb94f2dec149a942d49c1c9ec9c95f1ddf0db7cc9328a85e.json
```

JSON theo [schema v1](../contracts/checksum-result.schema.json), không có trường thừa:

```json
{
  "schemaVersion": 1,
  "bucket": "fixture-bucket",
  "objectKey": "uploads/a +%=.pdf",
  "versionId": "v+/=%",
  "size": 3,
  "status": "SUCCEEDED",
  "actualSha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "errorCode": null,
  "processedAt": "2026-11-08T00:00:00Z"
}
```

Payload trên minh họa bytes `abc`. Khi thất bại nhưng biết được identity và kích thước đáng tin cậy, dùng `status: FAILED`, `actualSha256: null`, `errorCode` an toàn và giữ đủ các field khác; xem [mẫu FAILED](../contracts/examples/checksum-failed.json). Nếu S3 lỗi tạm thời hoặc không xác minh được version/size, không tự điền metadata để ghi SUCCEEDED; log mã lỗi an toàn, trả lỗi cho cơ chế retry phù hợp của Lambda. `HASHED/sha256` phải đổi sang schema này, không thêm fallback ở backend.

Chỉ backend so expected/actual để quyết định VERIFIED/MISMATCH. Thiếu JSON giữ trạng thái chờ/lỗi hiện có; sai schema, thiếu field, duplicate field, sai identity/size hoặc Lambda FAILED đều không VERIFIED. AccessDenied, timeout, throttling, lỗi đọc body là 503 STORAGE_UNAVAILABLE, không phải Missing. Adapter chỉ coi NoSuchKey 404 là kết quả checksum chưa có; HEAD 404/405 là phiên bản không sẵn sàng.

Đăng cần kiểm sự kiện lặp/trễ/đảo thứ tự không đổi kết quả sang version khác; ghi kết quả có conditional PUT và kiểm lỗi 409/412 theo chính sách đã chọn. Đồng thời kiểm streaming đóng body, giới hạn file/timeout thực tế. Không thay đổi nhánh Python trong lượt backend này; chưa có chấp thuận của Đăng về contract v1 được tự ghi nhận.

## Cấu hình và giới hạn

- `UPLOAD_S3_ENABLED=false` mặc định giữ storage fail closed. Bật S3 cần UPLOAD_BUCKET, AWS_REGION và credential chain bên ngoài Git.
- Giữ giới hạn 100 MiB/file, TTL upload 1–300 giây và quota logic used + reserved. Đây không phải hard quota byte S3; release reservation không xóa object.
- Java client có apiCallTimeout 8 giây, apiCallAttemptTimeout 3 giây và Apache socketTimeout 3 giây. Reader giới hạn 64 KiB, kiểm length, abort khi quá lớn/lỗi I/O và đóng body.
- URL S3 đã cấp có thể còn dùng tới hạn sau revoke; không xóa version bàn giao để mô phỏng thu hồi ngay.
- Migration V1 và auth/session/CSRF giữ nguyên. Không thêm Nextcloud, JPA, microservice hoặc job nền. ERD thực thi: [erd.mmd](week-01/erd.mmd).
- AWS Versioning/CORS/IAM, conditional PUT trên browser, Lambda thực, Beanstalk và restore DB kết hợp GET S3 vẫn cần kiểm trên môi trường nhóm.

## Kiểm thử liên quan

`HandoverIntegrationTest`: create từ chối integrity chưa đạt và upload chưa AVAILABLE, kiểm API/rollback; publish vẫn kiểm lại integrity, HEAD, quyền, hạn, confirm/revoke và pin v1. `UploadIntegrationTest`: session mới lấy uploadId từ list, hai version không lẫn nhau, pending chưa complete, thiếu JSON/503/FAILED/sai version/kết quả muộn, polling terminal và gỡ membership trong lúc đọc S3. `S3StorageAdapterTest`: signed headers/exact ref, Missing khác Unavailable, giới hạn/read thiếu, đóng/abort stream và bean configuration. `ContractTest`: ví dụ/schema và bắt buộc uploadId.

Chạy full PostgreSQL tests chỉ với DB fixture độc lập và RUN_DB_TESTS=true. Fake storage/signer fixture không phải AWS PASS. Các tài liệu Word cũ và nội dung phải sửa được liệt kê trong [bảng đối chiếu](tv3/doi-chieu-tai-lieu-cu.md).
