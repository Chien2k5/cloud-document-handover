"""F012 executable checks; no Docker daemon, database, AWS API or credentials."""
import importlib.util
import ast
import hashlib
import os
import subprocess
import uuid
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops"))
spec = importlib.util.spec_from_file_location("f012_runner", ROOT / "ops/verify_tv1_local_stack.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
import tv1_evidence as evidence
class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="f012-evidence-")
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.single = {"observed": ("Actual local file observation", ("exists",))}

    def run_evidence(self, claims=None):
        result = evidence.EvidenceRun(ROOT, self.folder, self.single if claims is None else claims)
        result.begin()
        self.addCleanup(result.close)
        result.capture()
        return result

    def current(self):
        return json.loads((self.folder / "00-summary.json").read_text(encoding="utf-8"))

    def routing(self, run, bad=False):
        responses = [(302, {"location": "/portal/"}, b""),
                     (200, {"cache-control": "no-store"}, b"broken" if bad else b'<script src="/portal/assets/main.js"></script>'),
                     (200, {}, b'{"status":"UP"}')]
        with patch.object(runner, "raw_http", side_effect=responses) as http:
            runner.check_routing(run)
        return http

    def test_TC_F012_01_pass_requires_real_observation(self):
        run = self.run_evidence()
        path = self.folder / "probe.txt"
        path.write_bytes(b"actual input")
        run.check("observed", "exists", path.is_file(), True)
        run.complete()
        self.assertEqual(self.current()["status"], "PASS")
        self.assertEqual(self.current()["checks"]["observed"]["assertions"][0]["actual"], True)
        run.fail(RuntimeError("failure after observations"))
        with self.assertRaisesRegex(RuntimeError, "Failed run"):
            run.complete()
        self.assertEqual(self.current()["status"], "FAIL")
        # Same production journal, changed input -> failed assertion, never PASS.
        path.unlink()
        with self.assertRaises(AssertionError):
            run.check("observed", "exists", path.is_file(), True)
        self.assertEqual(self.current()["checks"]["observed"]["status"], "FAIL")
        self.assertEqual(self.current()["status"], "FAIL")

    def test_TC_F012_02_missing_and_unknown_assertions_rejected(self):
        run = self.run_evidence()
        with self.assertRaisesRegex(RuntimeError, "Missing"):
            run.complete()
        self.assertNotEqual(self.current()["status"], "PASS")
        with self.assertRaises(ValueError):
            run.check("observed", "invented", True, True)
        with self.assertRaises(ValueError):
            run.check("observed", "exists", "true", "true")
        with self.assertRaises(KeyError):
            run.check("invented", "exists", True, True)

    def test_TC_F012_03_success_then_failure_updates_current(self):
        first = self.run_evidence()
        first.check("observed", "exists", self.folder.is_dir(), True)
        first.complete()
        historical = (first.directory / "00-summary.json").read_bytes()
        first.close()
        second = self.run_evidence()
        self.assertEqual(self.current()["status"], "RUNNING")
        self.assertNotEqual(first.run_id, second.run_id)
        with self.assertRaises(AssertionError) as caught:
            second.check("observed", "exists", (self.folder / "absent").exists(), True)
        second.fail(caught.exception)
        self.assertEqual(self.current()["status"], "FAIL")
        self.assertEqual(self.current()["runId"], second.run_id)
        self.assertEqual(self.current()["exitCode"], 1)
        self.assertEqual((first.directory / "00-summary.json").read_bytes(), historical)

    def test_TC_F012_04_exception_cannot_leave_current_pass(self):
        folder = self.folder
        current = folder / "00-summary.json"
        for error in (RuntimeError("injected preflight failure"), SystemExit(7), SystemExit(0), KeyboardInterrupt()):
            with self.subTest(error=type(error).__name__):
                current.write_text(json.dumps({"status": "PASS", "runId": "prior"}), encoding="utf-8")
                def fail_preflight(*args):
                    self.assertEqual(self.current()["status"], "RUNNING")
                    raise error
                with patch.object(runner, "EVIDENCE_DIR", folder), patch.object(runner, "prepare_stack", side_effect=fail_preflight):
                    with self.assertRaises(type(error)):
                        runner.main()
                document = self.current()
                self.assertEqual(document["status"], "FAIL")
                self.assertEqual(document["failureType"], type(error).__name__)
                self.assertEqual(document["exitCode"], 7 if isinstance(error, SystemExit) and error.code == 7 else 130 if isinstance(error, KeyboardInterrupt) else 1)
                self.assertFalse((folder / ".current-run.lock").exists())

    def test_TC_F012_05_index_is_not_asset_or_browser_verification(self):
        keys = ["nginxRootRedirectToPortal", "nginxPortalIndexAndNoStore", "nginxApiReverseProxyHealthUp", "frontendJsCssFetch", "browserRendering"]
        run = self.run_evidence({key: evidence.CLAIMS[key] for key in keys})
        http = self.routing(run)
        self.assertEqual(http.call_count, 3)
        self.assertTrue(all("/assets/" not in call.args[1] for call in http.call_args_list))
        run.complete()
        self.assertEqual(self.current()["checks"]["nginxPortalIndexAndNoStore"]["status"], "PASS")
        self.assertEqual(self.current()["checks"]["frontendJsCssFetch"]["status"], "NOT_RUN")
        self.assertEqual(self.current()["checks"]["browserRendering"]["status"], "NOT_RUN")
        with self.assertRaises(AssertionError):
            self.routing(run, bad=True)
        self.assertEqual(self.current()["checks"]["nginxPortalIndexAndNoStore"]["status"], "FAIL")

    def test_TC_F012_06_python_http_does_not_prove_cors(self):
        run = self.run_evidence()
        run.check("observed", "exists", self.folder.is_dir(), True)
        self.assertEqual(evidence.CLAIMS["browserCors"][1], ())
        with self.assertRaises(ValueError):
            run.check("observed", "exists", "header observed", "header observed")
        full = evidence.EvidenceRun(ROOT, self.folder / "separate")
        full.begin()
        self.addCleanup(full.close)
        self.assertEqual(full.document["checks"]["browserCors"]["status"], "NOT_RUN")
        with self.assertRaises(ValueError):
            full.check("browserCors", "python_success", True, True)

    def test_TC_F012_07_k07_is_selection_after_v2_not_temporal_immutability(self):
        key = "K07_selectOlderVersionAfterV2"
        run = self.run_evidence({key: evidence.CLAIMS[key], "K07_publishedPackageSurvivesLaterUpload": evidence.CLAIMS["K07_publishedPackageSurvivesLaterUpload"]})
        first, second = b"actual v1", b"actual v2"
        run.check(key, "distinct_versions", first != second, True)
        runner.check_pinned_download(run, "https://fixture.invalid/object?versionId=v1", 200, first, hashlib.sha256(first).hexdigest())
        run.check(key, "confirmed", True, True)
        run.complete()
        self.assertEqual(self.current()["checks"][key]["status"], "PASS")
        self.assertEqual(self.current()["checks"]["K07_publishedPackageSurvivesLaterUpload"]["status"], "NOT_RUN")
        with self.assertRaises(AssertionError):
            runner.check_pinned_download(run, "https://fixture.invalid/object?versionId=v2", 200, second, hashlib.sha256(first).hexdigest())

    def test_TC_F012_08_restart_is_not_redeployment(self):
        key = "K13_sameArtifactRestartOnRestoredDb"
        run = self.run_evidence({key: evidence.CLAIMS[key], "K13_deploymentVersionUpdate": evidence.CLAIMS["K13_deploymentVersionUpdate"]})
        content = b"restored original"
        digest = hashlib.sha256(content).hexdigest()
        runner.check_restored_restart(run, {"id": "viewer"}, {"status": "CONFIRMED"}, 200, content, digest, "jar-digest-1", "jar-digest-1")
        run.complete()
        self.assertEqual(self.current()["checks"][key]["status"], "PASS")
        self.assertEqual(self.current()["checks"]["K13_deploymentVersionUpdate"]["status"], "NOT_RUN")
        with self.assertRaises(AssertionError):
            runner.check_restored_restart(run, {"id": "viewer"}, {"status": "CONFIRMED"}, 200, content, digest, "jar-digest-1", "jar-digest-2")

    def test_TC_F012_09_k12_does_not_invent_security_assertions(self):
        keys = [key for key in evidence.CLAIMS if key.startswith("K12_")]
        self.assertEqual(set(keys), {"K12_iam", "K12_bucketPolicy", "K12_secretScan"})
        run = self.run_evidence({key: evidence.CLAIMS[key] for key in keys})
        for key in keys:
            self.assertEqual(self.current()["checks"][key]["status"], "NOT_RUN")
            with self.assertRaises(ValueError):
                run.check(key, "source_read", True, True)
        run.complete()
        self.assertEqual(self.current()["counts"]["PASS"], 0)
        self.assertEqual(self.current()["status"], "PARTIAL")
        run.document["checks"][keys[0]]["status"] = "PASS"
        with self.assertRaisesRegex(RuntimeError, "Missing assertions"):
            run.complete()

    def test_TC_F012_10_source_hashes_and_run_id_are_traceable(self):
        run = self.run_evidence()
        document = self.current()
        self.assertRegex(run.run_id, r"^[0-9a-f]{32}$")
        self.assertEqual(document["provenance"]["gitHead"], subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip())
        for path in ("ops/verify_tv1_local_stack.py", "ops/tv1_evidence.py", "infra/cloudformation/00-storage.yaml", "deploy/deploy_aws.ps1"):
            self.assertEqual(document["provenance"]["sourceHashes"][path], evidence.file_hash(ROOT / path))
        self.assertIn("gitStatus", document["provenance"])
        self.assertIn("python", document["toolVersions"])
        artifact = run.directory / "manifest.json"
        artifact.write_bytes(b'{"fixture":true}')
        run.artifact("fixture", artifact)
        self.assertEqual(self.current()["artifacts"]["fixture"]["sha256"], evidence.file_hash(artifact))
        run.check("observed", "exists", artifact.exists(), True)
        snapshot = evidence.source_snapshot(ROOT)
        snapshot["sourceHashes"]["ops/verify_tv1_local_stack.py"] = "changed"
        with patch.object(evidence, "source_snapshot", return_value=snapshot), self.assertRaisesRegex(RuntimeError, "changed"):
            run.complete()
        self.assertNotEqual(self.current()["status"], "PASS")

    def test_TC_F012_11_non_pass_statuses_are_not_counted_as_pass(self):
        specs = {key: (key, ()) for key in ("not_run", "blocked", "partial")}
        run = self.run_evidence(specs)
        run.document["checks"]["blocked"]["status"] = "BLOCKED"
        run.document["checks"]["partial"]["status"] = "PARTIAL"
        run.complete()
        self.assertEqual(self.current()["status"], "PARTIAL")
        self.assertEqual(self.current()["counts"]["PASS"], 0)
        for key in ("NOT_RUN", "BLOCKED", "PARTIAL"):
            self.assertEqual(self.current()["counts"][key], 1)
        self.assertEqual(self.current()["awsCloudStatus"], "NOT_RUN")
        with self.assertRaisesRegex(RuntimeError, "Missing"):
            empty = self.run_evidence_after_close(run, {})
            empty.complete()

    def run_evidence_after_close(self, prior, specs):
        prior.close()
        return self.run_evidence(specs)

    def test_TC_F012_12_evidence_never_serializes_sensitive_error_or_env(self):
        marker = "sensitive-fixture-" + uuid.uuid4().hex
        with patch.dict(os.environ, {"AWS_SECRET_ACCESS_KEY": marker, "PGPASSWORD": marker}):
            run = self.run_evidence()
            with self.assertRaises(ValueError):
                run.check("observed", "exists", marker, marker)
            run.fail(subprocess.CalledProcessError(4, ["fake", "--password", marker], output=marker, stderr=marker))
        for path in self.folder.rglob("*.json"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn(marker, text)
            self.assertNotIn("--password", text)
        probe = subprocess.CompletedProcess(["fixture"], 0, stdout=marker, stderr=marker)
        with patch.object(evidence.subprocess, "run", return_value=probe):
            self.assertNotIn(marker, json.dumps(evidence.tool_versions()))
        self.assertEqual(self.current()["dependencyExitCode"], 4)
        self.assertEqual(self.current()["failureType"], "CalledProcessError")
        self.assertEqual(self.current()["status"], "FAIL")

    def test_atomic_failure_leaves_running_valid_json(self):
        run = self.run_evidence()
        run.check("observed", "exists", self.folder.is_dir(), True)
        replace = evidence.os.replace
        def fail_current(source, destination):
            if Path(destination) == self.folder / "00-summary.json":
                raise OSError("injected atomic replacement failure")
            return replace(source, destination)
        with patch.object(evidence.os, "replace", side_effect=fail_current), self.assertRaises(OSError):
            run.complete()
        self.assertEqual(self.current()["status"], "RUNNING")
        self.assertEqual(list(self.folder.glob(".tv1-*")), [])
        run.fail(OSError())
        self.assertEqual(self.current()["status"], "FAIL")

    def test_initial_current_write_failure_records_fail_before_setup(self):
        current = self.folder / "00-summary.json"
        current.write_text(json.dumps({"status": "PASS", "runId": "old"}), encoding="utf-8")
        replace = evidence.os.replace
        failed = []
        def fail_once(source, destination):
            if Path(destination) == current and not failed:
                failed.append(True)
                raise OSError("injected initial write failure")
            return replace(source, destination)
        with patch.object(runner, "EVIDENCE_DIR", self.folder), patch.object(evidence.os, "replace", side_effect=fail_once), patch.object(runner, "prepare_stack") as prepare:
            with self.assertRaises(OSError):
                runner.main()
        prepare.assert_not_called()
        self.assertEqual(self.current()["status"], "FAIL")
        self.assertNotEqual(self.current()["runId"], "old")

    def test_concurrent_writer_is_rejected_without_clobbering_current(self):
        first = self.run_evidence()
        document = self.current()
        second = evidence.EvidenceRun(ROOT, self.folder)
        with self.assertRaises(FileExistsError):
            second.begin()
        second.close()
        self.assertEqual(self.current(), document)
        first.close()
        second.begin()
        self.addCleanup(second.close)
        self.assertEqual(self.current()["runId"], second.run_id)

    def test_cleanup_failure_is_published_and_propagated(self):
        with patch.object(runner, "EVIDENCE_DIR", self.folder), patch.object(runner, "prepare_stack", return_value="fixture"), patch.object(runner.subprocess, "check_output", return_value="fixture-version"), patch.object(runner, "run_checks"), patch.object(runner.OwnedStack, "cleanup", side_effect=RuntimeError("injected cleanup failure")):
            # Capture uses real git; patch only tool boundary after capture.
            with patch.object(evidence.EvidenceRun, "capture", lambda self: None):
                with self.assertRaisesRegex(RuntimeError, "cleanup"):
                    runner.main()
        self.assertEqual(self.current()["status"], "FAIL")

    def test_previous_remediation_source_is_preserved(self):
        baseline = "c42844424044bdb416d8cf88ae9bd2d11248242c"
        old = subprocess.check_output(["git", "show", baseline + ":ops/verify_tv1_local_stack.py"], cwd=ROOT, text=True, encoding="utf-8")
        current = (ROOT / "ops/verify_tv1_local_stack.py").read_text(encoding="utf-8")
        def definitions(text):
            return {node.name: ast.dump(node, include_attributes=False) for node in ast.parse(text).body if isinstance(node, (ast.ClassDef, ast.FunctionDef))}
        before, after = definitions(old), definitions(current)
        for name in ("OwnedStack", "prepare_stack", "local_environment", "start_backend", "stop_backend", "upload_and_complete", "wait_for_integrity", "PortalClient", "raw_http"):
            self.assertEqual(before[name], after[name], name)
        for name in ("infra/cloudformation/00-storage.yaml", "infra/cloudformation/01-rds-beanstalk-cloudfront.yaml", "deploy/deploy_aws.ps1", "ops/backup_db_to_s3.py", "ops/restore_db_from_s3.py"):
            original = subprocess.check_output(["git", "show", baseline + ":" + name], cwd=ROOT, text=True, encoding="utf-8")
            self.assertEqual(original, (ROOT / name).read_text(encoding="utf-8"), name)
        old_readme = subprocess.check_output(["git", "show", baseline + ":infra/README.md"], cwd=ROOT, text=True, encoding="utf-8")
        self.assertEqual(old_readme.split("## F010", 1)[1], (ROOT / "infra/README.md").read_text(encoding="utf-8").split("## F010", 1)[1])

    def test_historical_bytes_are_retained_without_provenance_backfill(self):
        base = ROOT / "evidence/tv1-local-stack"
        index = json.loads((base / "historical-index.json").read_text(encoding="utf-8"))
        self.assertIsNone(index["legacyExecutedSourceHashes"])
        for entry in index["files"]:
            blob = subprocess.check_output(["git", "show", "c42844424044bdb416d8cf88ae9bd2d11248242c:" + entry["originalPath"]], cwd=ROOT)
            self.assertEqual(hashlib.sha256(blob).hexdigest(), entry["canonicalGitBlobSha256"])
            retained = (ROOT / entry["retainedPath"]).read_bytes()
            # Git normalizes tracked text; preserve exact observed worktree bytes for the archive,
            # and separately verify canonical historical content for every artifact.
            self.assertEqual(retained.replace(b"\r\n", b"\n"), blob.replace(b"\r\n", b"\n"))
            if entry["originalPath"].endswith("/00-summary.json"):
                self.assertEqual(hashlib.sha256(retained).hexdigest(), entry["sha256ObservedAtCorrection"])
        original = subprocess.check_output(["git", "show", "c42844424044bdb416d8cf88ae9bd2d11248242c:evidence/tv1-local-stack/00-summary.json"], cwd=ROOT)
        self.assertEqual(original.replace(b"\r\n", b"\n"), (base / "historical/pre-f012/00-summary.json").read_bytes().replace(b"\r\n", b"\n"))
        current = json.loads((base / "00-summary.json").read_text(encoding="utf-8"))
        self.assertEqual(current["status"], "NOT_RUN")
        self.assertIsNone(current["runId"])
        self.assertIsNone(current["provenance"])

if __name__ == "__main__":
    unittest.main(verbosity=2)
