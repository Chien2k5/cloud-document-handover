# Ghi nhận đóng góp dự án theo bằng chứng

Ngày lập: 10/11/2026. Phạm vi bản tích hợp `dung@d0d8141ee037e14bc154237385d6f971689cf0b3`.
Đây là bản ghi nhận có truy vết để nhóm review, không thay thế biên bản đồng thuận
hoặc kết quả chấm điểm. Không đưa số giờ thực tế, tỷ lệ hoặc chữ ký không có bằng chứng.
Phương pháp, trạng thái chưa xác minh và chi tiết đối chiếu: [contribution-audit.md](contribution-audit.md).

## 1. Phân công ban đầu

Nguồn: kế hoạch 5 tuần do người dùng cung cấp, tên và SHA-256 ghi trong audit;
[PRINCIPLE.MD](../../PRINCIPLE.MD) xác định phạm vi Git. Phân công không đồng nghĩa
mọi đầu việc dưới đây đã hoàn thành hoặc thành viên đó là tác giả mọi file trong module.

| Thành viên | Phân công theo kế hoạch |
| --- | --- |
| Hoàng Hải Chiến | Nhóm trưởng; AWS/Beanstalk/IAM, DB độc lập, backup/restore, chi phí, điều phối và hồ sơ nộp |
| Lê Hải Đăng | S3/presigned URL, Version ID, Lambda/checksum; có nhánh Nextcloud local theo giai đoạn thiết kế cũ |
| Nguyễn Huy Dũng | Spring Boot, PostgreSQL, hợp đồng/API, quyền và quy trình bàn giao |
| Phạm Thành Nam | React/giao diện, E2E, README và video demo |

## 2. Nguyễn Huy Dũng — đóng góp đã xác minh

### Backend, kiến trúc và API

Chuỗi commit Git dưới tên `HuyDung`, được đối chiếu với source và evidence:

