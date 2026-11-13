# Phân tích bản S3 adapter Đăng gửi và hướng tích hợp

Ngày 29/10/2026. Nền backend: `292f8905ddcc42f9de340151ce47fe729128c69b`, nhánh `dung`. Nguồn là ba tệp Dũng cung cấp từ Đăng, kèm ảnh hội thoại; [hash, cách kiểm và kết quả offline](../../evidence/week-02/dang-adapter-review/README.md) được lưu riêng. Chưa có nhánh/commit của Đăng hoặc log AWS chạy thành công đi kèm.

## Kết luận và phạm vi xác nhận

Đăng đã cung cấp bản thử nghiệm Python/boto3, có presigned PUT, GET theo Version ID, HEAD latest, liệt kê version và đọc JSON checksum. README ghi bucket `nhom5-document-storage-2026-dang`, region `ap-southeast-2`, Versioning Enabled. Đây là thông tin Đăng cung cấp; chưa được xác minh qua tài khoản AWS trong lần review này.

Việc gửi mã không đồng nghĩa Đăng đã duyệt `StoragePort`, schema/result key hoặc các quyết định retry của nhánh Dũng. Adapter này chưa được đăng ký trong Spring Boot; fallback hiện tại vẫn trả `503 STORAGE_UNAVAILABLE`. C03/G2 và C04/G3 chưa thể đóng từ các tệp này.

Điểm có thể kế thừa: dùng provider chain thay hardcode credentials; kiểm prefix/key; GET có `VersionId`; phân trang list versions; README phân biệt HASHED với VERIFIED và cảnh báo latest không chắc là upload của mình. Các cơ chế này là nền thử nghiệm hữu ích, cần hoàn thiện chỗ nối với backend.

## Những điểm chưa tương thích cần xử lý

| Ưu tiên | Quan sát ở tệp Đăng | Hệ quả khi ghép / yêu cầu cần chốt |
| --- | --- | --- |
| P0 | Python/boto3, trả URL string; backend là Java và cần bean thực thi bốn method StoragePort | Cần adapter Java tương ứng; không thể copy Python vào backend rồi coi đã hoạt động |
| P0 | create_upload_url dòng 42–50 chỉ ký Bucket/Key, không ContentType/IfNoneMatch | UploadService yêu cầu signed headers Content-Type và If-None-Match: *. Cần trả method/url/requiredHeaders/expiresAt, tính hạn từ notAfter; không thêm header giả sau ký |
| P0 | get_latest_version dòng 71–77 HEAD không có VersionId; test dòng 29 dùng latest | Có thể chọn nhầm version khi ghi đồng thời. Complete phải nhận Version ID từ response PUT; adapter cần HEAD exact bucket/key/version và trả size/type/delete-marker |
| P0 | README dùng sha256, status HASHED; thiếu schemaVersion/size/actualSha256/errorCode | Backend không chấp nhận JSON này, không thể VERIFIED. Cần thống nhất schema writer/reader; không âm thầm gán size/status để giả tương thích |
| P0 | Result key hiện là results/{sha256(key)}/{versionId}.json | Khác đề xuất backend: results/{sha256(bucket)}/{sha256(key)}/{sha256(versionId)}.json. Cả Lambda writer lẫn adapter reader phải dùng cùng một quy tắc đã chốt |
| P1 | get_checksum_result dòng 109 đọc toàn bộ body rồi json.loads, không đóng stream rõ ràng | Port yêu cầu bytes tối đa 64 KiB, đóng stream, để backend parse/kiểm identity. Document lớn hơn 64 KiB đã được chấp nhận trong probe offline |
| P1 | Không map lỗi SDK; chưa cấu hình timeout/retry theo deadline; validate_version_id chấp nhận literal null | Missing checksum phải Optional.empty; AccessDenied/timeout/5xx phải Unavailable, không bị coi missing hoặc hash sai. Chặn null theo contract, giữ nguyên opaque Version ID |
| P1 | Bucket/region cố định; expires cho phép tới 3600 giây | Chuyển sang config của môi trường được Chiến xác nhận; tôn trọng notAfter/TTL tối đa 300 giây của backend. Cho phép 3600 trong thư viện tự nó chưa là lỗi nếu caller giới hạn, nhưng chưa đáp ứng giao diện deadline hiện tại |
| P1 | test dùng key cố định, chỉ print CONTENT MATCH/HASH MATCH; retry bắt mọi Exception | Không tự fail khi bytes/hash sai; lặp test có thể xung đột key. Cần assert/exit khác 0, key riêng, timeout hữu hạn, phân biệt JSON chưa có với lỗi IAM/schema; không retry mọi lỗi như pending |

Probe offline xác nhận GET giữ nguyên Version ID là điểm đúng. Kịch bản HEAD giả trả v2 trong khi upload cần v1 cho thấy đường latest không thể bảo đảm identity; đây là kiểm chứng lỗi thiết kế bằng giả lập, không phải log S3 xảy ra thật. Hai tệp Python parse được; bản test gốc không được chạy vì có PUT ghi vào bucket thật.

## Hướng đề xuất

