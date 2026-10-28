# Đề xuất hợp đồng S3 adapter cho tuần 2

**Cập nhật 28/10/2026:** Dũng đã viết `backend/src/main/java/vn/edu/uet/handover/upload/StoragePort.java` và UploadService sử dụng port. Đăng vẫn cần review và cung cấp adapter thật. Bản mô tả ngày 22/10 bên dưới là thiết kế gốc. Port hiện dùng Optional cho Missing; lỗi hạ tầng ném `StoragePort.Unavailable`; JSON bytes quá 64 KiB/hỏng/sai identity thành integrity FAILED. Chỉ hỗ trợ PUT yêu cầu signed If-None-Match: *, không có chế độ replayable. Không có AWS SDK, Lambda hay xác nhận của thành viên khác trong lần cập nhật này.

Ngày 22/10/2026. Dũng đề xuất để Đăng review; **chưa được Đăng/Nam/Chiến xác nhận, chưa có interface hoặc adapter được viết trong task này**. Phạm vi MVP: single PUT, HEAD exact version, đọc kết quả checksum, presigned GET. Không multipart, recovery API, proxy upload, hàng đợi hoặc nghiệp vụ bàn giao.

## Phân công và kiểu dữ liệu đề xuất

Dũng sở hữu transaction PostgreSQL, quyền, quota và state machine. Đăng sở hữu AWS SDK adapter, presigner và Lambda checksum. Chiến xác nhận tài nguyên/IAM/CORS/versioning/chi phí. Nam gửi đúng signed headers, giữ Version ID và xử lý retry UI. Không component nào tự đổi identity sang latest.

Các tên dưới đây là đề xuất kiểu Java độc lập SDK để hai bên chốt trước tích hợp; chưa phải chữ ký đã duyệt:

- `ObjectRef(bucket, objectKey, versionId)`: cả ba bắt buộc; versionId opaque, không rỗng/blank/literal `null`. Không trim hoặc decode Version ID. Bucket/key do backend sinh/lưu, không nhận từ body complete.
- `SignedRequest(method, url, requiredHeaders, expiresAt)`: URL bí mật tạm thời, không log/lưu vào evidence. Thời hạn là giới hạn tối đa, credential có thể hết trước. Browser gửi mọi requiredHeaders nguyên giá trị.
- `VersionHead(ref, sizeBytes, contentType, deleteMarker)`: exact ref phải khớp request; size/type là dữ liệu S3, không echo dữ liệu client để giả kiểm chứng. Không dùng ETag làm SHA-256.
- `ChecksumRead`: một trong `Missing`, `Document(bytes)` hoặc `InvalidDocument(safeCode)`. Dũng kiểm JSON Schema v1 và identity trước quyết định VERIFIED. Document cần giới hạn kích thước đọc và timeout cấu hình, không đọc vô hạn; giới hạn cụ thể chốt với Đăng.

## Bốn thao tác và kết quả

| Thao tác đề xuất | Input | Output / nghĩa vụ adapter |
| --- | --- | --- |
| `presignPut(PutSpec)` | bucket, key, contentType, expected size, notAfter; write policy được chọn rõ | SignedRequest PUT; không upload object. Size là kỳ vọng, chưa phải bảo đảm S3 chặn số byte. Nếu yêu cầu conditional mà adapter không hỗ trợ, fail closed; không âm thầm cấp URL thường |
| `headVersion(ObjectRef)` | exact bucket/key/versionId | Found VersionHead hoặc Missing; không HEAD latest. AccessDenied/timeout/5xx là lỗi hạ tầng riêng, không coi Missing |
| `readChecksum(ObjectRef)` | exact identity gốc | Missing/Document/InvalidDocument từ result key xác định bên dưới; JSON không do browser cung cấp |
| `presignGet(ObjectRef, notAfter)` | exact identity, hạn tối đa | SignedRequest GET có versionId; presign thành công không chứng minh object tồn tại, service cần headVersion trước khi cấp URL |

`PutSpec` đề xuất chọn rõ `REQUIRE_IF_NONE_MATCH` hoặc `REPLAYABLE_REVIEW_REQUIRED`. Mode thứ hai chỉ được bật AWS sau khi nhóm chấp nhận kiểm soát byte/version thừa. Fake có thể mô phỏng cả hai để test; không mặc định chọn fallback khi adapter AWS báo lỗi. Chưa thêm config/enum Java trong task này.

| Kết quả/lỗi nội bộ | Dũng xử lý | Lưu ý |
| --- | --- | --- |
| Head Missing hoặc delete marker | complete 409 OBJECT_NOT_READY, giữ reservation đến expiry; download từ chối | Đăng xác nhận cách phân loại HEAD 404/405/delete marker với SDK/IAM thật |
| Timeout, throttling, AccessDenied, 5xx hoặc ký URL thất bại | 503 STORAGE_UNAVAILABLE, không AVAILABLE giả | SDK exception không đi ra client; không chuyển 403 S3 thành mất quyền project |
| Head sai identity | Fail closed 503 STORAGE_UNAVAILABLE | Không pin ref adapter trả nhầm, không đổi sang latest |
| Head đúng identity nhưng sai size/type | 409 UPLOAD_OBJECT_INVALID; FAILED và release một lần | Object có thể đã tồn tại; release logic không phải xóa byte S3 |
| Missing checksum | Giữ INTEGRITY_PENDING; FAILED trước đó không tự trở về pending | Không coi thiếu JSON là hash khớp |
| JSON hỏng/sai identity hoặc Lambda FAILED | Integrity FAILED; không VERIFIED | Mã lỗi an toàn; không log nội dung nhạy cảm |
| PUT 412 / conflict 409 từ S3 | Nam nhận trực tiếp ở browser | Không phải lỗi của presignPut vì adapter không thực hiện PUT; không tự complete hoặc release quota |

