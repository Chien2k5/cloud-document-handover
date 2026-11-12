# F012 — Claim-to-assertion mapping

Classification DOCUMENTATION ISSUE; MEDIUM; HIGH confidence. Audit cung cấp trực tiếp bởi owner. Không kết luận evidence giả mạo.

## Nguồn và trạng thái thực thi

- Source: `ops/verify_tv1_local_stack.py`, `ops/tv1_evidence.py`, `docs/tv1/TV1-SUMMARY.md`, hai README nhắc runner và sáu file historical TV1 evidence.
- Command historical: **NOT_RECORDED đầy đủ**. Entry point được tài liệu mô tả là `python ops/verify_tv1_local_stack.py`; không coi mô tả này là execution provenance.
- Current LocalStack E2E: **NOT_RUN**, thiếu boto3 trong venv đã chọn, backend JAR và frontend dist/index.html. Không chạy Docker stack để tạo PASS.
- U (offline test execution): `infra/tests.venv/Scripts/python.exe -B -m unittest discover -s ops/tests -p test_tv1_evidence.py -v`.
- I (isolation regression): `infra/tests.venv/Scripts/python.exe -B -m unittest discover -s ops/tests -p test_verify_isolation.py -v`.
- Actual results: `evidence/f012/local-verification.json`, các console output và báo cáo F012. U/I không biến các claim LocalStack dưới đây thành PASS.
- Historical evidence: `evidence/tv1-local-stack/historical/pre-f012/00-summary.json`; 5 artifacts còn lại ở path cũ. `historical-index.json` giữ byte hashes quan sát hiện tại, không backfill executed-source hashes.

## Toàn bộ 10 nhãn PASS cũ

| Claim ID / original wording | Source file | Executed command | Actual assertion trong runner hiện tại | Actual evidence | Coverage boundary / corrected status |
|---|---|---|---|---|---|
| `nginxRootRedirectToPortal` (legacy PASS) | `ops/verify_tv1_local_stack.py` check_routing:355, check_routing:356; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | nginxRootRedirectToPortal: status, location | Historical summary/manifest/report; hiện tại không có E2E evidence mới | HTTP root redirects to /portal/; historical SOURCE_UNPROVEN, current **NOT_RUN** |
| `nginxPortalStaticAssetsAndNoStoreIndex` (legacy PASS) | `ops/verify_tv1_local_stack.py` check_routing:358, check_routing:359, check_routing:360; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | nginxPortalIndexAndNoStore: status, asset_reference, no_store | Historical summary/manifest/report; hiện tại không có E2E evidence mới | Python GET index: asset reference and no-store header only; historical SOURCE_UNPROVEN, current **NOT_RUN** |
| `nginxApiReverseProxyHealthUp` (legacy PASS) | `ops/verify_tv1_local_stack.py` check_routing:362, check_routing:363; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | nginxApiReverseProxyHealthUp: status, up | Historical summary/manifest/report; hiện tại không có E2E evidence mới | HTTP health endpoint reports UP; historical SOURCE_UNPROVEN, current **NOT_RUN** |
| `K03_presignedPutAndCompleteExactVersion` (legacy PASS) | `ops/verify_tv1_local_stack.py` run_checks:443, run_checks:444; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | K03_pythonUploadAndComplete: three_uploads, version_ids | Historical summary/manifest/report; hiện tại không có E2E evidence mới | Python PUT observes Version ID; complete returns identifiers; no browser CORS claim; historical SOURCE_UNPROVEN, current **NOT_RUN** |
| `K04_lambdaSha256VerifiedAndMismatch` (legacy PASS) | `ops/verify_tv1_local_stack.py` run_checks:424, run_checks:433, run_checks:442; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | K04_verifiedAndMismatchStates: v1, v2, mismatch | Historical summary/manifest/report; hiện tại không có E2E evidence mới | Observed v1/v2 VERIFIED with matching hash; tampered upload MISMATCH; historical SOURCE_UNPROVEN, current **NOT_RUN** |
| `K05_uploadsPrefixOnlyAndDuplicateEventIdempotentSkip` (legacy PASS) | `ops/verify_tv1_local_stack.py` run_checks:467; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | K05_duplicateEventSkip: duplicate_result | Historical summary/manifest/report; hiện tại không có E2E evidence mới | One explicitly replayed event returns created=0, skipped=1; not absence of notification loops; historical SOURCE_UNPROVEN, current **NOT_RUN** |
| `K07_handoverPinsV1AfterV2Upload` (legacy PASS) | `ops/verify_tv1_local_stack.py` check_pinned_download:368, check_pinned_download:369, check_pinned_download:370, run_checks:434, run_checks:493; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | K07_selectOlderVersionAfterV2: distinct_versions, versioned_url, download_status, v1_bytes, confirmed | Historical summary/manifest/report; hiện tại không có E2E evidence mới | Package CREATED AFTER v2 selects/downloads v1; not immutability of an already-published package; historical SOURCE_UNPROVEN, current **NOT_RUN** |
| `K11_s3BackupAndIsolatedDbRestoreWithS3CrossCheck` (legacy PASS) | `ops/verify_tv1_local_stack.py` run_checks:519, run_checks:520, run_checks:521, run_checks:522, run_checks:523; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | K11_restoreAndReferencePreservation: restore_status, tables, foreign_keys, rollback, references | Historical summary/manifest/report; hiện tại không có E2E evidence mới | Child restore report plus 11 tables, 18 FK, rollback and reference preservation; not every file VERIFIED; historical SOURCE_UNPROVEN, current **NOT_RUN** |
| `K12_privateBucketsEncryptionAndNoSecretsInRepo` (legacy PASS) | `ops/verify_tv1_local_stack.py` no runtime assertion; no runtime assertion; no runtime assertion; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | K12_iam: ; K12_bucketPolicy: ; K12_secretScan:  | Historical summary/manifest/report; hiện tại không có E2E evidence mới | No effective IAM assertions in this runner; No bucket policy enforcement assertion in this runner; No repository/log secret scan performed by this runner; historical SOURCE_UNPROVEN, current **NOT_RUN** |
| `K13_redeployAgainstExistingDbPreservesHandoverAndUsers` (legacy PASS) | `ops/verify_tv1_local_stack.py` check_restored_restart:374, check_restored_restart:375, check_restored_restart:376, check_restored_restart:377, check_restored_restart:378; registry `ops/tv1_evidence.py` | Historical NOT_RECORDED; current E2E NOT_RUN; U/I cho cơ chế | K13_sameArtifactRestartOnRestoredDb: same_jar, login, confirmed, download_status, v1_bytes | Historical summary/manifest/report; hiện tại không có E2E evidence mới | Same JAR restarted on restored DB; login, confirmed package and v1 download; not deployment/version update; historical SOURCE_UNPROVEN, current **NOT_RUN** |

