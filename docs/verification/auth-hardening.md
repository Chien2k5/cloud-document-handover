# A03 — Session and CSRF regression

Two frontend defects were reproduced before changing `ApiClient`:

- Concurrent first mutations independently bootstrapped CSRF, allowing anonymous session cookies to race. Requests now share one bootstrap within the current authentication epoch.
- A delayed 401 from an earlier session cleared the newly logged-in session. Responses now invalidate only their own epoch; stale successful responses are rejected as `SESSION_CHANGED`.

Both regression tests failed against the previous implementation and pass after the fix. Authentication changes invalidate the cached CSRF token; login/logout refresh it. Mutations are never automatically retried. Cancelled callers stop before sending a mutation after a shared bootstrap.

Validation on 2026-11-10: frontend lint/build PASS; UNIT_MOCK 22/22; BROWSER_MOCK 17/17. LOCAL_REAL_BACKEND HTTP regression passed 70 assertions against an isolated PostgreSQL 17 database, including cookie/session fixation, CSRF rotation, disabled accounts and actual session expiry. The test database was removed. Local raw evidence: `output/pre-aws-hardening-20261110/A03-red/` and `A03-68b40dd4e2/` outside this worktree. No AWS test was run.

No backend API, cookie policy, migration, or authentication architecture changed. No password or session token is persisted in browser storage. The new tests use synthetic tokens only.