Retry SDK phải có timeout/số lần hữu hạn, không giữ khóa PostgreSQL qua network. Hai bên chốt timeout trước deploy; deadline complete được kiểm lại sau HEAD. Không thêm method xóa object vào adapter trong Phase 1; cleanup cần review riêng để tránh xóa nhầm version đã pin.

## Checksum identity và result key

Giữ nguyên `checksum-result.schema.json`, schemaVersion=1. Đề xuất result key kế thừa tuần 1:

`results/{sha256(UTF8(bucket))}/{sha256(UTF8(objectKey))}/{sha256(UTF8(versionId))}.json`

Hash lowercase, không newline/trim. Đăng decode object key từ event đúng một lần trước lookup/hash; key đã lưu DB là key gốc. Version ID giữ nguyên. Hai bên cần cùng fixture có ký tự `+ / = %` và khoảng trắng ở key để kiểm parity. Backend vẫn đối chiếu tuple + size trong JSON, không chỉ tin đường dẫn hash. Không để event results/ kích hoạt Lambda trở lại. Lambda SUCCEEDED nghĩa đã tính được hash; chỉ backend so expected/actual và quyết định VERIFIED/MISMATCH. Chưa chạy Lambda hoặc parity test thật trong task này.

## Quota reservation và PUT lặp

Quota backend là **used của mọi version được giữ + reserved của session PENDING**. Mọi init/complete/expire khóa project trước rồi session/version. Chuyển PENDING → AVAILABLE chuyển reserved sang used; PENDING → FAILED/EXPIRED release đúng một lần. Integrity FAILED không release used. Counter và trạng thái đổi trong cùng transaction. Size/type sai hoặc timeout browser không được diễn giải là S3 đã sạch.

| Phương án | Lợi ích | Giới hạn / đề xuất |
| --- | --- | --- |
| Chỉ pin exact Version ID khi complete | Backend làm ngay, bảo vệ version nghiệp vụ | URL có thể tạo nhiều object versions, không bảo đảm quota byte vật lý; chưa đủ để gọi upload AWS an toàn về chi phí |
| Key riêng + signed `If-None-Match: *` + chính sách không tái dùng key | Ứng viên MVP ưu tiên, giảm PUT lặp cùng key | Chờ POC Đăng/Chiến; vẫn không tự bảo đảm size, orphan cleanup hoặc hard quota S3 |
| Proxy upload/đổi POST policy/thêm recovery service | Có thể thay cách giới hạn payload hoặc recovery | Tăng phạm vi API/hạ tầng; không thực hiện trong MVP này nếu chưa có quyết định mới |

Mất response PUT/Version ID: đề xuất đơn giản là dừng dùng session cũ, chờ expiry, tạo init mới/key mới khi quota cho phép. Không suy ID bằng HEAD latest, không release vì 412 và không thêm endpoint recovery. Trade-off là upload lại và reservation cũ giữ đến deadline; **Nam cần review**. Nếu còn Version ID hợp lệ thì retry complete cùng ID theo idempotence hiện có. Init mất response cũng có thể để lại reservation; không tự gộp bằng filename.

Không xóa key đang có URL còn hiệu lực để “cho retry”: có thể làm mất điều kiện chống ghi lặp. Upload đến trễ/orphan cần kiểm quyền, exact version, trạng thái DB và khả năng PUT còn đang chạy trước cleanup. Phase 2 expiry chỉ giải phóng quota logic; chính sách dọn và giới hạn chi phí phải được Chiến/Đăng chấp nhận trước AWS upload. Chưa có hard byte quota vật lý S3 được chứng minh.

## Gate AWS bắt buộc trước tích hợp thật

Theo [AWS presigned URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), URL có thể dùng nhiều lần. [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) kiểm current version; current delete marker có thể cho phép ghi lại. [Bucket policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html) cần quyền cấu hình thực tế. Đây chỉ là căn cứ đề xuất; **AWS Lab NOT RUN**.

| Điều kiện / POC cần lưu kết quả an toàn | Người xác nhận | Trạng thái |
| --- | --- | --- |
| Bucket Versioning Enabled, PUT trả non-null Version ID; HEAD/GET v1 vẫn đúng sau một object version khác | Đăng + Chiến | NOT RUN |
| SDK ký If-None-Match đúng; PUT đầu thành công, PUT lặp và PUT đồng thời cùng key bị chặn phù hợp; bỏ/đổi header không vượt policy | Đăng + Chiến | NOT RUN |
| CORS cho đúng origin, PUT/header conditional; expose x-amz-version-id để browser đọc; Nam gửi đủ headers | Nam + Đăng + Chiến | NOT RUN |
| IAM GetObjectVersion/PutObject/results; không quyền xóa/tạo delete marker để mở lại key khi URL còn sống; policy áp dụng đúng uploads/ | Chiến + Đăng | NOT RUN |
| HEAD phân biệt missing với AccessDenied/timeout/delete marker; URL có versionId; TTL thực tế/credential hết hạn | Đăng | NOT RUN |
| Payload sai size/type, PUT quá lớn, upload đến trễ và cleanup không chạm version completed; chốt hạn mức/chi phí | Chiến + Đăng | NOT RUN |
| Lambda đọc exact event version, kết quả theo schema/key; event lặp/trễ và hash sai không xác minh nhầm version | Đăng + Dũng | NOT RUN |

Fake/Mock chỉ xác minh code xử lý các outcome đã mô phỏng; không chứng minh signing, versioning, IAM, CORS, conditional writes, checksum Lambda hoặc quota byte thực trên AWS. Không tự ghi nhận các gate này PASS.
