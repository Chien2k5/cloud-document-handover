# Báo cáo chốt backend tuần 5 của Dũng

Ngày 29/10/2026, nhánh dung trên nền 3a2c32f. Phạm vi: rà soát C07, hồi quy, khắc phục công cụ thử, tài liệu/config và đóng gói phần backend. Mục tiêu là bàn giao phần có thể kiểm chứng độc lập; chưa có adapter/UI/môi trường chung để nghiệm thu Cloud.

## Kết quả đã kiểm chứng

| Nội dung | Kết quả | Phạm vi |
| --- | --- | --- |
| Maven verify với RUN_DB_TESTS=true | 51/51 PASS, 0 failures/errors/skipped | PostgreSQL thật, 3 unit filter + 10 nền tảng + 4 contract + 13 upload + 21 handover |
| C07 revoke/audit bổ sung | 3 ca mới PASS | Revoke gói CONFIRMED đồng thời; audit lỗi rollback; HTTP dùng actor/requestId server |
| HTTP JAR smoke | 48/48 request checks PASS | Auth/CSRF/quyền và thiếu storage adapter phải fail closed |
| HTTP JAR regression | 70/70 request checks PASS | Strict JSON, 415/406, disabled account/public/logout và session expiry thật |
| Backup/restore bản chốt | PASS, 11 bảng/hash khớp, 18 FK validated | Hai DB local mới, target không seed, quota/manifest/confirmedAt giữ nguyên |
| HTTP nguồn/đích restore | 51 request checks PASS | Đăng nhập trên DB đã restore, quyền và state; storage trả 503 vì thiếu adapter |
| API/production service/schema | Giữ nguyên | Không thêm endpoint, dependency, migration hoặc sửa V1 |
| Tài liệu và gói bàn giao | Đã chuẩn bị và có tool kiểm | README hiện tại, hướng dẫn, checklist, demo, đóng góp, source ZIP/manifest theo commit |
| A07/B05/D05 toàn nhóm và AWS G5 | Chưa nghiệm thu | Chưa có dữ liệu/adapter/UI/môi trường để chạy thực |

Không cộng test methods và request assertions thành số kịch bản độc lập. Kết quả storage fixture không phải S3/Lambda PASS.

## Rà soát và thay đổi

- C07 đã có nghiệp vụ từ tuần 3. Tuần 5 xác minh thêm 5 revoke đồng thời của gói CONFIRMED chỉ một audit, giữ workflow/lịch sử; lỗi audit rollback accessStatus; requestId do server sinh và actor từ session. Không phát hiện lỗi service mới trong các ca đã chạy.
- Công cụ restore gặp lỗi too many clients khi chạy song song trên cluster fixture nhỏ. Đã giới hạn pool **chỉ trong JAR do script thử khởi động** ở max 3/min idle 1 và chạy lại đạt. Không sửa pool production. --evidence-dir cho phép lưu lượt chốt vào tuần 5, giữ evidence tuần 4 riêng.
- README root đã bỏ hướng dẫn Nextcloud cũ và link chưa có gây nhầm, thay bằng trạng thái backend S3 hiện tại và đầu mối tài liệu. PRINCIPLE/nhánh Nextcloud cũ vẫn do nhóm đồng bộ, không tự thay quyết định hay phê duyệt của thành viên khác.
- Tên biến upload ở root .env.example được đồng bộ với backend/.env.example; giữ giá trị secret rỗng. Cách chạy, thiếu adapter, profile local, session và giới hạn được giải thích rõ.
- Thêm build_handover_bundle.py: chỉ lấy tracked source/evidence được chọn trên commit sạch; loại runtime/secret/dump/JAR/symlink, kiểm pattern hỗ trợ review, ghi manifest và kiểm lại CRC/hash ZIP. output được Git ignore. Gói chỉ là phần Dũng, không có frontend/Lambda/AWS chưa được cung cấp.

## Hồ sơ bàn giao

- [Hướng dẫn kỹ thuật](final-handover.md): kiến trúc, biến môi trường, API, cách build/run/test/restore, StoragePort và giới hạn.
- [Checklist](acceptance-checklist.md): các mục đã kiểm local và các gate Cloud còn lại.
- [Kịch bản demo](demo-script.md): tách local fixture và lượt E2E thật khi nhóm sẵn sàng.
- [Đóng góp theo commit](contributions.md): lịch sử có thể đối chiếu, không tự ghi số giờ làm việc hoặc thành tích Cloud.
- [Evidence cuối](../../evidence/week-05/backend/README.md), [biên bản restore](../../evidence/week-05/local-restore/restore-report.md).
- Source bundle tạo sau commit ở output/backend-handover-dung.zip; BUNDLE-MANIFEST và sidecar ghi commit/size/SHA. Kết quả build từ ZIP giải nén đối chiếu qua sidecar output; không dùng lượt build thiếu DB để ghi PostgreSQL PASS.

## Trạng thái phối hợp

Đã đọc GitHub ngày 29/10: main vẫn 0e70ee2, dung trước bản chốt là 3a2c32f; nhánh c83f36a chỉ chứa Nextcloud cũ. Chưa thấy adapter S3/Lambda hoặc frontend mới trên các nhánh được truy cập. infra/deploy/ops README trống; không có endpoint, cấu hình AWS hoặc chi phí thực để kiểm. Việc thành viên đang làm riêng chưa push phải được họ xác nhận.

Chiến cần cung cấp môi trường/triển khai/backup S3/log/chi phí; Đăng cung cấp adapter/Lambda và hồi quy version; Nam ghép UI, clip/demo và gói nộp toàn nhóm. Dũng phối hợp chạy lại và kiểm tra chéo bản tích hợp. Không gửi tin nhắn tự động, tự merge main hoặc deploy AWS trong lần chốt này.

Phần backend/local tuần 5 đã có nguồn, kiểm thử và hướng dẫn bàn giao. G2–G5 Cloud chưa đủ bằng chứng để đánh dấu hoàn thành; chỉ chốt khi nhóm có lượt chạy thật và xác nhận nghiệm thu.
