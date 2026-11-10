# Audit đóng góp và tích hợp PR #3

Ngày kiểm tra: 10/11/2026 (Asia/Saigon). Audit nguồn trước merge được thực hiện
trên `dung@e58a382a1ac7de1094312baa1797de34bf772ac2` và PR #3 tại
`0f77a234033afd6fd38d258b09bf16588ea6d333`. Phần kết quả sau merge được bổ sung
sau khi chạy lại trên chính commit mới. Đây là báo cáo bằng chứng kỹ thuật,
không phải bảng chấm điểm, xác nhận chéo của cả nhóm hoặc kết luận ai gõ từng dòng.

## 1. Phương pháp và giới hạn

- Đối chiếu Git commit author/committer, diff, nội dung file, branch comparison,
  PR #1/#2/#3, test evidence và lịch sử yêu cầu của Dũng trong phiên Codex.
- `Git author` xác minh danh tính được ghi trong commit; không tự chứng minh công
  việc viết tay, số giờ hoặc mức độ sử dụng AI. Không sửa author/committer cũ.
- Trách nhiệm được giao, source đã commit, hoạt động dùng Codex và nghiệm thu là
  bốn loại thông tin riêng. Thiếu chứng cứ dùng **CHƯA XÁC MINH**, không suy từ folder.
- Kế hoạch người dùng cung cấp: `KE_HOACH_5_TUAN_NHOM_5_BAN_DE_DOC.docx`, SHA-256
  `6e537f8376c06f36034ecfa91a2b21d72e6de6e319f26fd17827fab9379640c3`.
  Bản đọc nằm ngoài Git; tên/hash giúp đối chiếu, không ngụ ý có biên bản ký duyệt.
  Không sử dụng giờ ước lượng trong kế hoạch làm giờ thực tế.
- `PRINCIPLE.MD` quy định phạm vi/review/merge/deploy; còn thuật ngữ Nextcloud cũ.
  Kế hoạch 5 tuần hiện tại xác định React, Spring Boot, PostgreSQL, S3/Lambda.
- Dũng tự khai đã test local và chấp thuận tích hợp trong yêu cầu ngày 10/11.
  Ghi nhận đây là quyết định/chứng thực của người dùng, không giả chữ ký Nam/Chiến
  hoặc suy đó là bằng chứng toàn bộ AWS E2E đã đạt.

## 2. Bảng đối chiếu thành viên