- [`ef79ee3`](https://github.com/Chien2k5/cloud-document-handover/commit/ef79ee3e0019e63b030fd5c405e2ac15ef5252b9): khung Spring Boot/PostgreSQL/Flyway,
  schema V1, OpenAPI và nền auth/project/membership.
- [`bd4a897`](https://github.com/Chien2k5/cloud-document-handover/commit/bd4a89701852d76395e283406b59b20206ce2333): upload qua StoragePort, quota,
  reservation/expiry, complete theo version và đối soát checksum.
- [`a44a78a`](https://github.com/Chien2k5/cloud-document-handover/commit/a44a78aba12be5dba6a60cce3ff2832982b99896): nghiệp vụ gói, quyền người nhận,
  publish/confirm/download/revoke, pin phiên bản và audit.
- [`3a2c32f`](https://github.com/Chien2k5/cloud-document-handover/commit/3a2c32f4451aeae70a9e89f78c18a411cc15cb86) và
  [`6f5bf9d`](https://github.com/Chien2k5/cloud-document-handover/commit/6f5bf9dc9c2932a8845e59389c262c61eb74a8c3): hồi quy quyền/concurrency/revoke/audit,
  công cụ và evidence backup/restore **local**, tài liệu/gói source.
- [`41673ca`](https://github.com/Chien2k5/cloud-document-handover/commit/41673cabf1ed4f894312a92d136f36c4355e44ca): adapter S3 Java có timeout/read limit,
  yêu cầu AVAILABLE+VERIFIED khi tạo DRAFT, uploadId bền vững, OpenAPI 0.5.0 và 62 test.

Các hạng mục thực tế nằm trong [backend](../../backend/), [contracts](../../contracts/),
[hướng dẫn tích hợp](../backend-integration-2026-11-08.md),
[evidence backend](../../evidence/backend-2026-11-09/README.md).
Đây là bằng chứng source/commit thuộc dòng đóng góp Dũng; không tự kết luận phương
thức viết tay hay mức sử dụng công cụ AI của từng commit lịch sử chưa được ghi nhận.

### Review, điều phối kỹ thuật và khắc phục tích hợp

- Commit `292f890` lưu xác nhận luồng upload của Nam; `b95bc0c` phân tích POC Đăng.
  Các tài liệu review là đầu ra kỹ thuật riêng, không chỉ tính code nghiệp vụ.
- Dũng yêu cầu Codex đọc source Nam, đối chiếu API và phát hiện `app.js` rỗng,
  form DRAFT thiếu field, chưa có API client/session/CSRF/S3/polling. Kết luận được
  đối chiếu với source gốc `00bc97b`, không dựa riêng vào nhãn branch.
- Dũng cung cấp đặc tả 6 giai đoạn, yêu cầu Git/worktree an toàn, checkpoint/test/push,
  contract backend làm nguồn sự thật và không sửa backend để lách frontend.
- [`629b364`](https://github.com/Chien2k5/cloud-document-handover/commit/629b3649ffe0153cee5b70bce63600a5c71b1093): theo yêu cầu Dũng, Codex sửa phần
  JSON/results/duplicate/stream/size/version/timeout của Lambda/reader dựa trên code gốc Đăng,
  thêm 25 test và 12 ca Java. Không quy toàn bộ bản sửa này cho Đăng vì tên nhánh.
- Các merge `3a176c1`, `95a108a` và `e58a382` đưa Nextcloud/S3 vào dung, giữ lịch sử;
  port Nextcloud 8081 và hướng dẫn local được hoàn thiện qua Codex theo yêu cầu Dũng.

### Tổ chức frontend với Codex, kiểm thử và tích hợp PR

Sáu checkpoint dưới đây là phần triển khai mới do **Dũng chủ động tổ chức bằng
Codex**. Codex trực tiếp sinh/sửa code và thực thi test/Git theo đặc tả; Dũng đưa
yêu cầu, các điều kiện nghiệm thu và quyết định chấp thuận tích hợp. Git author vẫn
là `HuyDung`/tài khoản `nguyenhdung2006` theo cấu hình có sẵn, không bị đổi thành Nam.

| Checkpoint | Commit | Đầu ra |
| --- | --- | --- |
| 1 | `dd31191` | React/Vite, auth/session/CSRF |
| 2 | `f5e3d45` | Project/membership, role-aware UI |
| 3 | `2b07b00` | SHA-256, signed PUT, complete/polling |
| 4 | `c5a2b2f` | Version list, recovery sau reload, download |
| 5 | `35a74ff` | DRAFT/publish/confirm/revoke/expiry |
| 6 | `0f77a23` | Test, tài liệu, bằng chứng và sửa lỗi hồi quy |

[PR #3](https://github.com/Chien2k5/cloud-document-handover/pull/3) được merge bằng
merge commit [`d0d8141`](https://github.com/Chien2k5/cloud-document-handover/commit/d0d8141ee037e14bc154237385d6f971689cf0b3),
actor GitHub `nguyenhdung2006`, qua Codex dưới ủy quyền rõ của Dũng. Cả sáu SHA gốc
được giữ làm ancestor; không squash/rebase/amend, không xóa branch. `main` không đổi.

Dũng tự xác nhận đã thử local và chấp thuận trong yêu cầu hiện tại. Hoạt động chạy
test tự động và kiểm tra GitHub được Codex thực thi. Không ghi nhận rằng Dũng tự gõ
mọi dòng frontend, tự bấm mọi lệnh hoặc Nam/Chiến đã review PR khi chưa có review.

Trước **và sau merge**, chạy đạt: 17 unit frontend, 17 browser MOCK, 62 backend với
PostgreSQL mới (0 fail/error/skipped), 3 browser LIVE API, 25 Python MOCK và 12 ca
Java/Python contract. npm ci/lint/build/audit đạt; source tracked không đổi qua test.
Browser LIVE chỉ auth/project/membership và 503 khi S3 tắt. AWS E2E **NOT_RUN**.
Chi tiết SHA, phạm vi và artefact đối chiếu ở audit và [test report](../pilot/test_report.md).

Nhánh local thử nghiệm `codex/backup-aws-mvp@7e7a390` có source khác của Dũng theo
Git; chưa nằm trong origin/dung hoặc PR #3. Không lấy artefact local đó để tuyên bố
nhóm đã deploy/backup/restore AWS hoặc tính thêm công trạng phát hành trùng lặp.

## 3. Phạm Thành Nam — frontend ban đầu

Commit [`00bc97b`](https://github.com/Chien2k5/cloud-document-handover/commit/00bc97bee99d7ed9d620ea4f4a499124a099fb07)
dưới tài khoản `tnam1304` chứa `frontend/index.html`, `styles.css`, `app.js` rỗng
và ba tài liệu `docs/pilot/`. HTML có các form và các bước nghiệp vụ; CSS/bố cục
được dùng làm đầu vào cho bản mới. Đây là đóng góp frontend ban đầu có bằng chứng.

Không có bằng chứng trong nhánh đó cho một frontend React/API/SHA-256 chạy được;
không gán sáu checkpoint mới cho Nam. Các PASS T01–T05, mô tả 8 tài khoản/pilot và
phản hồi cũ chưa có bằng chứng tái lập nên được phân loại lịch sử **CHƯA XÁC MINH**,
không suy thành gian lận cá nhân hoặc kết luận không có công việc ngoài GitHub.
Video, thiết kế/công việc khác chưa được cung cấp có thể bổ sung sau.

## 4. Lê Hải Đăng — Nextcloud và S3/Lambda gốc

- `15085aa`, [`c83f36a`](https://github.com/Chien2k5/cloud-document-handover/commit/c83f36ac40f663c509afb4beb599b9a85d2873d4),
  [PR #1](https://github.com/Chien2k5/cloud-document-handover/pull/1): Nextcloud local,
  PostgreSQL/Redis Compose, cấu hình môi trường và notes quyền/quyết định.
- [`4368343`](https://github.com/Chien2k5/cloud-document-handover/commit/4368343d89beab58083256bb735c46fc7ffb7703),
  [`15973c3`](https://github.com/Chien2k5/cloud-document-handover/commit/15973c334e0dbc19e2965fa1897ce5a3faa9a8ef),
  [PR #2](https://github.com/Chien2k5/cloud-document-handover/pull/2): adapter Python,
  Lambda SHA-256/idempotency ban đầu và sửa encode Version ID.

Git/PR/source xác minh phần gốc; các tuyên bố AWS POC trong README cũ chưa được
chạy lại cho worker mới. Commit `629b364` là phần sửa tích hợp Dũng/Codex, không
thay đổi attribution của source gốc Đăng. Java adapter trong backend không gọi
Python POC; JSON/key là điểm nối Lambda với Java.

## 5. Hoàng Hải Chiến — khởi tạo và trách nhiệm hạ tầng

Lịch sử `origin/main` dưới `Chien2k5` xác nhận khởi tạo repo và tài liệu nền:
`b0aa708`, `5e63bf5`, `0680113`, `94a4979`, `0e70ee2` cùng các cập nhật README.
Đây là công sức tổ chức repository có bằng chứng, được ghi nhận riêng.

AWS/Beanstalk/IAM, DB độc lập, backup/restore Cloud, CloudWatch/chi phí và điều phối
theo kế hoạch vẫn là trách nhiệm được giao; chưa có bằng chứng đủ để đánh dấu đã
hoàn tất trong audit này. Không gán code local `infra/` của người khác cho Chiến
chỉ vì Chiến được giao hạ tầng. Không coi việc chưa có bằng chứng là phủ định
công việc ngoài repo; nhóm có thể bổ sung tài nguyên/log/biên bản đã khử secret.

## 6. Sử dụng AI và điều kiện cập nhật

Codex được dùng minh bạch trong review, sinh/sửa frontend tích hợp, test, sửa S3
liên thông và release/docs theo yêu cầu Dũng trong phiên. AI không phải bằng chứng
Dũng tự viết tay từng dòng, cũng không xóa bỏ công sức đặc tả, tổ chức, kiểm thử,
chịu trách nhiệm và ra quyết định của Dũng. Đối với các commit lịch sử không có
phiên thực hiện để đối chiếu, phương thức dùng AI/viết tay **CHƯA XÁC MINH**.

Không dùng LOC, tên folder, số commit hoặc giờ kế hoạch để tự suy tỷ lệ. Muốn có
tỷ lệ/chấm công cần phương pháp và xác nhận riêng của nhóm/người dùng trước khi
đưa vào báo cáo chính thức. Báo cáo cũ không bị sửa để áp đặt kết luận mới.

Nguồn kiểm chứng: [audit](contribution-audit.md), [PR #3](https://github.com/Chien2k5/cloud-document-handover/pull/3),
[checkpoints](../pilot/checkpoints.json), [live verification](../pilot/live-verification.json),
[backend evidence](../../evidence/backend-2026-11-09/verification.json),
[Lambda evidence](../../aws/verification-2026-11-09.json),
[hồ sơ backend lịch sử](../week-05/contributions.md).
