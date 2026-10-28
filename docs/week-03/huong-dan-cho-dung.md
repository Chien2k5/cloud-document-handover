# Việc Dũng cần làm để ghép tuần 3

Ngày 29/10/2026. Backend bàn giao đã được viết và kiểm thử độc lập. Bạn có thể kiểm tra phần này ngay; nghiệm thu Cloud cần adapter, môi trường và giao diện của nhóm.

## Phần đã được làm giúp

| Phần | Đầu ra |
| --- | --- |
| Tạo và xem DRAFT | Kiểm tra Owner, phiên bản đúng dự án/AVAILABLE, người nhận có tài khoản enabled, hạn truy cập hợp lệ |
| Phát hành READY | Mọi item phải AVAILABLE + VERIFIED; HEAD đúng version; kiểm lại quyền/state/deadline sau lời gọi storage |
| Người nhận ngoài dự án | Xem/tải đúng gói được chỉ định, không được list hoặc đọc toàn dự án |
| Download gói | Đúng phiên bản đã chọn; URL không vượt 300 giây hoặc hạn gói; kiểm quyền lại sau ký URL |
| CONFIRMED | Session xác định người nhận; lưu thời điểm server; tất cả người nhận ACTIVE xác nhận thì gói CONFIRMED |
| Thu hồi và audit cơ bản | Không cấp URL/xác nhận mới sau revoke; giữ lịch sử; thao tác lặp không ghi audit trùng |
| Kiểm thử | PostgreSQL và HTTP TCP thật; storage giả chỉ ở test source; schema phản hồi theo OpenAPI |

Không phải tự viết lại các phần này. Thu hồi hiện là mức cơ bản hỗ trợ luồng; chưa coi toàn bộ hạng mục C07 hoặc AWS đã nghiệm thu.

## Bước 1 tự kiểm tra backend khi chưa có AWS

1. Mở PowerShell tại `D:\cloud-document-handover\backend`.
2. Cài/chọn JDK 21–25, chuẩn bị PostgreSQL và role riêng theo `backend/README.md` nếu máy chưa có. Tạo một database thử mới do role đó sở hữu, ví dụ chạy SQL sau bằng tài khoản có quyền tạo DB:

```sql
CREATE DATABASE handover_week3_test OWNER handover;
```

`handover` trong ví dụ là role bạn đã tạo theo README, không phải mật khẩu. Nếu role có tên khác thì thay tương ứng. Không dùng DB chung hoặc chứa dữ liệu cần giữ: integration tests TRUNCATE dữ liệu nghiệp vụ trước từng ca.

3. Cấu hình terminal và chạy đúng bộ bàn giao:

```powershell
$env:DB_URL='jdbc:postgresql://127.0.0.1:5432/handover_week3_test'
$env:DB_USERNAME='handover'
$week3Password = Read-Host 'Mat khau role PostgreSQL' -AsSecureString
$env:DB_PASSWORD = [System.Net.NetworkCredential]::new('', $week3Password).Password
$env:RUN_DB_TESTS='true'
try {
    .\mvnw.cmd -B -ntp '-Dtest=HandoverIntegrationTest' test
} finally {
    Remove-Item Env:RUN_DB_TESTS -ErrorAction SilentlyContinue
}
```

Mong đợi BUILD SUCCESS, 0 failures/errors/skipped; số ca của lớp có thể tăng sau các đợt bổ sung C06/C07. Đọc evidence tuần 5 cho bản chốt, con số 12 trong báo cáo tuần 3 là snapshot lịch sử. Test tự tạo người dùng, dự án, dữ liệu phiên bản mẫu và khởi động Tomcat cổng ngẫu nhiên. Không cần bật app thủ công hoặc có tài khoản AWS. HEAD/URL S3 trong test là fixture `.invalid`, không phải file tải thật.

4. Để chạy toàn bộ hồi quy, dùng DB thử phù hợp, đặt lại RUN_DB_TESTS=true rồi chạy `mvnw.cmd -B -ntp verify`. Kết quả lần làm việc này nằm trong `evidence/week-03/backend/README.md`; đọc đúng kết quả thực tế nếu có sửa code sau đó.

Nếu gặp lỗi: connection refused → kiểm tra PostgreSQL/cổng; password authentication failed → kiểm tra role/password; CREATE DATABASE permission denied → dùng tài khoản quản trị để tạo DB thử; chỉ SKIPPED → kiểm tra RUN_DB_TESTS. Nếu build không tải được dependency, cần kết nối Maven Central. Không đổi DB_URL sang DB chung để xử lý lỗi.

## Bước 2 lấy đầu vào từ các bạn

Bạn gửi tin nhắn và lấy phản hồi giúp; công cụ chưa liên hệ thành viên nào. Có thể dùng nguyên nội dung sau:

