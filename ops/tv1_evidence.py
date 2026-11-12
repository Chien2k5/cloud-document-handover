"""Bounded TV1 claims and crash-safe, per-run evidence. Standard library only."""
import datetime
import hashlib
import importlib.metadata
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

# Each PASS is limited to the listed observations, not the whole acceptance criterion.
CLAIMS = {
    "nginxRootRedirectToPortal": ("HTTP root redirects to /portal/", ("status", "location")),
    "nginxPortalIndexAndNoStore": ("Python GET index: asset reference and no-store header only", ("status", "asset_reference", "no_store")),
    "nginxApiReverseProxyHealthUp": ("HTTP health endpoint reports UP", ("status", "up")),
    "K03_pythonUploadAndComplete": ("Python PUT observes Version ID; complete returns identifiers; no browser CORS claim", ("three_uploads", "version_ids")),
    "K04_verifiedAndMismatchStates": ("Observed v1/v2 VERIFIED with matching hash; tampered upload MISMATCH", ("v1", "v2", "mismatch")),
    "K05_duplicateEventSkip": ("One explicitly replayed event returns created=0, skipped=1; not absence of notification loops", ("duplicate_result",)),
    "K07_selectOlderVersionAfterV2": ("Package CREATED AFTER v2 selects/downloads v1; not immutability of an already-published package", ("distinct_versions", "versioned_url", "download_status", "v1_bytes", "confirmed")),
    "K11_restoreAndReferencePreservation": ("Child restore report plus 11 tables, 18 FK, rollback and reference preservation; not every file VERIFIED", ("restore_status", "tables", "foreign_keys", "rollback", "references")),
    "K13_sameArtifactRestartOnRestoredDb": ("Same JAR restarted on restored DB; login, confirmed package and v1 download; not deployment/version update", ("same_jar", "login", "confirmed", "download_status", "v1_bytes")),
    "frontendJsCssFetch": ("JS/CSS resources not fetched by this runner", ()),
    "browserRendering": ("No browser rendering test", ()),
    "browserCors": ("Python HTTP does not enforce browser CORS", ()),
    "K07_publishedPackageSurvivesLaterUpload": ("No package-before-v2 temporal test", ()),
    "K12_iam": ("No effective IAM assertions in this runner", ()),
    "K12_bucketPolicy": ("No bucket policy enforcement assertion in this runner", ()),
    "K12_secretScan": ("No repository/log secret scan performed by this runner", ()),
    "K13_deploymentVersionUpdate": ("No deploy/redeploy script or application-version update", ()),
}

