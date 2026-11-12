# WAVE 4 — F013 demo MVP remediation report

## Kết quả và root cause

F013 — Dự toán và khẳng định Learner Lab thiếu căn cứ; DOCUMENTATION ISSUE, MEDIUM, HIGH confidence. Original audit đã đọc từ bản audit gốc lưu trong chat; yêu cầu owner mới nhất ưu tiên demo MVP và chỉ docs/tests.
**FIXED_LOCAL** về tài liệu/validation; **PENDING_OWNER_VERIFICATION** cho budget/account trước AWS deployment. Credit/Free Tier/available budget/actual spend không được giả định đã xác minh. Không thay đổi kiến trúc hay đóng F005/F006.
Root cause: bỏ public IPv4/retained data/artifacts/logs/snapshot/transfer, EBS size chưa pin nhưng quote như fact, Lambda sai rate/memory factor, Lab restrictions/credit khẳng định quá mức và RDS 7-day behavior bị mô tả ngược.

## Git và files

- Workspace `D:\cloud-document-handover-chien`; branch `review/chien-aws`.
- HEAD before: `6b761c19f5415dce45c1eecb493d0c55c6453074`; worktree ban đầu sạch.
- HEAD after là commit chứa báo cáo này; lấy bằng `git log -1 --format=%H -- docs/tv1/F013-remediation-report.md`. SHA đầy đủ/status sau commit và rerun được báo trong chat và local ignored attestation `ops/tests/F013-post-commit-verification.log`; không tuyên bố file .log đó được commit.
- Commit message: `docs(cost): clarify AWS cost and lab assumptions`.

- `ops/aws-lab-permissions-and-cost.md`
- `docs/tv1/F013-cost-model.json`
- `deploy/README.md`
- `ops/README.md`
- `docs/tv1/TV1-SUMMARY.md`
- `ops/tests/test_cost_documentation.py`
- `docs/tv1/F013-validation.json`
- `docs/tv1/F013-remediation-report.md`

## Inventory, nguồn và dự toán

Đã map đủ 26 explicit CFN logical resources/type/conditions/deletion policy và thêm service-created/external inventory: EB EC2/ASG/EIP/EBS, deploy artifact bucket, EB support bucket, Lambda/EB/RDS logs, snapshots, network/service roles hiện có. Template/script nghiệp vụ giữ nguyên.
Public AWS rate sources được kiểm ngày **2026-11-12**, **us-east-1**, USD; model lưu URL, SKU/dimensions/effective date cho các quote CSV và source IDs cho trang pricing/docs. EC2 phải Linux/shared/Used, RDS PostgreSQL Single-AZ; không dùng unused reservation row hoặc T3 table mặc định Region khác. Public-file GET không phải truy cập API tài khoản AWS.
| Estimate | Gross USD | +25% planning reserve |
|---|---:|---:|
| 48h rehearsal/demo | 5.51 | 6.89 |
| 35 ngày / 840h giữ live | 46.43 | 58.04 |

Tổng đã tính IPv4/EBS/RDS capacity, automated/manual backup allowance chưa trừ, final snapshot giữ thêm 7 ngày, toàn bộ S3 versions/artifact/backup bytes, phân loại requests, Lambda compute+requests, CF edge Europe/transfer về origin, direct S3 downloads, cross-AZ, logs ingest/stored và 5 alarms. SNS/CPU excess input sample 0 nhưng có công thức và negative/positive validation khi tăng.
10 GB gp3 root EBS chỉ ESTIMATED, source không pin. 720h/month là quy ước estimate, resource clocks độc lập; versioned bytes khác current project quota. Traffic/retention là input giả định, không phải đo. Không trừ Free Tier/credit/included allowances; tax/support/FX và optional/shared resources/performance ngoài assumptions cần thêm. Reserve không phải cap.
Lambda 10k × 2s × 0.5GB = 10k GB-s: compute $0.166667 + requests $0.002 = $0.168667 trước allowances. RDS tự restart sau 7 ngày stopped; stopped vẫn tính storage/backup. Idle EIP và EBS retained vẫn tính phí; EB ASG làm manual EC2 stop không phải lịch 210h đảm bảo.

## Demo, billing và cleanup

Personal-account preflight yêu cầu chọn UseLabRole=false rõ ràng (default code giữ true), dedicated operator ARN/EB service role/network/quota/platform availability phải xác minh. Academy Region/TTL/roles/balance là ACCOUNT_DEPENDENT, không dùng rule 4h/$50–$100 làm universal fact.
Billing checklist: owner kiểm Credits/Free Tier/Bills/Cost Explorer/usage types, phê duyệt budget tự chi trả hoặc credit thực có; nếu chọn Budgets alerts actual/forecast 50/80/100% thì vẫn phải theo dõi do delay, không hard cap.
Cleanup chỉ khi owner/giảng viên cho phép: giữ evidence/backup có thể restore; app consumers trước storage providers; theo dõi final/retained snapshots; xóa đúng owned object versions/delete markers/multipart/artifacts/EB service bundles/log groups; kiểm EIP release/EBS orphan và các resource ngoài stack. Retain/DELETE_COMPLETE không có nghĩa hết phí; review billing sau refresh. Không thực hiện bước AWS nào.

## Test commands và actual results

**F013 — exit 0**
```powershell
& infra/tests.venv/Scripts/python.exe -B -m unittest discover -s ops/tests -p test_cost_documentation.py -v
```

