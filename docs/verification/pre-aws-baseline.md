# A01 — Baseline pre-AWS ngày 10/11/2026

Mode PRE_AWS. Nhánh `task/C08-pre-aws-hardening`; base mới nhất sau phê duyệt
PR #4: `eb6f7c7cb8d05c9187b59d39986796fcaec2fe59`. Nhánh đã tạo ở `d0d8141`
rồi fast-forward tới merge tài liệu trước commit hardening đầu tiên. Không reset,
không đổi Git author, không sửa các thay đổi local ở workspace gốc.

## Git/PR đã xác minh

| Thành phần | Mốc đã đọc | Trạng thái |
| --- | --- | --- |
| main | `0e70ee2716f912dc3a7b433cb88dd99e1a81a615` | Không sửa |
| PR #3 | `d0d8141`, parents `e58a382` / `0f77a23` | Đã merge; đủ 6 checkpoint React còn nguyên |
| PR #4 | `eb6f7c7`, parents `d0d8141` / `80721c8` | Merge commit sau khi Dũng chấp thuận rõ 3 tài liệu trong phiên này |
| Frontend Nam gốc | `00bc97b` | HTML/CSS/docs, app.js rỗng; branch giữ nguyên |
| S3/Lambda | `4368343`, `15973c3`, bản sửa `629b364` | Có trong lịch sử dung, không quy bản sửa Dũng/Codex cho Đăng |
| Source hạ tầng Chiến | infra/, deploy/, ops/ chỉ có README rỗng trên dung | Chưa có branch/PR implementation mới được cung cấp |

PR #4 chỉ thêm 3 tài liệu, tree backend/frontend/contracts/aws/Nextcloud không đổi
so với `d0d8141`. GitHub dung protected=false, không có ruleset hoặc CI check-run
tại thời điểm audit; không suy 0 check thành CI PASS. Không bypass protection.

## Thành phần thật sự có code

- Backend Spring Boot/JdbcTemplate/Flyway: auth/session/CSRF, account status,
  project/membership/role, upload/quota/version/reconciliation, handover/audit.
- Frontend React/Vite: cùng origin API client, role UI, Web Crypto hash, signed
  PUT/Version ID/complete/polling, list/reload/download, DRAFT/publish/confirm/revoke.
- Java AWS SDK adapter và Python Lambda/POC reader, schema v1/results key chung.
- Nextcloud Compose local riêng; không có Nextcloud adapter trong backend.
- Có runner DB/browser và local backup/restore; chưa có workflow GitHub Actions.
- Nhánh local `codex/backup-aws-mvp@7e7a390` là thử nghiệm khác, không phải source
  hạ tầng Chiến đã cung cấp và không tự đưa vào baseline/hạ tầng AWS.

## Source/contract/toolchain

Nguồn ưu tiên đã đối chiếu: PRINCIPLE.MD, OpenAPI
`0.5.0-backend-integration`, s3-adapter-contract, controller/DTO/service/security,
backend/frontend README, docs tích hợp 08/11, pilot/week-05, aws README và PR #4.
Các ghi chú Lambda trước 09/11 còn nói chưa khớp là lịch sử; worker hiện tại đã có
bản sửa `629b364`. Quy tắc Nextcloud cũ không được tự hiểu thành luồng runtime S3.
Không âm thầm sửa các tài liệu lịch sử đó.

Toolchain local: Node 24.15.0/npm 11.12.1, Python 3.13.13, Temurin JDK 25,
Java target 21/Maven 3.9.12, PostgreSQL 17 container thử. Lockfile frontend giữ
React 19.3.1/Vite 8.3.7. npm audit 0 finding; ESLint 9.39.5 đã hết hỗ trợ upstream
là rủi ro dev-tool được ghi nhận, không tự nâng toàn bộ dependency không căn cứ.

## Baseline đã chạy, phân loại đúng mức

Lượt A01 chạy source `d0d8141` trước fast-forward PR #4 (chỉ tài liệu). So sánh
tree xác nhận runtime baseline và base `eb6f7c7` giống hệt nhau.

| Loại | Kết quả A01 | Giới hạn |
| --- | --- | --- |
| npm ci/lint/build/audit | PASS, 0 finding | Local |
| UNIT_MOCK | 17 PASS | Fetch/S3 fixture, hash Web Crypto thật trên bytes mẫu |
| BROWSER_MOCK | 17 PASS | Chrome thật, API/S3 mock |
| LOCAL_REAL_BACKEND | 62 backend tests + 3 browser LIVE PASS | PG mới; storage backend fixture/mock. Browser LIVE auth/project/membership/503 |
| PYTHON_OFFLINE | 25 PASS | FakeS3/mock SDK |
| JAVA_PYTHON_CONTRACT | 12 PASS | JAR production parser/key, không gọi AWS |
| LOCAL_REAL_BACKEND_WITH_TEST_STORAGE | NOT_RUN ở baseline browser | Đánh giá/bổ sung harness cách ly tại A13 |
| AWS_REAL_E2E | NOT_RUN | Chặng B BLOCKED_WAITING_FOR_CHIEN |

DB thử được tạo riêng/xóa sau chạy; không TRUNCATE DB dùng chung hoặc Nextcloud.
Git tracked source không thay đổi qua test. Bằng chứng A01 local:
`output/pre-aws-hardening-20261110/A01-baseline/` (ignored).

## Tính toàn vẹn artefact

Runner baseline ngoài repo ban đầu dùng nhầm đường dẫn log release cũ. Raw log/full
summary local của lượt release trước bị ghi đè; đã đánh dấu rõ tại
`output/release-audit-20261110/premerge/EVIDENCE-RECOVERY.md`, không giả file khôi phục
là bản gốc. Bản tổng hợp có hash đã commit trong contribution-audit vẫn giữ nguyên;
source/history/DB người dùng không bị đổi. A01 đã được tách thư mục riêng. Runner
ngoài repo nay yêu cầu output directory mới và từ chối thư mục đã tồn tại; A15 cần
giữ nguyên tắc output theo run-id cho CI/evidence, không overwrite artefact cũ.

## Ranh giới công việc

Không deploy AWS. Chặng B: **BLOCKED_WAITING_FOR_CHIEN** cho đến khi có branch/PR/
SHA hạ tầng thật, hướng dẫn/env không secret, người được phép deploy và môi trường
hợp lệ; chỉ mở lại ở một yêu cầu Codex mới. Không theo dõi ngầm sau lượt này.
Tiến độ A01–A15 được lưu từng checkpoint ở output/pre-aws-hardening-20261110 và
sẽ chốt thành báo cáo có commit/push/test thực tế trong docs/verification.