## Các claim rộng được tách riêng, không ngầm PASS

| Claim ID | Wording / boundary | Assertions | Actual evidence / corrected status |
|---|---|---|---|
| `frontendJsCssFetch` | JS/CSS resources not fetched by this runner | Không có trong runner | **NOT_RUN**, không cộng PASS; negative cases U xác minh không thể tạo assertion tự đặt |
| `browserRendering` | No browser rendering test | Không có trong runner | **NOT_RUN**, không cộng PASS; negative cases U xác minh không thể tạo assertion tự đặt |
| `browserCors` | Python HTTP does not enforce browser CORS | Không có trong runner | **NOT_RUN**, không cộng PASS; negative cases U xác minh không thể tạo assertion tự đặt |
| `K07_publishedPackageSurvivesLaterUpload` | No package-before-v2 temporal test | Không có trong runner | **NOT_RUN**, không cộng PASS; negative cases U xác minh không thể tạo assertion tự đặt |
| `K12_iam` | No effective IAM assertions in this runner | Không có trong runner | **NOT_RUN**, không cộng PASS; negative cases U xác minh không thể tạo assertion tự đặt |
| `K12_bucketPolicy` | No bucket policy enforcement assertion in this runner | Không có trong runner | **NOT_RUN**, không cộng PASS; negative cases U xác minh không thể tạo assertion tự đặt |
| `K12_secretScan` | No repository/log secret scan performed by this runner | Không có trong runner | **NOT_RUN**, không cộng PASS; negative cases U xác minh không thể tạo assertion tự đặt |
| `K13_deploymentVersionUpdate` | No deploy/redeploy script or application-version update | Không có trong runner | **NOT_RUN**, không cộng PASS; negative cases U xác minh không thể tạo assertion tự đặt |

