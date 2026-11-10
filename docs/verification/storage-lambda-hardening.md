# A06 — Presigned upload protocol

A regression reproduced unsafe frontend acceptance of signed headers without `If-None-Match: *`, with a mismatched MIME type, or with duplicate case-insensitive header names. The client now rejects these responses before sending bytes. It preserves the original URL and all accepted header values; S3 receives neither API cookies nor CSRF. A malformed URL maps to the existing controlled upload error.

UNIT_MOCK: 24 passed; lint PASS. PostgreSQL-backed `UploadIntegrationTest` and offline `S3StorageAdapterTest`: 22 passed, zero skipped/failures/errors. Coverage includes 403/409/412/503, timeouts, missing Version ID, exact-version complete, quota races, idempotency, compensation and rollback. No actual S3 request was made. Red regression evidence is `output/pre-aws-hardening-20261110/A06-red/`; backend evidence is `A06-0c173cb989/`, outside this worktree.

No API or migration change. Signed header validation now fails closed if the server returns an unsafe protocol response. Real AWS signing and CORS remain NOT_RUN.
