# A09–A12 — Version recovery, handover and security

## A09

Reproduced a frontend race: an older polling response could replace a newer VERIFIED/MISMATCH state or change its exact S3 Version ID. `updateVersion` now rejects changes to a pinned S3 identity, downgrades from AVAILABLE, and changes to terminal integrity results. FAILED can still recover to VERIFIED. A deterministic browser regression delays an automatic read until after a manual verification and confirms the download remains enabled. UNIT_MOCK: 25 passed; BROWSER_MOCK: 18 passed; lint/build PASS. The red unit result is recorded in `output/pre-aws-hardening-20261110/A09-red/` outside the worktree.

Existing backend tests independently cover v1/v2 pinning, durable uploadId recovery after a fresh session, bounded result reads, late FAILED recovery, membership rechecks and stale concurrent reconciliation. No API/migration change.

## A10/A11 — PASS_NO_CHANGE

Reviewed the current handover service, frontend payload/actions and 22 PostgreSQL-backed handover integration cases; rerun passed all 22 with zero skips. Evidence: `output/pre-aws-hardening-20261110/A10-A12-4b60ba9450/`. Tests cover invalid/null/duplicate/cross-project input, UTC expiry, unavailable/unverified versions, ownership, disabled recipients, publication rechecks around HEAD, atomic multi-item failure, concurrent publish/confirm/revoke, exact-version downloads, 1-of-2 confirmation versus aggregate state, repeated confirmation/revocation, expired/revoked access, actor/requestId audit and rollback if audit insertion fails. Frontend browser fixtures cover failed actions and aggregate-state reload. No additional production change was justified.

## A12 — PASS_NO_CHANGE beyond the fixes above

Reviewed session fixation/CSRF, active-account checks, authorization boundaries, storage signing, transaction boundaries and sanitized error handling. The A03 HTTP regression (70 checks), A04 project suite (11), A06 upload/storage suites (22), and A10/A11 handover suite (22) passed. These are separate runs, not a combined E2E count. Cross-project IDs return controlled errors; complete/quota races and audit rollback have real separate PostgreSQL transactions. Network storage work is rechecked before committing state. Unexpected client errors expose a generic message/requestId, not stack traces or SQL. Signed request string representations are redacted. No production access bypass, public-bucket setting or secret was added.

AWS IAM, HTTPS termination, actual S3 CORS and access policy are not established by these tests. They remain Chặng B gates. Existing presigned URLs may remain usable until expiry after revocation; only issuance of new links is blocked immediately.
