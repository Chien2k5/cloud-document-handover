# WAVE 4 — F012 REMEDIATION REPORT

## 1. Finding và root cause

F012 — Nhãn PASS và provenance rộng hơn bằng chứng. DOCUMENTATION ISSUE; MEDIUM; HIGH confidence; owner Chiến. Trạng thái remediation: **FIXED_LOCAL** theo các gate offline; không đồng nghĩa LocalStack/AWS E2E PASS.
Runner gán cả bộ PASS sau khi chạy, có nhãn frontend/CORS/K07/K12/K13 vượt phạm vi. Root summary cũ không phản ánh run mới lỗi trước final write; source provenance lịch sử chỉ có ancestor SHA. Audit không kết luận evidence giả mạo.

## 2. HEAD và phạm vi thay đổi

- Workspace `D:\cloud-document-handover-chien`, branch `review/chien-aws`; HEAD before `c42844424044bdb416d8cf88ae9bd2d11248242c`; ban đầu worktree sạch.
- Báo cáo được tạo trước atomic commit; HEAD after là commit chứa báo cáo này, tra bằng `git log -1 --format=%H -- docs/tv1/F012-remediation-report.md`. SHA đầy đủ và status sau commit được báo trong chat và `evidence/f012/post-commit-verification.log` (ignored, không tuyên bố đã commit).
- Sửa runner, thêm `ops/tv1_evidence.py`, `ops/tests/test_tv1_evidence.py`; hiệu chỉnh TV1 summary/README; lưu claim map và evidence F012. Chỉ current root summary được thay bằng NOT_RUN; archive giữ bytes cũ, năm artifact cũ khác không đổi.
- `historical-index.json` ghi hashes quan sát lúc correction và Git blob hashes. `.gitattributes` chỉ pin raw archive; `.gitignore` chỉ loại runtime runs/lock/temp. Không backfill hashes đã thực thi trong quá khứ.

### Exact files trong atomic commit

- `docs/tv1/F012-claim-map.md`
- `docs/tv1/F012-remediation-report.md`
- `docs/tv1/TV1-SUMMARY.md`
- `evidence/f012/.gitattributes`
- `evidence/f012/F010-regression-console.txt`
- `evidence/f012/README.md`
- `evidence/f012/baseline-isolation.txt`
- `evidence/f012/console-original-bytes.json`
- `evidence/f012/final-command-results.json`
- `evidence/f012/first-stale-pass-green.txt`
- `evidence/f012/isolation-console.txt`
- `evidence/f012/lint-console.txt`
- `evidence/f012/local-verification.json`
- `evidence/f012/offline-command-first-attempt.json`
- `evidence/f012/offline-command-results.json`
- `evidence/f012/red-stale-pass.txt`
- `evidence/f012/regression-command-results.json`
- `evidence/f012/unit-console.txt`
- `evidence/f012/unit-retention-first-attempt.txt`
- `evidence/tv1-local-stack/.gitattributes`
- `evidence/tv1-local-stack/.gitignore`
- `evidence/tv1-local-stack/00-summary.json`
- `evidence/tv1-local-stack/README.md`
- `evidence/tv1-local-stack/historical-index.json`
- `evidence/tv1-local-stack/historical/pre-f012/00-summary.json`
- `infra/README.md`
- `ops/README.md`
- `ops/tests/test_tv1_evidence.py`
- `ops/tv1_evidence.py`
- `ops/verify_tv1_local_stack.py`

## 3. Claim-to-assertion mapping / false-positive claims

[Bảng đầy đủ](F012-claim-map.md) chứa Claim ID, original wording, source/function, command, assertion, actual evidence, coverage boundary và corrected status cho 10 nhãn PASS cũ, 17 claim mới và rollup A01–A06.
- StaticAssets → chỉ GET index + asset reference/no-store; JS/CSS fetch/browser rendering NOT_RUN.
- Python Version ID/HTTP → không browser CORS PASS.
- K07 → tạo package sau v2, chọn/download đúng v1; không published-package-before-v2 immutability PASS.
- K13 → same-JAR restart trên DB restore; không deploy/redeploy/application-version-update PASS.
- K12 → IAM/bucket policy/secret scan NOT_RUN trong runner; suite riêng không tự nâng status runner.
- K05 → một duplicate replay skip; không claim không có notification loop.
- K11 → restore/reference preservation, không mặc định mọi file VERIFIED; historical result không thành current HEAD PASS.
- Historical PASS/ancestor SHA được giữ và gắn giới hạn; current E2E NOT_RUN; không tuyên bố evidence bị giả.

## 4. Test commands và actual results