def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def atomic_json(path, document):
    """Replace only complete UTF-8 JSON; keep the previous valid file on failure."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".tv1-", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(document, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()

def source_snapshot(root):
    root = Path(root)
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True, encoding="utf-8").strip()
    names = git("ls-files", "--cached", "--others", "--exclude-standard", "--", "ops", "infra", "deploy", "aws/lambda").splitlines()
    hashes = {name: file_hash(root / name) for name in sorted(set(names)) if (root / name).is_file()}
    # Hash built artifacts too; this identifies bytes, not a reproducible-build proof.
    artifacts = [root / "backend/target/document-handover-0.1.0-SNAPSHOT.jar"]
    artifacts += sorted((root / "frontend/dist").rglob("*")) if (root / "frontend/dist").is_dir() else []
    return {"gitHead": git("rev-parse", "HEAD"), "gitStatus": git("status", "--porcelain"),
            "sourceHashes": hashes, "artifactHashes": {str(p.relative_to(root)): file_hash(p) for p in artifacts if p.is_file()}}

def tool_versions():
    versions = {"python": sys.version.split()[0]}
    for name in ("boto3", "botocore"):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "NOT_AVAILABLE"
    for name, args in {"git": ["git", "--version"], "dockerClient": ["docker", "--version"], "java": ["java", "-version"]}.items():
        try:
            result = subprocess.run(args, capture_output=True, text=True, timeout=5)
            patterns = {"git": r"git version ([0-9][A-Za-z0-9.+_-]*)", "dockerClient": r"Docker version ([0-9][A-Za-z0-9.+_-]*)", "java": r'(?:openjdk|java) version "([0-9][A-Za-z0-9.+_-]*)"'}
            match = re.search(patterns[name], result.stdout + result.stderr)
            versions[name] = match[1] if result.returncode == 0 and match else "NOT_AVAILABLE"
        except (OSError, subprocess.TimeoutExpired):
            versions[name] = "NOT_AVAILABLE"
    return versions

class EvidenceRun:
    def __init__(self, root, evidence_root, claims=None):
        self.root = Path(root)
        self.base = Path(evidence_root)
        self.run_id = uuid.uuid4().hex
        self.directory = self.base / "runs" / self.run_id
        self.lock = self.base / ".current-run.lock"
        self.owns_lock = False
        self.started = False
        self.specs = CLAIMS if claims is None else claims
        self.document = {"schemaVersion": 2, "runId": self.run_id, "startedAt": utc_now(),
                         "environment": "localstack-emulation", "awsCloudStatus": "NOT_RUN", "status": "RUNNING", "exitCode": None,
                         "command": [sys.executable, str(self.root / "ops/verify_tv1_local_stack.py")],
                         "provenance": None, "toolVersions": {}, "artifacts": {},
                         "checks": {key: {"wording": wording, "status": "NOT_RUN", "requiredAssertions": list(required), "assertions": []}
                                    for key, (wording, required) in self.specs.items()}}

    def begin(self):
        self.base.mkdir(parents=True, exist_ok=True)
        # One writer: an interrupted lock is evidence to inspect, never auto-delete it.
        descriptor = os.open(self.lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        self.owns_lock = True
        with os.fdopen(descriptor, "w", encoding="ascii") as stream:
            stream.write(self.run_id)
        self.directory.mkdir(parents=True)
        # Publish RUNNING before provenance, dependencies, processes or checks.
        self.started = True
        self.publish()

    def capture(self):
        self.document["provenance"] = source_snapshot(self.root)
        self.document["toolVersions"] = tool_versions()
        self.publish()

    def publish(self):
        self.document["counts"] = {status: sum(c["status"] == status for c in self.document["checks"].values()) for status in ("PASS", "FAIL", "PARTIAL", "BLOCKED", "NOT_RUN")}
        atomic_json(self.directory / "00-summary.json", self.document)
        atomic_json(self.base / "00-summary.json", self.document)

    def check(self, claim, assertion, actual, expected):
        record = self.document["checks"][claim]
        if assertion not in record["requiredAssertions"]:
            raise ValueError("Unregistered assertion")
        # Only bounded primitive observations, never HTTP bodies, URLs, credentials or exception strings.
        if type(actual) not in (bool, int) or type(expected) is not type(actual):
            raise ValueError("Evidence observations must be bool/int of the same type")
        passed = actual == expected
        record["assertions"].append({"id": assertion, "actual": actual, "expected": expected, "passed": passed, "at": utc_now()})
        present = {item["id"] for item in record["assertions"] if item["passed"]}
        record["status"] = "PASS" if present == set(record["requiredAssertions"]) and all(item["passed"] for item in record["assertions"]) else "PARTIAL"
        if not passed:
            record["status"] = "FAIL"
            self.document.update(status="FAIL", exitCode=1)
        self.publish()
        if not passed:
            raise AssertionError("TV1 assertion failed: " + claim + "/" + assertion)

    def artifact(self, name, path):
        path = Path(path)
        relative = path.resolve().relative_to(self.directory.resolve())
        self.document["artifacts"][name] = {"path": str(relative), "sha256": file_hash(path)}
        self.publish()

    def complete(self):
        checks = self.document["checks"]
        if self.document["status"] == "FAIL":
            raise RuntimeError("Failed run cannot complete")
        if set(checks) != set(self.specs):
            raise RuntimeError("Missing claim records")
        if not checks:
            raise RuntimeError("Missing required assertions")
        for key, record in checks.items():
            required = set(self.specs[key][1])
            observed = {item["id"] for item in record["assertions"] if item["passed"] is True}
            if required and (record["status"] != "PASS" or observed != required or not all(item["passed"] is True for item in record["assertions"])):
                raise RuntimeError("Missing or failed required assertions")
            if not required and record["status"] == "PASS":
                raise RuntimeError("Missing assertions for a PASS claim")
        if self.document["provenance"] is None:
            raise RuntimeError("Missing source provenance")
        ending = source_snapshot(self.root)
        self.document["sourceSnapshotEnd"] = ending
        start = self.document["provenance"]
        if any(start[key] != ending[key] for key in ("gitHead", "sourceHashes", "artifactHashes")):
            raise RuntimeError("Source or artifact bytes changed during execution")
        self.document.update(status="PASS" if all(c["status"] == "PASS" for c in checks.values()) else "PARTIAL",
                             completedAt=utc_now(), exitCode=0)
        self.document["counts"] = {status: sum(c["status"] == status for c in checks.values()) for status in ("PASS", "FAIL", "PARTIAL", "BLOCKED", "NOT_RUN")}
        self.publish()

    def fail(self, error):
        if not self.started:
            return
        code = error.code if isinstance(error, SystemExit) and type(error.code) is int and error.code != 0 else 130 if isinstance(error, KeyboardInterrupt) else 1
        # Exception text/subprocess args can contain credentials; retain type and exit code only.
        self.document.update(status="FAIL", failureType=type(error).__name__, exitCode=code, completedAt=utc_now())
        if isinstance(error, subprocess.CalledProcessError):
            self.document["dependencyExitCode"] = error.returncode if type(error.returncode) is int else None
        self.document["counts"] = {status: sum(c["status"] == status for c in self.document["checks"].values()) for status in ("PASS", "FAIL", "PARTIAL", "BLOCKED", "NOT_RUN")}
        self.publish()

    def close(self):
        if self.owns_lock:
            if self.lock.read_text(encoding="ascii") != self.run_id:
                raise RuntimeError("Evidence lock ownership mismatch")
            self.lock.unlink()
            self.owns_lock = False
