# A04/A05 — Project permissions and upload initialization

A04 adds a PostgreSQL-backed HTTP regression for pagination boundaries (including overflow-sized offsets), disjoint pages, malformed member roles, forged fields, disabled targets, immediate role changes, and visibility after removal. Existing tests cover owner immutability, Editor/Viewer restrictions, project isolation and null/empty project input. All 11 `BackendIntegrationTest` cases passed with zero skips against an isolated PostgreSQL 17 container, subsequently removed. Evidence: `output/pre-aws-hardening-20261110/A04-8a78674754/` outside the worktree. Production behavior required no change.

A05 adds byte-level binary hashing, MIME fallback, omission of `fileId` for a new document, cancellation during hashing before initialization, and uncertain initialization timeout without blind retry. UNIT_MOCK: 23 passed. Existing upload integration tests cover quota/reservations, unverified client hashes and separate file/version identity; these are rerun at subsequent storage/final checkpoints. No contract or migration change.

These checks do not prove AWS CORS, Versioning, IAM or actual Lambda event delivery.