**U — exit 0**
```powershell
& infra/tests.venv/Scripts/python.exe -B -m unittest discover -s ops/tests -p test_tv1_evidence.py -v
```
Actual output: `evidence/f012/unit-console.txt`; metadata/source hashes: `evidence/f012/final-command-results.json`.

**I — exit 0**
```powershell
& infra/tests.venv/Scripts/python.exe -B -m unittest discover -s ops/tests -p test_verify_isolation.py -v
```
Actual output: `evidence/f012/isolation-console.txt`; metadata/source hashes: `evidence/f012/final-command-results.json`.

**R — exit 0**
```powershell
& infra/tests.venv/Scripts/python.exe -B -m unittest discover -s infra/tests -p test_rds_alarm_notifications.py -v
```
Actual output: `evidence/f012/F010-regression-console.txt`; metadata/source hashes: `evidence/f012/final-command-results.json`.

**L — exit 0**
```powershell
& infra/tests.venv/Scripts/cfn-lint.exe infra/cloudformation/00-storage.yaml infra/cloudformation/01-rds-beanstalk-cloudfront.yaml
```
Actual output: `evidence/f012/lint-console.txt`; metadata/source hashes: `evidence/f012/final-command-results.json`.

Tổng cuối: **36 PASS_OFFLINE, 0 FAIL, 0 BLOCKED, 0 SKIP**. U=18 (12 mandatory + 6 extra), I=10, R=8. L=cfn-lint 1.60.0, exit 0. AST 3 files hợp lệ; registered assertion IDs khớp toàn bộ 28 call sites; git diff check exit 0.

| Test ID | Test file/function | Expected | Actual | Result |
|---|---|---|---|---|
| TC-F012-01 | `ops/tests/test_tv1_evidence.py:45` — `test_tv1_evidence.EvidenceTests.test_TC_F012_01_pass_requires_real_observation` | File observation true -> PASS; observation false/failure latch -> FAIL, cannot re-complete a failed run. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-02 | `ops/tests/test_tv1_evidence.py:64` — `test_tv1_evidence.EvidenceTests.test_TC_F012_02_missing_and_unknown_assertions_rejected` | Missing/unknown/invalid assertions cannot establish PASS. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-03 | `ops/tests/test_tv1_evidence.py:76` — `test_tv1_evidence.EvidenceTests.test_TC_F012_03_success_then_failure_updates_current` | Success then failure uses distinct UUID, replaces current state and retains successful historical bytes. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-04 | `ops/tests/test_tv1_evidence.py:93` — `test_tv1_evidence.EvidenceTests.test_TC_F012_04_exception_cannot_leave_current_pass` | RUNNING before preflight; RuntimeError/SystemExit(7)/SystemExit(0)/KeyboardInterrupt record FAIL and propagate. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-05 | `ops/tests/test_tv1_evidence.py:111` — `test_tv1_evidence.EvidenceTests.test_TC_F012_05_index_is_not_asset_or_browser_verification` | Only three HTTP requests; index PASS is bounded; JS/CSS and browser rendering NOT_RUN; invalid index fails. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-06 | `ops/tests/test_tv1_evidence.py:125` — `test_tv1_evidence.EvidenceTests.test_TC_F012_06_python_http_does_not_prove_cors` | Python HTTP/header observation cannot register browser CORS PASS. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-07 | `ops/tests/test_tv1_evidence.py:138` — `test_tv1_evidence.EvidenceTests.test_TC_F012_07_k07_is_selection_after_v2_not_temporal_immutability` | v1 bytes selected after v2; wrong v2 bytes fail; package-before-v2 temporal claim NOT_RUN. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-08 | `ops/tests/test_tv1_evidence.py:151` — `test_tv1_evidence.EvidenceTests.test_TC_F012_08_restart_is_not_redeployment` | Same artifact restart claim bounded; changed JAR fails; redeployment NOT_RUN. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-09 | `ops/tests/test_tv1_evidence.py:163` — `test_tv1_evidence.EvidenceTests.test_TC_F012_09_k12_does_not_invent_security_assertions` | IAM/bucket-policy/secret-scan unsupported claims NOT_RUN; forged PASS without assertions rejected. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-10 | `ops/tests/test_tv1_evidence.py:178` — `test_tv1_evidence.EvidenceTests.test_TC_F012_10_source_hashes_and_run_id_are_traceable` | Run UUID, actual HEAD/dirty state, script/infra hashes, artifact hash and tool versions traceable; drift rejected. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-11 | `ops/tests/test_tv1_evidence.py:198` — `test_tv1_evidence.EvidenceTests.test_TC_F012_11_non_pass_statuses_are_not_counted_as_pass` | NOT_RUN/BLOCKED/PARTIAL counted separately, empty result cannot PASS, AWS NOT_RUN. | unittest ok; assertions executed (U) | PASS_OFFLINE |
| TC-F012-12 | `ops/tests/test_tv1_evidence.py:217` — `test_tv1_evidence.EvidenceTests.test_TC_F012_12_evidence_never_serializes_sensitive_error_or_env` | Sensitive env/exception/argv/raw tool output markers absent from generated JSON; dependency exit code retained. | unittest ok; assertions executed (U) | PASS_OFFLINE |