## Rollup và tài liệu liên quan

| Claim trong tài liệu | Source | Assertion/evidence thực tế | Hiệu chỉnh |
|---|---|---|---|
| A01 ĐẠT dự toán/quyền Lab | TV1-SUMMARY mục 1 | Tài liệu tồn tại không phải xác minh tài khoản/chi phí | Chưa tái đánh giá; F013 NOT_STARTED; không sửa cost model |
| A02 PASS LOCAL EMULATION | TV1-SUMMARY mục 1 | Historical artifacts, chưa source-byte provenance/current E2E | HISTORICAL/PARTIAL; current NOT_RUN |
| A03 PASS lint + LocalStack E2E / least privilege | TV1-SUMMARY mục 1 | Lint chỉ cấu hình; F003 là suite riêng, không runtime IAM/CORS | Không gộp static lint/IAM model thành E2E PASS |
| A04 PASS Nginx/JAR E2E / redeploy | TV1-SUMMARY mục 1, infra/README | HTTP index/API và restart cùng artifact | Không JS/CSS/browser/deploy/version-update PASS |
| A05 PASS 11 tables/18 FK/S3 | TV1-SUMMARY mục 1 | Historical restore report; source hash thiếu; current script F007 phân biệt preservation/integrity | Historical only; current E2E NOT_RUN |
| A06 PASS toàn luồng/security/merge | TV1-SUMMARY mục 1 | Runner không có secret/IAM/bucket policy assertions, không chạy full AWS | Historical/PARTIAL; không merge-ready claim |
| Nginx, K03/K04, K05, K07, K11, K12, K13 PASS rows | TV1-SUMMARY mục 2 cũ | 10 legacy keys và assertion mapping ở trên | Thay bằng bảng coverage; current NOT_RUN |
| cfn-lint 0 lỗi/0 cảnh báo | infra/README mục 2 | Lệnh lint offline thực thi exit 0, lưu local-verification.json | PASS_OFFLINE chỉ hai template; không runtime/security proof |
| Runner pipeline description | ops/README, infra/README | Các function trong mapping; chỉ có restart cùng JAR | Link coverage/current status; không tuyên bố full frontend/CORS/redeploy |
| restore status PASS / dump commit SHA d7b2313 | Historical restore JSON/MD và backup manifest | Giữ nguyên reported results và ancestor SHA; không có hashes source đã chạy | HISTORICAL_UNVERIFIED_EXECUTED_SOURCE; không thay bằng hashes mới |

## Provenance và failure semantics

RUNNING được publish trước setup/provenance probe; metadata gồm UUID, UTC timestamp, Git HEAD/dirty status, SHA-256 source ops/infra/deploy/aws-lambda (tracked và nonignored untracked), built JAR/frontend bytes nếu có và tool versions thực tế/NOT_AVAILABLE. Không coi Git SHA một mình hoặc hashes quan sát hôm nay là executed historical bytes.
Chỉ các observation bool/int tính từ HTTP/state/hash thực được lưu. PASS yêu cầu đủ registered assertions đã chạy và đều đạt; claim thiếu assertion không thể PASS. Không lưu raw response/URL/exception/environment. Metadata start/end được so sánh; source/artifact drift ngăn complete.
Current summary và per-run summary được replace bằng file JSON hoàn chỉnh. Single-writer lock không bị tự xóa khi bị gián đoạn. Fail/cleanup/SystemExit được ghi trước khi truyền lỗi ra ngoài; SystemExit(0) trong lỗi không trở thành process success. Failure dependency giữ exit code riêng, không giữ argv có thể chứa secret.
Full narrow workflow hoàn tất có 9 PASS checks và 8 NOT_RUN claims nên overall PARTIAL (exit 0), không phải full acceptance. Hard kill còn RUNNING/lock; disk failure có thể chỉ giữ trạng thái RUNNING. Không tuyên bố raw backend/child logs đã được secret scan.

## Phạm vi không thực hiện

Không AWS API/resources/credentials/push/merge/deploy. Không sửa F010/F005/F006/F013 implementation. F010=FIXED_LOCAL_PENDING_AWS_VERIFICATION; F005/F006=BLOCKED; F013=NOT_STARTED; V001=NOT_RUN.
