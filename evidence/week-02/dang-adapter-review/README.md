# Review bản adapter Đăng gửi

Ngày ghi nhận: 29/10/2026, Asia/Saigon. Source nền của backend: `292f8905ddcc42f9de340151ce47fe729128c69b`. Dũng cung cấp ba tệp và ảnh hội thoại với Đăng. Ảnh cho thấy Đăng gửi file để tích hợp; không có nội dung duyệt toàn bộ contract nhánh Dũng, nhánh/commit adapter hoặc kết quả AWS PASS kèm theo.

## Nguồn

| Tệp gốc | SHA-256 |
| --- | --- |
| s3_adapter.py | ff3fd4c19a1d0406a2cb7bbe43bd27ab687c5c59670702fb7e6d00775dbe3438 |
| test_adapter.py | 76bae24a27e5db054c26f007478da85fefc03508b57b737842ece15327bed57f |
| README_S3_ADAPTER.md | 4c0f2954cc54e809a0ed531e3ae9b3482506fcb507b3a664c81421b9db5f0944 |
| codex-clipboard-d8bca223-48ea-4f35-854f-a82e8a557a05.png | 5db3f0caae3d019c78bd87b8769d86f56d268bed5862b743e8bef91bbc61e159 |

Không copy toàn bộ ảnh hội thoại hoặc sửa các tệp của Đăng. Tệp Python/README gốc ở thư mục ngoài repo do Dũng cung cấp; hash dùng đối chiếu bản đã review.

## Cách kiểm và giới hạn

- Đọc đầy đủ ba tệp, parse AST hai tệp Python; đối chiếu với StoragePort, UploadService, UploadConfiguration, OpenAPI và checksum-result.schema.json.
- Chạy [offline_probe.py](offline_probe.py) với boto3/botocore stub, URL example.invalid và body/HEAD giả. Không dùng AWS credentials, không cài/import SDK thật, không chạy test_adapter.py gốc và không thực hiện PUT/HEAD/GET lên AWS.
- Snapshot kết quả [offline-review.json](offline-review.json) lúc 08:21:16 UTC+07 phản ánh các điểm không tương thích; không phải bộ integration tests PASS.
- Đã xác minh presigned GET giữ Version ID; PUT chưa ký hai header yêu cầu, HEAD không chỉ định version, checksum schema/key khác, đọc JSON trên 64 KiB chưa bị chặn, stream chưa đóng rõ ràng. Test gốc có 0 assert; các dòng print kết quả so sánh không tự làm script fail khi khác dữ liệu/hash.
- Những quan sát này chứng minh hành vi mã đã đọc/giả lập; không chứng minh bucket tồn tại, Versioning Enabled, Lambda chạy, IAM/CORS hoặc chữ ký AWS hợp lệ.

Chạy lại bằng Python chuẩn, không cần boto3, khi có ba tệp gốc:

```powershell
python evidence/week-02/dang-adapter-review/offline_probe.py D:/Uet/Third_Year/Cloud
```

Script ghi kết quả mới vào output/dang-adapter-review/offline-review.json để giữ nguyên snapshot trong evidence. Chỉ dùng với bản source đã đọc; đây là probe review mã, không phải sandbox cho mã Python tùy ý.

## Kiểm bản cập nhật hồ sơ

Chạy lại probe từ đường dẫn evidence lúc 08:25:13 UTC+07: cùng findings/source hashes với snapshot 08:21:16. Kiểm 43 liên kết local trong các tài liệu liên quan, ba hash source và hash ảnh đều khớp. OpenAPI chỉ đổi metadata review của Đăng, không đổi runtime paths/schema.

Chạy `mvnw.cmd -B -ntp -Dtest=ContractTest test` trong backend, kết thúc 29/10/2026 lúc 08:25:49 UTC+07: 4 tests PASS, 0 failures/errors/skipped. Không chạy lại 51 DB tests, test Python ghi S3 hoặc AWS/browser E2E trong lần này; không sửa runtime source hay các tệp gốc của Đăng.

Xem [phân tích và các bước tiếp theo](../../../docs/week-02/dang-s3-adapter-review.md). Trạng thái: **đã nhận POC, còn điểm cần thống nhất; AWS/integration NOT RUN**.
