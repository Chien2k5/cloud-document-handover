# F012 offline verification evidence

`local-verification.json` and `final-command-results.json` record actual precommit
commands, exit codes, timestamps, HEAD/dirty state, source hashes before/after,
per-test functions and results. The console .txt files show actual unittest output with LF display formatting.
`console-original-bytes.json` retains the original captured bytes/base64 and hashes,
including original upstream UTF-16 logs for RED/first GREEN/baseline. Only carriage
returns and extra final newlines are normalized in the readable previews; PASS/FAIL
text, assertions and exit codes are unchanged. Historical failures are retained.
36 PASS_OFFLINE = 18 F012 tests (12 mandatory + 6 extra), 10 F008 regressions,
8 F010 regressions. cfn-lint ran separately with exit 0. No LocalStack/AWS run is
represented by these PASS labels; current LocalStack summary remains NOT_RUN.

`red-stale-pass.txt` preserves the initial failing regression (exit 1) before the
runner fix; `first-stale-pass-green.txt` preserves its first passing rerun.
`unit-retention-first-attempt.txt` / `offline-command-first-attempt.json` retain a
later FAIL caused by comparing CRLF checkout bytes to Git's LF blob. The corrected
test now proves both exact raw archive retention (-text) and canonical historical
content; it does not discard the failure or weaken content/hash verification.
`offline-command-results.json` and `regression-command-results.json` are earlier
actual runs, superseded for final claims by final-command-results.json.

The tracked report is `docs/tv1/F012-remediation-report.md`; it is not in target/.
`post-commit-verification.log`, created after committing, is a durable local file
ignored by the existing *.log rule. It records final HEAD reruns; it is NOT part
of the commit. Export/archive that file explicitly with this directory when
handing off final HEAD evidence. A commit cannot embed its own resulting hash.

No AWS APIs, credentials, deployment, database changes or new dependencies were
used. Metadata tool probes are local git/docker-client/java version commands.
