# PRE_AWS readiness — 2026-11-10

Assessment: **READY_WITH_DOCUMENTED_BLOCKERS**. Chặng B: **BLOCKED_WAITING_FOR_CHIEN**.
This is application hardening and local verification, not an AWS deployment acceptance.

## Git and scope

Branch `task/C08-pre-aws-hardening` is based on `dung@eb6f7c7cb8d05c9187b59d39986796fcaec2fe59`.
PR #4 was reviewed and merged by merge commit after Dũng explicitly approved the three documents.
The original commits/authors and Nam/Đăng branches were preserved. `main` was not changed.
The work uses a separate worktree; the user's preexisting local files and Nextcloud data were retained.
See [baseline](../verification/pre-aws-baseline.md) and the checkpoint report for exact commits/files/tests/push results.

Production changes are limited to frontend CSRF/session response handling, signed upload header validation,
terminal version-state protection, and Lambda duplicate timestamp validation. No API/schema, migration,
JWT, user directory, production test route, AWS resource, or production dependency upgrade was introduced.
The YAML parser added for OpenAPI tests is a locked development dependency.

## Findings and decisions

| Priority | Finding | Resolution / evidence |
| --- | --- | --- |
| P1 | Concurrent initial writes could race anonymous CSRF/cookies | Single shared bootstrap per auth epoch; RED then GREEN regression |
| P1 | A delayed 401 could invalidate a newer login | Only the current epoch invalidates; stale successful responses rejected |
| P1 | Unsafe signed upload headers could reach PUT | Require MIME match, `If-None-Match: *`, unique case-insensitive header names before PUT |
| P1 | Python accepted duplicate timestamps rejected by Java | Strict supported offset timestamp syntax/range; 29 cross-language cases |
| P1 | Late polling could downgrade terminal integrity or change a pinned S3 version | Monotonic AVAILABLE/VERIFIED/MISMATCH and exact identity guards; delayed browser regression |
| P2 | No multi-layer browser business test | Test-classpath-only HTTPS storage, actual Spring/PG/React, 2 browser cases |
| P2 | Restore failure atomicity had not been exercised | Deliberate conflict in a third disposable DB proves single-transaction rollback |
| P2 | Evidence path reuse could overwrite a historical local run | Unique run directories and exclusive summary creation; old incident disclosed in baseline |
| P2 | No reproducible CI entry point | Least-privilege PRE_AWS workflow; AWS secrets/deployment absent |

Project/membership implementation, backend upload/quota/idempotency, DRAFT/publish, confirmation/revoke/expiry,
authorization and transaction rollback required no further production changes after review and focused tests.
See [contract trace](../verification/api-traceability.md), [auth](../verification/auth-hardening.md),
[storage/Lambda](../verification/storage-lambda-hardening.md), [versions/security](../verification/version-handover-security.md),
[business E2E](../verification/local-business-e2e.md), and [restore](../verification/pre-aws-local-recovery.md).

## Test levels and limits

Final automated results and code commit are recorded in the checkpoint report. Do not add counts across repeated runs.
The intended suites are UNIT_MOCK (25 frontend), BROWSER_MOCK (18), PYTHON_OFFLINE (27), JAVA_PYTHON_CONTRACT (29),
LOCAL_REAL_BACKEND (63 backend suite cases: 49 real-PG integration plus 14 unit/contract/storage; 3 live browser cases),
and LOCAL_REAL_BACKEND_WITH_TEST_STORAGE (2 business browser cases with the backend suite rerun).
Every backend integration run uses a new PostgreSQL 17 container; zero skips are required.
The business fixture hashes real uploaded bytes but does not execute Python Lambda or emulate AWS IAM/signatures.
The packaged production JAR must exclude that fixture. Frontend and backend artifact hashes are compared across builds.

Local restore passed 11 table snapshots, 18 foreign keys, 51 HTTP checks per run, and deliberate failure rollback.
Raw dumps, keys, cookies, presigned URLs, traces and logs are excluded from committed evidence.
npm audit checks locked npm dependencies; it is not a Maven/Python dependency vulnerability scan.
ESLint 9 remains an already-documented unsupported development tool; a supported toolchain update needs a scoped follow-up.
No known failing application regression remains after the recorded checks; infrastructure behavior remains unverified.

GitHub CI is distinct from local execution: see the checkpoint report for the actual observed workflow URL/status.
Never infer CI PASS from the workflow file. CI uses pinned action SHAs verified against their official repositories,
`contents: read`, no persisted checkout credentials, no AWS secrets and no cloud deployment step.

## Reproduce

Requires Docker, JDK 21+ with `keytool`, Node 24.15.0, Python 3.13, Maven access/cache, and Chrome.
From repository root: `python tools/run_preaws_checks.py`. Windows may use
`--offline --maven <cached-mvn.cmd>` after dependencies are cached. For installed Playwright Chromium use
`PW_CHANNEL=chromium`; install with `npx playwright install --with-deps chromium` from frontend first.
Each run creates `runtime-data/preaws-<unique id>/verification.json`, source hashes and separate logs.
An existing evidence summary is never overwritten. No shared DB settings are used.

