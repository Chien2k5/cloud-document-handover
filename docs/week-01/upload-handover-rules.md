# Hợp đồng upload checksum quota và bàn giao

**Cập nhật 22/10/2026:** Đây là bản thiết kế tuần 1 được giữ để đối chiếu. Khi triển khai tuần 2, dùng [thiết kế phase 1](../week-02/phase-01-upload-contract.md) cho optional fileId, quota/PUT lặp, complete/expiry và integrity retry. Không coi các đề xuất AWS dưới đây là đã được nhóm duyệt.

Phần này là quyết định thiết kế của nhánh tuần 1 để Nam/Đăng review. Chưa có S3 adapter, Lambda, polling đối soát hoặc service bàn giao đang chạy. Không có endpoint stub trả thành công cho các thao tác chưa triển khai.

## Upload và quota

1. Owner/Editor gửi `POST /api/v1/projects/{id}/files/uploads` với filename, contentType, size và expectedSha256. SHA-256 là 64 hex lowercase của chính byte file (ví dụ `hello` không có newline). Không gửi role, objectKey hoặc bucket từ frontend.
2. Server kiểm membership; khóa project `SELECT FOR UPDATE`; kiểm `size <= maxFileSize` và `size <= quota - used - reserved`, tạo FileMetadata/FileVersion/UploadSession và giữ chỗ trong một transaction. Kích thước/quota dùng BIGINT; không dùng phép cộng có thể overflow. Mỗi API tạo session mới là upload mới và được tính quota riêng; không mặc định retry init có idempotency.
3. Cấu hình đề xuất: project 1 GiB (PROJECT_QUOTA_BYTES hiện dùng khi tạo project), file tối đa 100 MiB, presigned PUT 300 giây. Max file/TTL/retention **chưa cấu hình hoặc thực thi** trong service upload vì chưa có service; Đăng/Chiến xác nhận bằng POC trước tuần 2. Quota tính mọi version được giữ, không chỉ version mới nhất; gói tham chiếu version không tính thêm bản copy.
4. Object key server tạo là `uploads/{projectId}/{uploadId}`; filename chỉ lưu metadata. Browser PUT với các signed headers. CORS S3 cần expose `x-amz-version-id` để browser gửi complete; cần thống nhất cùng Đăng/Chiến. Presigned PUT không tự bảo đảm kích thước request; complete kiểm lại và phải có kế hoạch dọn object bị từ chối.
5. Upload hết hạn/lỗi giải phóng reservation đúng một lần dưới khóa project. Không giải phóng khi complete đã thành công. Xử lý complete gần deadline và job hết hạn phải cùng dùng khóa để tránh trừ/ghi quota hai lần. URL đã cấp có thể tiếp tục dùng đến hạn; object đến muộn phải bị từ chối complete và xử lý theo chính sách dọn rác được chốt với Chiến.

## Complete

Body chỉ có versionId từ header S3 PUT; đây là claim cần kiểm tra, không phải chứng cứ upload đã đúng. Server lấy bucket/key/expected size/type từ DB, kiểm actor là người khởi tạo còn Owner/Editor, project đúng upload và hạn session. Đăng cung cấp `HEAD(bucket,key,versionId)` và dữ liệu exact version; không dùng HEAD latest hoặc ETag làm hash SHA-256.

Chỉ chuyển AVAILABLE khi exact object tồn tại, không là delete marker, versionId không null/rỗng/literal `null`, ContentLength/type đúng, bucket/key/version tương ứng session và quota hợp lệ. Transaction chuyển reserved sang used đúng một lần và ghi completed_at. Lần lặp cùng version trả trạng thái cũ; version khác 409. Timeout/thiếu object giữ chờ hoặc lỗi có thể thử lại, không ghi AVAILABLE giả. Bộ test đầy đủ logic này thuộc tuần 2.

AVAILABLE chỉ nói backend đã nhận file đúng phiên bản; integrity vẫn INTEGRITY_PENDING. Phản hồi complete không nhận `actualSha256`, `integrityStatus` hoặc `VERIFIED` do frontend gửi. API trạng thái sẽ đối soát JSON Lambda; frontend chỉ hiển thị kết quả server.

## Giao diện adapter đề xuất với Đăng

