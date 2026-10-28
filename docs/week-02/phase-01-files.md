# Danh sách file đề xuất commit sau kiểm tra cuối Phase 1

Ngày 22/10/2026, branch dung, base ef79ee3. **41 file: 12 tracked sửa (M) + 29 file mới (A).** Chưa stage/commit/push.

Bộ ban đầu có 31 file (12 M + 19 A). Kiểm tra cuối thêm 3 tài liệu và 7 evidence = 10 file; các file code/test cũ được sửa tiếp không đếm thêm.

## Nhóm commit đề xuất

- Backend: filter/security, DTO/deserializer/handler/service và regression tests/script.
- Hợp đồng: OpenAPI, examples, README, candidate và đề xuất adapter ghi rõ chờ review.
- Tài liệu và evidence: README, policy tuần 1, thiết kế/báo cáo/kế hoạch tuần 2 và hai snapshot evidence.

Danh sách là đề xuất phạm vi, không phải lệnh git add và không ghi nhận thành viên khác đã duyệt.

| Loại | File |
| --- | --- |
| M | `README.md` |
| M | `backend/README.md` |
| A | `backend/src/main/java/vn/edu/uet/handover/auth/ActiveAccountFilter.java` |
| M | `backend/src/main/java/vn/edu/uet/handover/auth/SecurityConfig.java` |
| M | `backend/src/main/java/vn/edu/uet/handover/common/ApiExceptionHandler.java` |
| A | `backend/src/main/java/vn/edu/uet/handover/common/StrictStringDeserializer.java` |
| M | `backend/src/main/java/vn/edu/uet/handover/project/ProjectDtos.java` |
| M | `backend/src/main/java/vn/edu/uet/handover/project/ProjectService.java` |
| A | `backend/src/test/java/vn/edu/uet/handover/ActiveAccountFilterTest.java` |
| M | `backend/src/test/java/vn/edu/uet/handover/BackendIntegrationTest.java` |
| M | `backend/src/test/java/vn/edu/uet/handover/ContractTest.java` |
| A | `backend/tools/run_phase1_http_regression.py` |
| M | `contracts/README.md` |
| A | `contracts/examples/error-account-disabled.json` |
| A | `contracts/examples/error-unsupported-media-type.json` |
| A | `contracts/examples/error-upload-already-completed.json` |
| A | `contracts/examples/error-upload-expired.json` |
| A | `contracts/examples/upload-new-version.request.json` |
| M | `contracts/openapi.yaml` |
| A | `contracts/review/presigned-put-write-once.candidate.json` |
| A | `contracts/s3-adapter-contract.md` |
| M | `docs/week-01/permissions.md` |
| M | `docs/week-01/upload-handover-rules.md` |
| A | `docs/week-02/phase-01-files.md` |
| A | `docs/week-02/phase-01-final-review.md` |
| A | `docs/week-02/phase-01-report.md` |
| A | `docs/week-02/phase-01-upload-contract.md` |
| A | `docs/week-02/phase-02-plan.md` |
| A | `evidence/week-02/phase-01-final/README.md` |
| A | `evidence/week-02/phase-01-final/http-baseline.txt` |
| A | `evidence/week-02/phase-01-final/http-regression.txt` |
| A | `evidence/week-02/phase-01-final/junit-summary.txt` |
| A | `evidence/week-02/phase-01-final/migration-startup.txt` |
| A | `evidence/week-02/phase-01-final/review-checks.json` |
| A | `evidence/week-02/phase-01-final/source-hashes.json` |
| A | `evidence/week-02/phase-01/README.md` |
| A | `evidence/week-02/phase-01/http-baseline.txt` |
| A | `evidence/week-02/phase-01/http-regression.txt` |
| A | `evidence/week-02/phase-01/junit-summary.txt` |
| A | `evidence/week-02/phase-01/migration-startup.txt` |
| A | `evidence/week-02/phase-01/source-hashes.json` |

## Loại trừ

Sáu file docs/tv3 có sẵn được giữ nguyên, không thuộc task và không đề xuất commit cùng Phase 1:

- `docs/tv3/Ke_hoach_TV3_backend_5_tuan.docx`
- `docs/tv3/Tai_lieu_thiet_ke_backend_TV3_da_dinh_dang.docx`
- `docs/tv3/ke-hoach-tv3-5-tuan.md`
- `docs/tv3/so-do/ERD_C01_portal.drawio`
- `docs/tv3/so-do/ERD_C01_portal.png`
- `docs/tv3/so-do/ERD_C01_portal.svg`

Script tạm `runtime-data/build_contract.py`, `runtime-data/update_phase1_contract.py`, `runtime-data/finalize_phase1_evidence.py`, các snapshot/runtime DB và raw log được giữ trong vùng ignore. Không đề xuất commit .env, target/JAR, raw Surefire XML hoặc credential/cookie/token. Không dùng git add toàn bộ working tree.
