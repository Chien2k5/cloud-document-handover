# A06 — Presigned upload protocol

A regression reproduced unsafe frontend acceptance of signed headers without `If-None-Match: *`, with a mismatched MIME type, or with duplicate case-insensitive header names. The client now rejects these responses before sending bytes. It preserves the original URL and all accepted header values; S3 receives neither API cookies nor CSRF. A malformed URL maps to the existing controlled upload error.

UNIT_MOCK: 24 passed; lint PASS. PostgreSQL-backed `UploadIntegrationTest` and offline `S3StorageAdapterTest`: 22 passed, zero skipped/failures/errors. Coverage includes 403/409/412/503, timeouts, missing Version ID, exact-version complete, quota races, idempotency, compensation and rollback. No actual S3 request was made. Red regression evidence is `output/pre-aws-hardening-20261110/A06-red/`; backend evidence is `A06-0c173cb989/`, outside this worktree.

No API or migration change. Signed header validation now fails closed if the server returns an unsafe protocol response. Real AWS signing and CORS remain NOT_RUN.

## A07 — Lambda duplicate validation

The old Python duplicate verifier accepted five timestamp forms that the Java consumer rejects, including a space separator, a compact offset/date, excessive fractional precision, and an offset outside Java's range. The regression failed before the fix. Duplicate verification now checks the supported ISO offset timestamp syntax and offset range before accepting an existing document; it never overwrites that document. Valid UTC and nanosecond offset timestamps remain accepted. An additional malformed-event test verifies no success result is written for missing upload identity fields. PYTHON_OFFLINE: 27 tests passed. Evidence before the fix: `output/pre-aws-hardening-20261110/A07-red/`. Streams, timeout handling, exact Version ID, conditional writes and event-loop avoidance retain their existing coverage. Cross-language acceptance is extended at A08.

## A08 — Cross-language contract

Expanded the original 12 compatibility cases to 29, exercising the actual compiled Java checksum parser and result-key implementation against Python-generated documents. New cases cover Unicode object keys and opaque versions, binary content, boolean/decimal schema and size fields, null/uppercase hashes, contradictory errors, all rejected timestamp forms from A07 (plus offset minute overflow), accepted nanosecond offsets, trailing JSON and oversized documents. JAVA_PYTHON_CONTRACT: 29 passed. Java rejects invalid or FAILED results and never returns a verified hash for them. Missing versus denied storage reads and DRAFT eligibility remain covered by the backend/storage suites; this parser checker deliberately performs no DB or AWS calls.