| Thao tác | Đầu vào do backend kiểm soát | Kết quả cần trả |
| --- | --- | --- |
| presignPut | bucket/key, contentType, TTL | URL, required headers, expiresAt |
| headVersion | bucket/key/versionId | identity chính xác, size, contentType, deleteMarker hoặc lỗi phân loại |
| readChecksum | bucket/key/versionId | NotReady hoặc JSON đã đọc từ results/; không nhận JSON từ browser |
| presignGet | bucket/key/versionId, TTL | URL gắn versionId và expiresAt |

Chưa có Java interface cố định hoặc implementation; bảng này chờ Đăng xác nhận để tránh ghi đè phạm vi adapter. Không cần credential AWS để build hoặc chạy phần tuần 1.

## JSON checksum v1

Schema: `contracts/checksum-result.schema.json`. Ví dụ thành công/lỗi ở `contracts/examples/checksum-*.json`. Lambda chỉ nhận ObjectCreated `uploads/`, đọc exact version, streaming SHA-256 và ghi `results/`. JSON gồm schemaVersion=1, bucket, objectKey đã URL-decode từ S3 event, versionId, size, status, actualSha256/errorCode, processedAt UTC.

Result key đề xuất, cần Đăng xác nhận:

```text
results/{sha256hex(UTF8(bucket))}/{sha256hex(UTF8(objectKey))}/{sha256hex(UTF8(versionId))}.json
```

Ba hash lowercase, không newline hoặc thêm khoảng trắng trước khi hash. Tách v1/v2; cùng event/version cho cùng key, không dùng timestamp hoặc filename làm định danh. Không để results/ kích hoạt lại Lambda. Schema status SUCCEEDED bắt buộc actualSha256 hợp lệ và errorCode=null; FAILED bắt buộc actualSha256=null và errorCode an toàn. Lambda báo SUCCEEDED nghĩa là **đã tính được hash**, không phải VERIFIED; chỉ backend so expected/actual.

Kết quả phải khớp bucket/key/versionId/size với row server đang kiểm tra, không dùng event v2 xác minh row v1. Thiếu JSON: giữ INTEGRITY_PENDING. JSON hỏng/không đúng schema/sai identity hoặc Lambda FAILED: không VERIFIED, dùng FAILED và ghi mã lỗi an toàn để thử lại có kiểm soát. Hash giống → VERIFIED; khác → MISMATCH. Lặp polling/event không đổi một kết quả hợp lệ sang phiên bản khác. Chưa có test AWS cho hợp đồng này.

## Phát hành và xác nhận

- DRAFT tạo bởi Owner; tất cả item phải cùng project, trỏ fileVersionId cụ thể. Version ID, object key và checksum lưu trong version được giữ bất biến; item không resolve latest. Không sửa manifest/recipients sau READY.
- Trước READY: gói/item/người nhận không rỗng, expiry tương lai, access ACTIVE; từng phiên bản AVAILABLE + VERIFIED và HEAD exact version còn truy xuất được. Chưa xác minh, hash sai, phụ thuộc lỗi hoặc object mất đều chặn phát hành. Không có bước bỏ qua integrity để demo.
- Người nhận là user đã tồn tại, có thể ngoài project. Backend kiểm session và bản ghi HandoverRecipient, trạng thái/hạn dùng mỗi lần xem/tải/xác nhận. Grant theo gói không cho quyền xem cả project.
- Confirm idempotent theo recipient; ghi actor/time phía server và audit. Đề xuất CONFIRMED khi **tất cả người nhận ACTIVE** xác nhận. Quy tắc nhiều người nhận cần Nam xác nhận trước tuần 3; không đổi ngầm khi ghép UI.
- Thu hồi giữ trạng thái workflow/confirmedAt, đổi accessStatus REVOKED và chặn cấp URL mới. GET URL tối đa min(300 giây, thời gian còn lại của gói). URL cũ có thể còn hiệu lực đến hạn và bản đã tải không thể thu lại.
- Không tự xóa version đã được gói tham chiếu; retention/cleanup/backup do nhóm thống nhất. FK giữ liên kết DB nhưng không thay backup S3/DB hay bài kiểm tra restore tuần 4.