For auth expiry: `backend/tools/run_phase1_http_regression.py` with a disposable DB and native `psql` as its README specifies.
For recovery: follow [local restore runbook](../week-04/local-restore-runbook.md), compatible native PG tools,
a loopback disposable server, and a new evidence directory. Recovery archives remain ignored.

## Required inputs from Chiến

Supply the **actual infrastructure branch or PR plus immutable commit SHA**, with implementation and runbooks
in `infra/`, `deploy/`, `ops/`. No branch name is invented here. At the baseline audit these directories
on `dung` had no infrastructure implementation; this says nothing about work outside the supplied repository.
Include environment provisioning, EB platform/bundle/proxy, DB networking/TLS/migration/rollback, IAM/CORS,
S3 Versioning/notifications, Lambda packaging/configuration, monitoring/backup/cost and cleanup instructions.

Confirm nonsecret staging identifiers: AWS account/environment name and region, bucket name/region,
Versioning status, role ARNs/policy resources (including KMS if used), Lambda name/runtime/timeout/memory,
notification prefix `uploads/`, result prefix `results/`, public HTTPS origin, health path,
Java SE platform compatible with Java 21, backend/proxy ports and instance/session topology.
Provide an authorized deployer and an explicitly authorized staging test environment. Supply credentials through
the approved runtime secret channel, never GitHub documents or frontend `VITE_*` values.

| Configuration names | Required agreement |
| --- | --- |
| `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` | Separate private portal DB, TLS verified, least-privilege runtime account; secret outside Git |
| `SERVER_PORT`, `PORT` | Explicit matching application/proxy ports; app currently reads SERVER_PORT |
| `SPRING_PROFILES_ACTIVE`, `SESSION_COOKIE_SECURE` | No local seed profile; Secure cookie true under HTTPS |
| `LOCAL_DEMO_PASSWORD` | Unset in AWS; provision real portal users separately |
| `UPLOAD_S3_ENABLED`, `UPLOAD_BUCKET`, `AWS_REGION` | Enable only with actual bucket/role setup; same exact bucket for Java/Lambda |
| `UPLOAD_TTL_SECONDS`, `UPLOAD_EXPIRY_DELAY_MS`, `PROJECT_QUOTA_BYTES` | Review current limits; TTL 1..300 seconds |
| Instance and Lambda execution roles | SDK role credentials; no hardcoded access keys |

Current sessions live in process memory. Start with one instance or supply a tested affinity/shared-session plan;
do not claim sessions survive a process restart. Revoke/expiry stops issuing new signed links; existing links can
remain usable until their own expiry. Local Nextcloud on 8081 is separate from portal accounts/storage.
Detailed integration guidance remains in [AWS handover](aws-deployment-handover.md); its earlier test counts are historical.

## Twelve AWS acceptance gates — all NOT_RUN

| Gate | Expected proof / owner |
| --- | --- |
| 1 Login/HTTPS/session/CSRF | Actual HTTPS cookie/rotation/expiry under deployed proxy — Chiến + Dũng + Nam |
| 2 Project/membership | Real staged Owner/Editor/Viewer and cross-project denials — Dũng + Nam |
| 3 S3 upload/version | Real conditional PUT and exposed exact Version ID — Đăng + Nam |
| 4 Lambda event | uploads/ event, correct version and results/ write, no loop — Đăng + Chiến |
| 5 VERIFIED/MISMATCH | Valid and deliberately wrong expected hash, denied/outage distinguished — Đăng + Dũng |
| 6 DRAFT | Only eligible project versions/recipients, exact v1 pin — Dũng + Nam |
| 7 Publish | HEAD/rechecks, READY only on complete success — Dũng + Đăng |
| 8 Confirm | Two recipients, individual and aggregate status/audit — Dũng + Nam |
| 9 Exact download | Download bytes and SHA/version match even after v2 — Đăng + Dũng + Nam |
| 10 Revoke/expiry | No new URLs, history retained, old URL TTL documented — Dũng + Nam |
| 11 Backup/restore | Authorized AWS DB/object recovery with constraints/manifests intact — Chiến + Dũng + Đăng |
| 12 IAM/log/cost | Private bucket, least privilege, safe CloudWatch logs and cost/cleanup evidence — Chiến + Đăng |

For each gate record test ID, actual source SHA, environment/time, synthetic input, expected/actual outcome,
sanitized evidence, executor and actual approver (never invent approval). Chiến deploys the reviewed build;
Dũng handles backend/contract/data defects; Đăng storage/Lambda defects; Nam UI/browser behavior.

Chặng B can begin only in a **new user-requested Codex run** with those actual inputs and permissions.
Then fetch/review infrastructure, reconcile configuration, create a separate integration branch preserving history,
have Chiến deploy, and execute the twelve gates. No background tracking or automatic B01–B05 continuation is scheduled.