**F012_REGRESSION — exit 0**
```powershell
& infra/tests.venv/Scripts/python.exe -B -m unittest discover -s ops/tests -p test_tv1_evidence.py -v
```

**LINT — exit 0**
```powershell
& infra/tests.venv/Scripts/cfn-lint.exe infra/cloudformation/00-storage.yaml infra/cloudformation/01-rds-beanstalk-cloudfront.yaml
```

**29 PASS_OFFLINE, 0 FAIL, 0 BLOCKED, 0 SKIP**: 11 F013 + 18 F012 regression. cfn-lint exit 0; AST và Git diff check đạt. Actual output/timestamps/source hashes trước-sau từng command có trong [F013-validation.json](F013-validation.json). Tests không gọi AWS/network hoặc dùng credentials; public source research tách khỏi offline validation.

| Test ID | File/function | Expected / actual | Result |
|---|---|---|---|
| TC-F013-01 | `ops/tests/test_cost_documentation.py:95` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_01_inventory_matches_cloudformation` | Full logical resource inventory/config defaults match actual CloudFormation; missing resource or falsely pinned EBS rejected. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-02 | `ops/tests/test_cost_documentation.py:107` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_02_versions_logs_snapshot_and_transfer_are_counted` | Increasing retained versions/artifacts/logs/snapshot/transfer usage increases the matching cost component. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-03 | `ops/tests/test_cost_documentation.py:117` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_03_lambda_uses_x86_gb_second_rate` | x86 GB-second rate correct; 512MB conversion, request charge, 1ms rounding and 120s stress result correct; old half-rate rejected. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-04 | `ops/tests/test_cost_documentation.py:133` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_04_allocation_clocks_are_independent` | IPv4/EBS/RDS storage clocks remain independent of EC2/RDS compute hours; negative quantity rejected. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-05 | `ops/tests/test_cost_documentation.py:144` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_05_scenario_totals_and_units` | Every cost component, gross total and contingency recompute; missing component/wrong total rejected. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-06 | `ops/tests/test_cost_documentation.py:160` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_06_credit_free_tier_and_account_claims` | Personal and Lab distinct; credit/Free Tier/budget/spend UNVERIFIED; unsupported verification claim rejected. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-07 | `ops/tests/test_cost_documentation.py:172` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_07_stop_start_and_budget_policies` | RDS restart after 7 days, storage/backup residual charges and budget not a hard cap; wrong policy rejected. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-08 | `ops/tests/test_cost_documentation.py:185` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_08_sources_are_official_dated_and_dimensioned` | Official source hosts, checked date, Region/USD, effective dates and quote dimensions present; Linux/shared/Used and EU edge correctly selected. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-09 | `ops/tests/test_cost_documentation.py:202` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_09_cleanup_covers_retained_and_external_resources` | Cleanup covers app-before-storage, Retain buckets/logs, object versions, snapshots, EIP/EBS/artifacts, Billing; SNS/CPU extras cost nonzero when used. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-10 | `ops/tests/test_cost_documentation.py:214` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_10_only_documentation_and_direct_tests_change` | F013 changeset restricted to docs/direct tests; implementation and F001–F012 history retained. Actual: unittest ok. | PASS_OFFLINE |
| TC-F013-11 | `ops/tests/test_cost_documentation.py:226` — `test_cost_documentation.CostDocumentationTests.test_TC_F013_11_local_document_links_resolve` | Local Markdown file and explicit directory links resolve. Actual: unittest ok. | PASS_OFFLINE |

RED → GREEN: original guide rate 0.0000083 so với expected 0.0000166667 làm cùng core assertion TC-F013-03 FAIL (exit 1); sau sửa docs/model core assertion PASS. Các negative cases còn kiểm thiếu resource/component, sai EBS pin, sai total/half-rate, negative hours, forged credit verification, sai 7-day behavior/hard-cap claim. Failures/harness attempts được giữ trong validation JSON và local logs; directory link valid và Git UTF-8 checker đã sửa đúng semantics, không làm yếu assertion về target tồn tại hay cost.
F012 18-case regression PASS; F013 source-preservation case kiểm templates/deploy/runner/backup/restore không đổi so với F012 HEAD. Scope guard neo vào changeset F013 sau commit để không chặn feature tương lai. Không chạy app/DB/LocalStack E2E vì đây là docs-only change và không dùng kết quả cũ làm AWS PASS.

## Giới hạn và handoff

- Giá TIME_SENSITIVE; usage/root EBS/edge location/billed backup size chỉ ESTIMATED. Kiểm lại deployed config, latest rates và account resources trước launch; không đảm bảo estimate là giá cuối.
- Credit, Free Tier, budget approved, actual spend và account permissions còn UNVERIFIED/ACCOUNT_DEPENDENT. Original AWS budget gate chưa được xác minh trong task này; owner phải kiểm Console và chấp nhận budget trước deployment.
- F005/F006 vẫn BLOCKED; F010 FIXED_LOCAL_PENDING_AWS_VERIFICATION; V001 NOT_RUN. F013 không tuyên bố AWS-ready hoặc xóa các blocker.
- Chỉ docs/tests trực tiếp liên quan; các commit F001–F012 được giữ nguyên. Không push, merge, deploy, cleanup hay tạo AWS resources. Không truy cập stored credentials/tài khoản; chỉ đọc nguồn public AWS.
- Báo cáo/model/validation được lưu và commit ngoài target. Post-commit attestation *.log chỉ local, ignored; cần archive rõ ràng nếu bàn giao cùng bằng chứng HEAD cuối.

STOP AFTER F013.