| Thành viên | Công việc được giao | Công việc đã xác minh | Vai trò thực tế | Bằng chứng | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| Nguyễn Huy Dũng | Spring Boot, PostgreSQL, API, quyền, bàn giao | Source backend/schema/contracts/tests và lịch sử nâng cấp; review tích hợp; tổ chức 6 checkpoint React với Codex; sửa contract Lambda bằng Codex; kiểm thử và tích hợp | Tác giả Git `HuyDung`/tài khoản `nguyenhdung2006`; người đưa đặc tả, tổ chức công cụ AI, quyết định chấp thuận; Codex trực tiếp sinh/sửa và chạy test trong phiên được ủy quyền | `ef79ee3`, `bd4a897`, `a44a78a`, `3a2c32f`, `6f5bf9d`, `41673ca`, `629b364`; 6 checkpoint dưới đây; PR #3; evidence backend/pilot | Source/Git/test đã xác minh. Không khẳng định toàn bộ code được Dũng gõ tay; nghiệm thu local là xác nhận của Dũng, không phải nghiệm thu Cloud |
| Phạm Thành Nam | React/UI, E2E, README, video | Commit gốc có HTML form đăng nhập/upload/DRAFT/READY/CONFIRMED, CSS và 3 tài liệu pilot; `app.js` đúng 0 byte. CSS/bố cục gốc được tận dụng trong bản tích hợp | Người commit phần frontend ban đầu dưới tài khoản `tnam1304`; không có bằng chứng Nam viết 6 checkpoint React mới | [00bc97b](https://github.com/Chien2k5/cloud-document-handover/commit/00bc97bee99d7ed9d620ea4f4a499124a099fb07), `frontend/index.html`, `frontend/styles.css`, `docs/pilot/*` ở commit đó | Source ban đầu đã xác minh; PASS/pilot 8 tài khoản cũ, video, React/chức năng chưa push khác: CHƯA XÁC MINH |
| Lê Hải Đăng | S3, presigned URL, Version ID, Lambda/checksum; Nextcloud theo nhánh cũ | Nextcloud Compose/notes; adapter Python/Lambda ban đầu và sửa encode Version ID | Tác giả Git `Le Hai Dang` hoặc `ledangw29105-png`; chủ PR #1/#2. Bản sửa `629b364` thuộc Dũng/Codex, không tự gán lại cho Đăng vì nằm trên nhánh Đăng | `15085aa`, `c83f36a`, `4368343`, `15973c3`; [PR #1](https://github.com/Chien2k5/cloud-document-handover/pull/1), [PR #2](https://github.com/Chien2k5/cloud-document-handover/pull/2) | Source/Git đã xác minh. Các tuyên bố POC AWS lịch sử chưa được chạy lại/xác minh độc lập cho code mới |
| Hoàng Hải Chiến | Nhóm trưởng; AWS/Beanstalk/IAM, DB độc lập, backup/restore, chi phí, điều phối/nộp | Khởi tạo repository, README, `.gitignore`, `.env.example`, `PRINCIPLE.MD` trên main | Tác giả Git `Chien2k5` của các commit bootstrap; trách nhiệm triển khai theo kế hoạch là phân công, không tự coi đã xong | `b0aa708`, `5e63bf5`, `0680113`, `94a4979`, `0e70ee2`; `git log origin/main`; `infra/README.md`, `deploy/README.md`, `ops/README.md` hiện chưa có runbook triển khai trong bản kiểm | Bootstrap đã xác minh; AWS deployment/restore/CloudWatch/chi phí/nghiệm thu nhóm: CHƯA XÁC MINH trong bằng chứng được cung cấp |

Không có bằng chứng trong repo không đồng nghĩa thành viên chưa làm ngoài repo.
Nhóm có thể bổ sung source, log đã khử secret, PR hoặc biên bản để cập nhật audit.

## 3. Chi tiết đóng góp Dũng có bằng chứng

| Nhóm công việc | Thay đổi/bằng chứng kiểm tra được | Kết luận giới hạn |
| --- | --- | --- |
| Kiến trúc backend và schema | `ef79ee3`, `backend/pom.xml`, các package `auth/project/upload/handover/common`, migration `V1__initial_schema.sql`, ERD `docs/week-01/erd.mmd` | Git ghi HuyDung; source có Spring Boot/JdbcTemplate/Flyway/PostgreSQL. Cách viết tay/AI của các commit lịch sử chưa đủ bằng chứng |
| Auth/quyền và project | `SecurityConfig`, `ActiveAccountFilter`, `ProjectController/Service`, `BackendIntegrationTest` | Session/CSRF, membership Owner/Editor/Viewer, account disabled và cách ly project có source/test |
| Upload/phiên bản/quota/checksum | `bd4a897`, `41673ca`, `UploadService/Repository`, `StoragePort`, `S3StorageAdapter/Test` | Complete exact Version ID, quota/reservation, timeout, checksum schema, uploadId bền vững có source/test; AWS thật chưa chạy |
| Bàn giao/thu hồi | `a44a78a`, `6f5bf9d`, `41673ca`, `HandoverService/Test` | DRAFT yêu cầu AVAILABLE+VERIFIED, publish/confirm/revoke/expiry/audit có source và test |
| Contract và phối hợp | `contracts/openapi.yaml` 0.5.0, `docs/backend-integration-2026-11-08.md`, `292f890`, `b95bc0c` | Đã lưu contract, Nam flow confirmation và review POC Đăng; không coi tài liệu cũ là đồng ý mọi thay đổi sau này |
| Kiểm thử và restore local | `3a2c32f`, `6f5bf9d`, `evidence/week-04/local-restore/*`, `evidence/week-05/*`, `evidence/backend-2026-11-09/*` | Có artefact test/restore local; bản hiện tại được chạy lại trước/sau merge. Không đổi thành chứng nhận restore AWS |
| Review frontend ban đầu | Đối chiếu `00bc97b`: JS rỗng, DRAFT thiếu title/recipient/expiry, chưa có API client/session/CSRF/upload; yêu cầu Dũng và test report tại `0f77a23` | Review trong phiên do Dũng yêu cầu, Codex thực hiện phân tích. Không quy lỗi cá nhân ngoài trạng thái source đã thấy |
| Frontend tích hợp với Codex | 6 checkpoint Git HuyDung, PR #3, `docs/pilot/checkpoints.json`, `live-verification.json` | Dũng đặc tả/tổ chức/ra quyết định, Codex sinh/sửa code và chạy kiểm tra; không viết rằng Dũng tự tay viết toàn bộ React hoặc Nam viết toàn bộ phần mới |
| Sửa S3/Lambda liên thông Java | `629b364`, `aws/verification-2026-11-09.json` | Dũng yêu cầu Codex đồng bộ JSON/results, duplicate/stream/size/version/timeout và test; giữ công sức source gốc của Đăng |
| Tích hợp Nextcloud/S3 | `3a176c1`, `95a108a`, `e58a382` | Giữ history nhánh Đăng; đổi port Nextcloud 8081 và bổ sung hướng dẫn theo yêu cầu Dũng, không biến Nextcloud thành adapter backend |
| Tích hợp PR #3 | [PR #3](https://github.com/Chien2k5/cloud-document-handover/pull/3), merge commit `d0d8141ee037e14bc154237385d6f971689cf0b3` | Dũng phê duyệt trong yêu cầu; Codex thực hiện kiểm tra/merge qua quyền GitHub hiện có. Không có review Nam/Chiến được tự ghi nhận |
| Nhánh thử khác, chưa phát hành | Local `codex/backup-aws-mvp` commit `7e7a3904506ebe64c29510c972b70d8b09e287e6` | Có source thử frontend/backup/IaC ở local; không nằm trong origin/dung/PR #3, không coi là deploy AWS hoặc chuyển công lao sang người quản lý `infra/` |

## 4. Sáu checkpoint frontend được giữ nguyên

| Giai đoạn | SHA gốc | Nội dung | Author Git |
| --- | --- | --- | --- |
| 1 | `dd31191fb9ae0e0152d1659d3a964dd06eae8d9e` | React/Vite, session auth/CSRF | HuyDung |
| 2 | `f5e3d45b5bf3c1e3516b31520dfdc01fc448631e` | Project/membership/role | HuyDung |
| 3 | `2b07b00abbb26b930c30b492dbadce354afd4672` | Presigned upload/SHA/polling | HuyDung |
| 4 | `c5a2b2f297a1e0886c7aeaba9407c6f606a71144` | File version/reload/download | HuyDung |
| 5 | `35a74ffa779593361f89b8274ddc292c351989aa` | Handover/publish/confirm/revoke | HuyDung |
| 6 | `0f77a234033afd6fd38d258b09bf16588ea6d333` | Hồi quy, tài liệu, evidence | HuyDung |

Không amend/rebase/squash các commit này. Commit author không được đổi thành Nam
hoặc tên khác. Tác giả source gốc được bảo toàn qua nhánh gốc và các liên kết diff;
việc copy file Nam có kiểm soát không có nghĩa commit Nam trở thành ancestor PR #3.

## 5. So sánh nhánh và kiểm soát merge

- `main` trước/sau: `0e70ee2716f912dc3a7b433cb88dd99e1a81a615`, không được sửa.
- `main` → `dung` trước merge: backend/contracts/evidence và Nextcloud/S3 đã được
  bổ sung theo lịch sử; không quy tất cả diff cho một người chỉ vì branch tên dung.
- Nam `00bc97b` → PR head: CSS/bố cục ban đầu được dùng tiếp, thêm React/client/tests,
  thay form thiếu dữ liệu và đánh dấu lịch sử pilot chưa xác minh.
- `dung@e58a382` → PR #3 chỉ thay `frontend/`, `docs/pilot/`. Backend, migration,
  contracts, aws và Nextcloud có tree không đổi qua PR này.
- Trước merge: PR Draft/open, `mergeable=true`, `mergeable_state=clean`, không
  conflict. GitHub trả `protected=false` cho dung, rulesets rỗng; PR reviews rỗng.
  Không có CI status/check-run: **NOT_CONFIGURED**, không gọi trạng thái pending/0
  check là CI PASS. Không dùng chức năng bypass protection.
- Dũng chấp thuận rõ không cần thêm vòng review Nam trong yêu cầu hiện tại;
  đây không phải bằng chứng Nam/Chiến đã approve trên GitHub.
- Sau merge: `d0d8141ee037e14bc154237385d6f971689cf0b3`, hai parent là `e58a382` và `0f77a23`, sáu SHA gốc
  vẫn là ancestor. Không force push, không xóa branch Nam/tích hợp, không merge main.

## 6. Kiểm thử trước và sau merge

| Kiểm tra | Trước merge `0f77a23` | Sau merge `d0d8141` | Giới hạn |
| --- | --- | --- | --- |
| npm ci/lint/build/audit | PASS; audit 0 finding | PASS; audit 0 finding | ESLint 9.39.5 đã hết hỗ trợ upstream, ghi trong README; cần review nâng toolchain |
| Frontend unit | 17 PASS | 17 PASS | Mock fetch/S3, SHA-256 thật trên bytes mẫu |
| Browser fixture | 17 PASS | 17 PASS | Chrome thật, API/S3 MOCK |
| Backend PostgreSQL/contract | 62 PASS, 0 fail/error/skipped | 62 PASS, 0 fail/error/skipped | DB thử mới; storage MOCK/fixture |
| Browser live API | 3 PASS | 3 PASS | React/Vite → Spring/PostgreSQL thật, auth/project/membership/401/403/404/503; không full AWS |
| Python Lambda/reader | 25 PASS | 25 PASS | FakeS3/mock SDK |
| Java đọc JSON/key Python | 12 ca PASS | 12 ca PASS | Parser production trong JAR; không gọi AWS |
| AWS E2E / deploy / restore Cloud | NOT_RUN | NOT_RUN | Cần tài nguyên/quyền/cấu hình nhóm; nhiệm vụ không deploy |

Bằng chứng repo có tại `docs/pilot/test_report.md`, `checkpoints.json`,
`live-verification.json`, `evidence/backend-2026-11-09/verification.json`,
`aws/verification-2026-11-09.json`. Lượt release này lưu log/summary local tại
`output/release-audit-20261110/premerge/` và `postmerge/`; không đưa raw log/secret
vào Git. Các con số sau merge chỉ điền sau khi chạy chính SHA merge; không cộng
các lớp test thành một tỷ lệ đóng góp hoặc chứng nhận AWS.

## 7. Những phần chưa thể kết luận

Chưa có cơ sở xác nhận tác giả gõ tay từng dòng trong commit lịch sử, số giờ thực tế,
tỷ lệ đóng góp, review/nghiệm thu độc lập của Nam/Đăng/Chiến, video/pilot cũ,
Cloud deployment/backup/restore/chi phí đã hoàn tất. Không sửa báo cáo chính thức cũ
để ép các kết luận đó. Tài liệu ghi nhận hiện hành: `CONTRIBUTIONS.md` trong cùng thư mục.

## 8. Tóm tắt bằng chứng release đọc được bằng máy

Các hash dưới đây chốt summary local của từng lượt test; raw log không được đưa
vào Git. Git source tree là căn cứ đối chiếu code; không tuyên bố JAR reproducible
bit-for-bit giữa hai lượt build.

```json
{
  "date": "2026-11-10",
  "mergedSourceTree": "388f362b660f5762ded3607660d7c1e32f3f6657",
  "phases": [
    {
      "phase": "premerge",
      "commit": "0f77a234033afd6fd38d258b09bf16588ea6d333",
      "status": "PASS_LOCAL",
      "frontendUnitTests": 17,
      "browserMockTests": 17,
      "backendTests": {
        "tests": 62,
        "failures": 0,
        "errors": 0,
        "skipped": 0
      },
      "browserLiveTests": 3,
      "lambdaPythonMockTests": 25,
      "lambdaJavaContractCases": 12,
      "awsE2E": "NOT_RUN",
      "testDatabaseRemoved": true,
      "trackedSourceUnchanged": true,
      "jarSha256": "2ce304116c68cb8b6076f77fe97daf6871679fb8bc7fcfcb82cbdfb31fb0988c",
      "localEvidenceSha256": "56f99f3695afb9c13b696022054386843ff64035f2037fffe0b1789c4675b70f"
    },
    {
      "phase": "postmerge",
      "commit": "d0d8141ee037e14bc154237385d6f971689cf0b3",
      "status": "PASS_LOCAL",
      "frontendUnitTests": 17,
      "browserMockTests": 17,
      "backendTests": {
        "tests": 62,
        "failures": 0,
        "errors": 0,
        "skipped": 0
      },
      "browserLiveTests": 3,
      "lambdaPythonMockTests": 25,
      "lambdaJavaContractCases": 12,
      "awsE2E": "NOT_RUN",
      "testDatabaseRemoved": true,
      "trackedSourceUnchanged": true,
      "jarSha256": "50b892440b5e40ef04035c641db54f61acb8691734d7eab7bd3ee19e2bd13ee9",
      "localEvidenceSha256": "2cb1701a676519b33339830960bba75abf8e21a4c298437ab4eeb8d1ee8e327d"
    }
  ]
}
```
