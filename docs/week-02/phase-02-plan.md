# Kế hoạch tuần 2 Phase 2

**Cập nhật 28/10/2026:** sáu bước backend đã được triển khai qua StoragePort và kiểm thử; xem [báo cáo hiện tại](backend-completion.md). Nội dung ngày 22/10 bên dưới là kế hoạch gốc. AWS adapter, AWS POC và phê duyệt tích hợp vẫn chưa có; không dùng bản kế hoạch làm bằng chứng AWS hoàn thành.

Ngày 22/10/2026, Dũng, branch dung. Đây là kế hoạch, **không có code nghiệp vụ Phase 2 được triển khai trong task kiểm tra cuối**. Cơ sở: [thiết kế Phase 1](phase-01-upload-contract.md), [đề xuất adapter](../../contracts/s3-adapter-contract.md), OpenAPI 0.2.0-phase1-draft. Không triển khai bàn giao tuần 3.

## Trình tự và tiêu chí nghiệm thu

| Bước | Nội dung | Điều kiện hoàn thành / kiểm thử dự kiến | Có thể bắt đầu khi nào |
| --- | --- | --- | --- |
| 1. UploadSession service | Repository/session-state, deadline, ownership, immutable identity; dùng status FileVersion thay thêm bảng/trạng thái tùy tiện | PENDING chỉ sang AVAILABLE/FAILED/EXPIRED một lần; terminal không hồi sinh; không đổi identity sau AVAILABLE; không cần AWS | Bắt đầu phần nội bộ với PostgreSQL thật, Clock kiểm soát cho test |
| 2. Request Upload API | DTO strict, optional fileId, validate project/file/no-rename; tx tạo metadata/version/session và reserve; ký URL sau commit | Không tin filename làm ID; cross-project 404; viewer 403; failed validation không ghi row; response khớp OAS; presign lỗi không để reservation vô hạn | Phát triển với fake port dự kiến; Nam/Đăng review trước ghép UI/adapter thật |
| 3. Quota concurrent và expiry | Khóa project → session/version, reserve/move/release cùng tx; expire tối thiểu khi init và tác vụ bounded cho session mồ côi | N request đồng thời chỉ reserve trong phần quota còn; counter không âm; complete/expire race không double move/release; DB rollback không để row/counter lệch | Bắt đầu ngay, dùng PostgreSQL thật và barrier/latch, không mock JDBC để chứng minh locking |
| 4. Complete Upload API | Snapshot + HEAD exact ref ngoài tx; khóa và kiểm lại quyền/status/deadline sau HEAD; same-ID idempotent | Same ID 200 kể cả deadline qua; khác ID 409; pending expired 409/release; missing giữ pending; outage 503; sai size/type FAILED; integrity còn pending | Logic với fake bắt đầu ngay; tích hợp storage sau chốt outcome/chữ ký với Đăng |
| 5. List Files và Download | Một item mỗi FileVersion, nhóm bằng fileId, sort/paging ổn định; quyền hiện tại; download AVAILABLE + VERIFIED và exact HEAD/GET | Không lộ cross-project; không lấy latest; pending/mismatch/failed không tải; presign không được dùng thay bằng chứng existence; không log URL | Query/quyền làm ngay; Nam review grouping và Đăng review presignGet/HEAD trước ghép thật |
| 6. Integration tests | JUnit domain + DB/HTTP với fake S3, rồi bộ AWS opt-in tách riêng | CI mặc định không cần credential; AWS thiếu cấu hình ghi NOT RUN/SKIPPED và không gộp thành AWS PASS | Thiết kế fixture/test matrix ngay; AWS suite chờ gate và môi trường được phép |

Bước 3 là điều kiện của bước 2 và 4 trước khi chúng được coi hoàn thành; thứ tự bảng là phân rã công việc, không cho phép phát hành init trước khi quota an toàn. Integrity reconcile tối thiểu theo GET upload state là phần hỗ trợ bước 5: test bằng fixture checksum từ fake; chưa có VERIFIED thật cho download khi Lambda chưa tích hợp. Không thêm endpoint nhận checksum từ browser hoặc nút tự đánh dấu VERIFIED.

## Transaction và lỗi giữa DB với storage