**Gửi Đăng — adapter S3/Lambda**

> Dũng đã có backend upload và bàn giao tuần 3 qua StoragePort. Bạn gửi giúp nhánh/commit adapter, cách đăng ký bean và cấu hình cần thiết. Cần HEAD/GET đúng Version ID, presigned PUT ký Content-Type và If-None-Match, đọc JSON checksum theo schema/result-key đã đề xuất. Mình cần bộ file/log mẫu để đối chiếu hash và thử gói vẫn giữ v1 khi upload v2. Bạn xác nhận giúp phần nào đã chạy AWS thật và phần nào chưa.

**Gửi Chiến — môi trường AWS**

> Backend đã có luồng DRAFT → READY → CONFIRMED và thu hồi cơ bản. Nhờ bạn xác nhận môi trường thử, region/bucket Versioning, IAM/CORS, S3 notification, DB/backend/HTTPS và đường lấy log. Bạn phụ trách triển khai bản nhóm đã duyệt; mình phối hợp kiểm tra API. Gửi vị trí runbook/cấu hình, không đưa secret vào Git hoặc tin nhắn nhóm.

**Gửi Nam — giao diện**

> OpenAPI đã có API tạo/xem/phát hành gói, download item, xác nhận và revoke. Nhờ bạn review và ghép màn hình Owner/người nhận. Người nhận có thể ngoài dự án nhưng chỉ được truy cập gói được chỉ định. Draft được chọn file AVAILABLE đang chờ checksum, nhưng publish phải chặn đến khi VERIFIED. Mình cần chạy E2E với bạn sau khi adapter/môi trường sẵn sàng.

Đầu vào cần giữ lại: tên nhánh/commit, hướng dẫn chạy, cấu hình không chứa secret, người phụ trách và phần nào đã/chưa kiểm chứng. Chưa có phản hồi thì vẫn tiếp tục test/backend và chuẩn bị dữ liệu; không tự ghi nhóm đã đồng ý hợp đồng.

## Bước 3 ghép và kiểm tra khi đã có adapter

1. Đối chiếu mã Đăng với `StoragePort.java` và `contracts/s3-adapter-contract.md`. Nếu tên/chữ ký khác, tạo wrapper phù hợp sau khi thống nhất; không copy đè phần của Đăng. Không đưa fixture test vào app local/AWS để làm demo thành công giả.
2. Chiến cung cấp môi trường/cấu hình an toàn; backend dùng storage thật. Thiếu adapter hoặc bucket phải báo 503 ở thao tác storage. Thu hồi DB logic không có nghĩa byte S3 đã bị xóa.
3. Nam thực hiện browser: tính SHA-256 → init → PUT kèm signed headers → lấy nguyên Version ID → complete → polling. Đăng/Chiến xác minh chữ ký, CORS, event và JSON checksum thật.
4. Owner chọn phiên bản và người nhận → tạo DRAFT → publish READY → người nhận đăng nhập, tải → confirm. Publish/confirm/revoke không gửi request body; mọi POST dùng session và CSRF token đúng.
5. Dũng đối chiếu DB/API và log; lưu commit, thời điểm, mong đợi/thực tế và PASS/FAIL. Chỉ ghi AWS PASS cho ca thật sự chạy.

## Bước 4 kịch bản nghiệm thu chung

| Ca | Kết quả cần thấy |
| --- | --- |
| Hash đúng, một phiên bản | VERIFIED; publish được READY; người nhận tải đúng file và confirm |
| Checksum thiếu/sai/hash mismatch | Không phát hành được; không tự gán VERIFIED phía client |
| Hai người nhận | Người đầu xác nhận: gói READY; người cuối xác nhận: CONFIRMED |
| Người ngoài danh sách | Không xem/tải/xác nhận gói; người nhận ngoài project vẫn không xem project |
| Upload v2 sau phát hành v1 | Download từ gói vẫn trả đúng v1 |
| Gói hết hạn/thu hồi | Không cấp URL hoặc xác nhận mới; URL đã cấp có thể còn dùng đến TTL |
| Publish/confirm lặp hoặc đồng thời | Không đổi phiên bản, không ghi nhận/audit trùng |
| HEAD/S3 lỗi hoặc object bị mất | API báo lỗi, không phát hành/cấp URL thành công giả |

Bạn cần thống nhất với nhóm bản lịch Word hay PDF được dùng để báo cáo và xin người kiểm tra chéo xác nhận kết quả. Đây là quyết định nhóm và nghiệm thu thực tế, không thể suy ra từ việc test local đạt. Các phần AWS Lab, ngân sách, cấu hình tài nguyên và giao diện vẫn theo phân công của Chiến/Đăng/Nam.