## 5. Negative và regression evidence

RED → GREEN: `red-stale-pass.txt` ghi current PASS thay vì FAIL khi preflight RuntimeError (exit 1); cùng function sau sửa PASS. Test thành công rồi thất bại xác minh UUID/current file/failure code/history retention bằng file thật trong temporary directory.
Negative cases: assertion thiếu/sai/tự đặt, invalid index, wrong v2 bytes, changed JAR, unsupported security/CORS PASS, source drift, empty results, sensitive exception/environment/tool output, fail latch, initial/final atomic-write failures, concurrent writer và cleanup failure. Tất cả thực thi, không mock kết quả của evidence gate.
10 F008 cases (8 IDs + 2 safety cases) PASS với loader gốc và fake Docker boundary; 8 F010 cases PASS. Additional regression kiểm AST/source của OwnedStack/setup/credentials/backend/HTTP/upload helpers và giữ nguyên production templates/deploy/backup/restore/F010 README section so với c428444. Không sửa implementation F001–F011 ngoài lifecycle evidence bắt buộc trong runner F008.
Console .txt là bản hiển thị LF; `console-original-bytes.json` giữ bytes/base64 và hashes của capture gốc (kể cả UTF-16 logs). Không đổi PASS/FAIL, assertion hoặc exit code. FAIL retention CRLF/LF được lưu, giải thích trong evidence README; không xóa/make-up kết quả. Không chạy full application/DB regression hay LocalStack stack để giữ phạm vi an toàn.

## 6. Source provenance và failure design

RUNNING được publish trước dependency/setup. UUID/UTC timestamp/HEAD/dirty status/source SHA-256/build-artifact hashes/tool versions được lưu, cùng snapshot cuối; source/artifact drift ngăn hoàn tất. Child backup/restore artifacts được liên kết bằng digest trong parent run, không sửa child manifest schema hay suy đoán old executed bytes.
PASS chỉ khi đủ registered assertions đạt; failed run không thể được nâng lại thành complete PASS. Unsupported NOT_RUN/BLOCKED/PARTIAL không được cộng PASS. Default registry có 9 narrow executable claims và 8 unsupported claims nên full narrow run sẽ overall PARTIAL (exit 0), không full acceptance.
Atomic JSON replacement giữ file hợp lệ. Single-writer ownership lock không bị tự xóa sau interruption; current RUNNING không bị một writer khác ghi đè. FAIL ghi error type/exit code (dependency code riêng) mà không ghi message/argv/URL/body/env. Lỗi được truyền ra ngoài; SystemExit(0) trong failure chuyển thành nonzero. Cleanup hoàn tất trước final success; lỗi release lock cũng không bị nuốt.

## 7. Limits và trạng thái còn lại

- Current LocalStack E2E **NOT_RUN**: selected venv thiếu boto3, backend JAR, frontend dist/index.html. Không tự cài/build/deploy hay dùng DB chung. Không coi offline mocks là integration E2E.
- AWS E2E/V001 **NOT_RUN**; F010 **FIXED_LOCAL_PENDING_AWS_VERIFICATION**; F005/F006 **BLOCKED**; F013 **NOT_STARTED**.
- Hard kill có thể để RUNNING/lock; operator phải xác nhận run/process trước manual recovery. Disk write failure có thể ngăn lưu FAIL; exception vẫn truyền ra và không có final success mới.
- Bounded JSON không serialize secrets từ lỗi/env/raw output; không tuyên bố arbitrary backend/child raw logs đã secret-scan hoặc K12 security PASS. Pattern scan/manual review của commit là gate riêng.
- Claims chi phí/Lab không được thẩm định trong F012; không đóng F013. Không claim merge-ready toàn dự án.

## 8. Commit và handoff

Commit gate: exact F012 paths; message `fix(evidence): align pass claims with verified assertions`. Báo cáo/map/verification JSON/console/historical correction được lưu ngoài target và được stage cùng commit; final-head attestation *.log được giữ local, không stage.
Các run precommit có source hashes trước/sau khớp source hiện tại; HEAD cuối sẽ được rerun và ghi attestation riêng. Không push, merge, AWS API/resources/deploy/credentials hay thay đổi workspace khác.

STOP — WAITING FOR OWNER APPROVAL.