Giữ kiến trúc process2.pdf trang 6: một ứng dụng Spring Boot, module M4 làm adapter S3. Đề xuất chuyển phần gọi S3 sang Java/AWS SDK trong bean StoragePort; giữ Python làm POC tham khảo. Không mở thêm dịch vụ Python hoặc subprocess bridge chỉ để nối bốn thao tác này. Đăng cần thống nhất hướng chuyển hoặc phối hợp Dũng viết phần nối, vì đây là phần Đăng phụ trách.

Giữ frontend API hiện tại để Nam tiếp tục ghép. Chốt schema checksum v1 và result key hiện đề xuất của backend là phương án ưu tiên vì đã có parser, schema và fixture. Đây vẫn là đề xuất gửi Đăng; nếu Đăng muốn giữ format/key cũ thì phải lập mapping có version, kiểm tính toàn vẹn và sửa đồng bộ writer/reader/test sau khi hai bên đồng ý. Không coi việc Đăng gửi code là chấp thuận phương án này.

## Các bước, người phụ trách và điều kiện qua bước

| Bước | Việc làm | Chủ trì / phối hợp | Đầu ra cần có |
| --- | --- | --- | --- |
| 1 — Chốt giao diện | Xác nhận Java StoragePort, signed headers, exact Version ID, checksum schema/result key và error mapping | Dũng + Đăng; Nam xem phần browser | Tin nhắn/review gắn commit cụ thể, cùng một fixture JSON và result key; còn khác biệt phải ghi rõ |
| 2 — Sửa backend độc lập song song | Chặn unverified ngay khi create handover; sửa OpenAPI và test theo PDF trang 8–9 | Dũng | AVAILABLE + VERIFIED mới vào gói; test rollback không tạo gói/item/audit khi bị từ chối |
| 3 — Làm adapter và Lambda đồng bộ | Implement bốn method, cấu hình bucket/region/provider chain, timeout/retry, bounded read; Lambda đọc đúng event version và xuất JSON/key đã chốt | Đăng; Dũng hỗ trợ bridge Java sau khi thống nhất | Source/commit adapter + Lambda, unit/contract tests, không credential trong repo |
| 4 — Xác nhận môi trường | Bucket/Versioning/private access, region, IAM, CORS, uploads-only notification, HTTPS/DB và log | Chiến + Đăng; Nam cung cấp origin | Cấu hình/log an toàn và môi trường thử được phép dùng; README nói Enabled chưa thay bằng chứng này |
| 5 — Chạy POC S3 giới hạn | Key mới; PUT có headers, lấy Version ID từ response, HEAD/GET exact, thử lặp/expiry/size-type/missing/denied; không sửa bucket thật tùy tiện | Đăng + Dũng + Chiến | PASS/FAIL kèm commit/thời điểm/object identity; không lưu URL ký hoặc credentials. CORS phải thử bằng browser |
| 6 — Ghép upload/checksum UI | SHA-256 → init → PUT → complete → polling; hash đúng/sai, JSON chậm, retry complete, quyền Viewer và khác project | Nam + Dũng + Đăng | G2/G3 có lượt chạy thật; JSON pending không báo thành công, không dùng latest để recovery |
| 7 — Ghép bàn giao và nghiệm thu cuối | VERIFIED → READY → CONFIRMED → revoke; sau đó restore metadata và kiểm HEAD/GET phiên bản còn đúng | Dũng + Nam; Chiến/Đăng hỗ trợ AWS/restore | Bằng chứng liên quan G3–G5; chi phí/CloudWatch/README/video theo phân công, không tự đóng mọi tuần từ một POC |

Bước 2 làm được ngay ở nhánh Dũng. Bước 1 có thể chuẩn bị contract/fixture/câu hỏi ngay; thay đổi adapter của Đăng, schema Lambda, bucket/IAM hoặc triển khai phải phối hợp chủ phần việc. Lần review này chỉ phân tích và cập nhật hồ sơ, chưa làm adapter thật hay sửa lỗi bàn giao.

## Nội dung Dũng có thể gửi Đăng

> Tôi nhận đủ ba file rồi. Có nền PUT/GET và đọc checksum rồi, nhưng backend tôi là Spring Boot nên mình cần chốt bản Java implement StoragePort. Có ba điểm cần thống nhất trước: PUT ký Content-Type + If-None-Match; lấy Version ID từ response PUT và HEAD đúng version, không dùng latest; JSON checksum/result key đang khác bản backend. Tôi gửi ông StoragePort, schema và bảng đối chiếu để mình chốt chung. Ông gửi thêm source Lambda, nhánh/commit và log chạy thử đã có nhé; không gửi credentials. Bucket/region này mình nhờ Chiến xác nhận môi trường trước khi chạy chung.

## Căn cứ AWS đã đối chiếu

- [HeadObject](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/head_object.html): dùng VersionId để chỉ định phiên bản cụ thể.
- [PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html): response có x-amz-version-id khi áp dụng versioning; browser cần đọc đúng response của PUT.
- [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html): If-None-Match áp dụng current version; PUT lặp có thể 412 và có trường hợp cạnh tranh 409. Không suy luận đây là hard quota hoặc URL chỉ dùng được một lần trong mọi điều kiện.
- [CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html): cho phép header request và expose header response cần cho browser; CLI chạy được chưa chứng minh CORS hoạt động.
- [S3 event format](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html): object key trong event có encoding và event có thể sai thứ tự; Lambda cần decode key đúng một lần, giữ Version ID, không dùng latest.
