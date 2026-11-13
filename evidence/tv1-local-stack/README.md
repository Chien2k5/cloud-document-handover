# TV1 local evidence — current versus historical

`00-summary.json` is the current LocalStack E2E state. F012 migrated it to
`NOT_RUN`: no corrected E2E run has executed. Offline/unit test PASS is recorded
separately in `evidence/f012/`; it is not LocalStack or AWS E2E PASS.

The original summary is retained byte-for-byte at
`historical/pre-f012/00-summary.json`. The other five original artifacts remain
at their existing paths and are **historical**, including the backup manifest,
restore result/report and backend startup log. `historical-index.json` records
hashes observed at correction time and canonical Git blob SHA-256. The archived
summary uses -text to retain its original CRLF bytes across checkouts; the five
unchanged text artifacts may use platform checkout line endings. These hashes are
retention checks, not proof
of the source bytes used by the historical run. The legacy ancestor SHA is left
untouched; missing executed-source hashes cannot be reconstructed as fact.
The audit does not establish evidence fabrication.

Read `docs/tv1/F012-claim-map.md` before accepting historical PASS labels. Static
index, Python HTTP, v1 selection after v2, same-JAR restart and restore preservation
have distinct coverage boundaries. Security/browser/real deployment claims are
not implied. Historical PASS never means current HEAD or AWS PASS.

Future runner invocations publish RUNNING here before dependency/service setup;
each run also writes `runs/<run-id>/00-summary.json` and its own artifacts.
Exceptions, SystemExit, assertion and cleanup failures publish FAIL and propagate.
A completed narrow flow may be PARTIAL overall because unsupported claims remain
NOT_RUN. Exit 0 alone does not establish full acceptance. JSON replacement is
atomic; a hard process kill can leave RUNNING and an ownership lock, never a new
PASS. Inspect the recorded run/process before manually recovering an interrupted
`.current-run.lock`; the runner refuses concurrent writers and never auto-deletes
someone else's lock. Filesystem write failure propagates; a prior RUNNING file
may remain when failure cannot be persisted.

`runs/` and generated backend logs are ignored runtime data. Retain/export them
explicitly when handing off a real run, after reviewing for sensitive content.
The bounded JSON journal omits exception messages, subprocess arguments, HTTP
bodies, presigned URLs and environment values. This is not a claim that arbitrary
raw child/backend logs have undergone a security scan.
