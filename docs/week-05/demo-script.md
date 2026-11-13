# Kịch bản kiểm tra và demo bàn giao

## Kiểm phần backend độc lập

1. Mở README bản chốt và chỉ rõ đây là backend, AWS/UI chưa tích hợp.
2. Tạo DB thử riêng, đặt DB_URL/DB_USERNAME/DB_PASSWORD và RUN_DB_TESTS=true. Chạy Maven verify; đọc kết quả thật, không coi SKIPPED là PASS.
3. Trình bày ba ca C07: revoke đồng thời của gói CONFIRMED chỉ ghi một audit; lỗi audit rollback trạng thái; HTTP audit ghi actor/requestId từ server. Bộ test dùng fixture storage, không tải byte S3.
4. Trình bày pin v1 sau upload v2, chặn người ngoài project/gói, chặn publish khi chưa VERIFIED và confirm lặp không đổi thời điểm.
5. Chạy restore local theo runbook, thêm --evidence-dir evidence/week-05/local-restore để giữ lịch sử tuần 4. Đối chiếu bảng/hash/FK/quota, target không seed user và manifest/confirmedAt giữ nguyên.
6. Kiểm ZIP source với BUNDLE-MANIFEST/sidecar, giải nén và build theo hướng dẫn. Mặc định build chỉ chạy unit/contract; muốn kiểm DB phải bật suite riêng.

Khi quay clip local, ghi rõ phạm vi fixture, commit, ngày chạy và kết quả. Không gọi video local là demo Cloud. Evidence và biên bản đã có có thể dùng làm tài liệu đối chiếu, không thay lượt chạy thực tế của người kiểm tra.

## Demo tích hợp khi nhóm cung cấp môi trường

Điều kiện: commit adapter/UI/backend đã ghép; tài khoản Owner/Viewer/người nhận được chuẩn bị; HTTPS, DB độc lập, bucket Versioning, IAM/CORS/events/result-key hoạt động. Chiến triển khai bản đã được nhóm duyệt. Nam/Đăng review giao diện và contract trước ghép.

| Bước | Thao tác | Kết quả phải thấy |
| --- | --- | --- |
| 1 | Owner đăng nhập, tạo dự án và gán thành viên | Owner do server gán; người ngoài dự án nhận 404 |
| 2 | Tính SHA-256 file A, init, PUT đúng signed headers, complete với Version ID nhận được | AVAILABLE, integrity còn pending khi Lambda chưa có kết quả |
| 3 | Đợi Lambda trả JSON, gọi API trạng thái | VERIFIED khi đúng bucket/key/version/size/hash; log đối chiếu cùng phiên bản |
| 4 | Thử file sai hash/JSON thiếu hoặc sai version | Không VERIFIED và không publish được |
| 5 | Owner tạo DRAFT chứa v1 và người nhận, publish | READY chỉ khi tất cả item VERIFIED và HEAD đúng version còn hợp lệ |
| 6 | Người nhận ngoài project đăng nhập, đọc/tải gói | Chỉ gói được chỉ định; project/file ngoài gói vẫn 404 |
| 7 | Upload v2 của cùng file, tải lại item từ gói | Nội dung/Version ID vẫn v1 đã chốt |
| 8 | Hai người nhận lần lượt confirm; thử lặp | READY sau người đầu, CONFIRMED sau người cuối; timestamp/audit không trùng |
| 9 | Revoke, thử cấp URL và confirm mới; đo URL cũ | URL/confirm mới bị chặn; ghi đúng thời gian URL cũ còn hiệu lực, không hứa thu hồi tức thời |
| 10 | Backup lên S3, restore DB chung tách biệt, kiểm lại gói/file | FK/manifest/confirmations còn đúng và S3 HEAD/GET đúng version truy xuất được |

Cho từng ca ghi môi trường, commit, thời điểm, bước thực hiện, expected/actual, PASS/FAIL/NOT RUN và người kiểm tra. Clip không hiển thị cookie/token/password/AWS credential/presigned URL còn hiệu lực. A07 dùng số CloudWatch/chi phí của tài khoản thật do Chiến cung cấp; không có số thì ghi chưa đo.

## Khi có lỗi

Ghi lỗi, requestId, mã HTTP, trạng thái DB và log an toàn; giao đúng chủ phần. Backend lỗi thì Dũng sửa và chạy regression liên quan; S3/Lambda thì Đăng; IAM/network/DB/deploy thì Chiến; UI/poll/retry thì Nam. Không tự nới quyền, tự gán VERIFIED hoặc đổi sang latest để làm demo chạy qua.