1. Init dùng thời gian chuẩn thống nhất, kiểm size bằng `size <= quota - used - reserved` (BIGINT, chặn overflow). Khóa project, kiểm lại quyền, expire các PENDING đã hết hạn trong project theo thứ tự cố định, reserve và insert trong cùng transaction. Không giữ khóa qua lời gọi storage.
2. Ký URL sau commit, hạn không vượt session.expires_at; không kéo dài session trên retry. Presign thất bại rõ ràng: transaction bù chỉ chuyển PENDING → FAILED/release một lần. Mất HTTP response sau cấp URL là kết quả chưa rõ: giữ reservation tới expiry, không đoán browser chưa nhận. Nếu transaction bù cũng lỗi, expiry reconciliation phải thu hồi về sau.
3. Complete đọc identity kỳ vọng từ DB, HEAD exact ref, rồi khóa project → session/version và kiểm lại status/quyền/deadline bằng thời gian hiện tại sau chờ khóa. Không dùng transaction-start timestamp cũ làm bằng chứng còn hạn khi đã chờ lâu. Có thể Clock injectable cho test; chọn nguồn thời gian production nhất quán trước code.
4. Với PENDING, update trạng thái/counter/completed_at cùng transaction; kiểm row count/CAS. Nếu race đã AVAILABLE cùng ID trả persisted state, ID khác conflict. Đừng ném exception gây rollback mất EXPIRED/release: commit transition rồi map outcome sang 409 ở biên HTTP.
5. Expiry reconciliation dùng cùng thứ tự khóa. Job chọn candidate rồi khóa project trước, đọc lại session; không giữ khóa session trước project. Deadline hết chỉ thu hồi reservation logic, không có nghĩa S3 sạch. Quota tính mọi version đã giữ, kể cả integrity FAILED/MISMATCH.
6. Danh tính AVAILABLE bất biến qua mọi writer; V1 có constraint nhưng không có trigger khóa mọi UPDATE. Test phải thử upload v2 và mọi đường retry để v1 không đổi. Nếu cần thay DB, trình bày trade-off và tạo Flyway V2 mới, không sửa V1.

Không thêm distributed transaction, outbox hoặc job platform. Expire bounded trên scheduler Spring cùng ứng dụng và lazy expire khi init là đủ cho MVP; một nguồn transition idempotent để cả hai cùng gọi. Việc xử lý project không có request mới là lý do cần scheduler tối thiểu. Tần suất/batch cấu hình, không quét và khóa toàn bộ DB trong một transaction.

## Test độc lập bằng fake adapter

Fake chỉ được bind trong test profile; ứng dụng chạy AWS không fallback sang fake khi mất storage. Dùng một port SDK-independent theo đề xuất hợp đồng, có thể chỉnh chữ ký sau review; fake lưu object bằng tuple bucket/key/version, giữ riêng v1/v2, điều khiển latency/error/checksum. Fake không cần HTTP PUT/S3 emulator nâng cao.

| Tầng | Trường hợp cần bao phủ | Chứng minh được | Không chứng minh |
| --- | --- | --- | --- |
| Unit/state với fake và Clock | Deadline trước/đúng/sau; repeated complete; state/integrity độc lập; malformed checksum/wrong version/hash; terminal race | Quy tắc service khi nhận outcome được định sẵn | AWS thực sự trả outcome đó |
| PostgreSQL integration | Quota concurrent, complete/expire race, rollback/compensate, project isolation, identity v1 giữ nguyên khi tạo v2 | SQL locking, transaction, constraint và counter thực | Quota byte vật lý S3 |
| HTTP JAR + DB + fake test profile | Request/complete/list/download/state, CSRF, disabled account, 400/403/404/409/415/503, OAS response | End-to-end backend nội bộ theo contract | Browser CORS/signature/AWS IAM |
| AWS opt-in, ghi evidence riêng | Conditional PUT lặp/đồng thời, altered headers, exact version HEAD/GET, CORS, Lambda checksum, invalid/oversize/late upload, cleanup | Chỉ những case thực sự chạy trên tài nguyên thử được phép | Case chưa chạy, production hoặc hard quota tổng nếu chưa đo/chặn được |

Mỗi suite ghi PASS/FAIL/SKIPPED/NOT RUN riêng. Upload byte dùng fake không được mô tả là upload S3 thật. Với request đồng thời, dùng nhiều transaction/connection PostgreSQL và đồng bộ lúc bắt đầu; không chỉ chạy vòng lặp tuần tự hoặc chỉ assert method mock được gọi.

## Gate review và khả năng bắt đầu

- **Dũng bắt đầu được:** session/state/repository, quota/expire transaction, quyền/query, fake-driven complete/integrity, DB concurrency tests. V1 đủ dữ liệu cho hướng hiện tại; chưa cần migration.
- **Nam xác nhận trước ghép UI:** optional fileId/no-rename/one-item-per-version, init không idempotent, 412 hoặc mất Version ID phải upload lại và chờ quota cũ hết hạn; CSRF refresh, trạng thái available/verified; giới hạn file/TTL.
- **Đăng xác nhận trước ghép adapter:** signatures/outcomes/timeouts, exact version và checksum result-key/schema, phương thức ký conditional header, recovery đơn giản và error mapping.
- **Chiến cùng Đăng xác nhận trước bật AWS upload:** versioning/IAM/CORS, quyền không xóa/tái dùng key, conditional PUT POC, size/TTL/credential, late/orphan cleanup và chi phí. Nếu không dùng được conditional, nhóm phải chấp nhận phương án kiểm soát khác trước bật thật; không tự chuyển sang replayable.

Không có blocker cho phần backend độc lập. Có gate bắt buộc cho tích hợp AWS, UI và tuyên bố hoàn tất Phase 2. Quyết định làm đổi schema/API lớn phải trình phương án/trade-off trước thực hiện. Không tự ghi các thành viên đã duyệt và không nhắn cho họ trong task này.
