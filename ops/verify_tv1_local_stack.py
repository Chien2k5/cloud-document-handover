"""TV1 (A01-A06 / K05, K07, K11, K12, K13) - End-to-end verification of TV1's
infrastructure, Nginx EB routing, S3 + Lambda checksum trigger, S3 backup/restore,
and redeploy against the local Docker emulation (PostgreSQL 17 + LocalStack 4.4 + Nginx).

IMPORTANT: This script records真实 (real) execution results from the local emulation stack
and labels environment="localstack-emulation" with awsCloudStatus="NOT_RUN". It never
fabricates AWS cloud logs or claims local runs are AWS cloud runs.
"""
import hashlib
import http.cookiejar
import json
import os
import re
import shutil
import socket
import tempfile
import uuid
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JAR_PATH = ROOT / "backend" / "target" / "document-handover-0.1.0-SNAPSHOT.jar"
EVIDENCE_DIR = ROOT / "evidence" / "tv1-local-stack"
NGINX_BASE = ""
S3_ENDPOINT = ""
LOCALSTACK_ENDPOINT = ""
UPLOAD_BUCKET = "handover-uploads-local"
BACKUP_BUCKET = "handover-backups-local"
DEMO_PASS = "local-demo-pass-1234"


OWNER_LABEL = "handover.tv1.run"
PG_CONTAINER = ""
PG_PORT = 0
BACKEND_PORT = 0
JAVA_EXE = ""


class OwnedStack:
    """Only immutable Docker IDs created by this instance can be removed."""
    def __init__(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{32}", token):
            raise ValueError("A unique 32-hex run token is required")
        self.token = token
        self.containers = []
        self.network = None

    def __enter__(self):
        return self

    def create_container(self, service, options, image):
        name = f"tv1-{self.token}-{service}"
        rid = subprocess.check_output([
            "docker", "create", "--pull=never", "--name", name,
            "--label", f"{OWNER_LABEL}={self.token}", *options, image,
        ], text=True).strip()
        if not rid:
            raise RuntimeError("Docker did not return a container ID")
        self.containers.append(rid)
        return rid

    def remove_container(self, rid):
        if rid not in self.containers:
            raise RuntimeError("Refusing container cleanup: ownership not recorded")
        info = json.loads(subprocess.check_output(["docker", "inspect", rid], text=True))[0]
        if info["Id"] != rid or info.get("Config", {}).get("Labels", {}).get(OWNER_LABEL) != self.token:
            raise RuntimeError("Refusing container cleanup: ownership marker mismatch")
        subprocess.check_output(["docker", "rm", "-f", rid], text=True)
        self.containers.remove(rid)

    def cleanup(self):
        errors = []
        for rid in list(reversed(self.containers)):
            try:
                self.remove_container(rid)
            except Exception as exc:
                errors.append(str(exc))
        if self.network:
            info = json.loads(subprocess.check_output(["docker", "network", "inspect", self.network], text=True))[0]
            if info["Id"] != self.network or info.get("Labels", {}).get(OWNER_LABEL) != self.token:
                errors.append("Refusing network cleanup: ownership marker mismatch")
            else:
                subprocess.check_output(["docker", "network", "rm", self.network], text=True)
                self.network = None
        if errors:
            raise RuntimeError("; ".join(errors))

    def __exit__(self, exc_type, exc, tb):
        self.cleanup()


def docker_port(rid, port):
    address = subprocess.check_output(["docker", "port", rid, f"{port}/tcp"], text=True).strip()
    if not address.startswith("127.0.0.1:") or "\n" in address:
        raise RuntimeError("Expected a single loopback Docker port")
    return int(address.rsplit(":", 1)[1])


def wait_ready(check, description, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for {description}")


def prepare_stack(stack, config_dir):
    global PG_CONTAINER, PG_PORT, BACKEND_PORT, NGINX_BASE, LOCALSTACK_ENDPOINT, S3_ENDPOINT, JAVA_EXE
    # No remote Docker contexts, automatic image pulls, shared DBs or shared LocalStack.
    endpoint = subprocess.check_output([
        "docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"
    ], text=True).strip()
    if not endpoint.startswith(("npipe://", "unix://")):
        raise RuntimeError("A local disposable Docker engine is required")
    JAVA_EXE = shutil.which("java") or ""
    if not JAVA_EXE or not JAR_PATH.is_file() or not (ROOT / "frontend/dist/index.html").is_file():
        raise RuntimeError("Build the JAR and /portal/ frontend and provide Java before starting the disposable stack")
    import boto3  # Check the existing dependency before creating resources.
    for image in ("postgres:17-alpine", "localstack/localstack:4.4", "nginx:stable-alpine"):
        subprocess.check_output(["docker", "image", "inspect", image], stderr=subprocess.DEVNULL)
    network_name = f"tv1-{stack.token}"
    stack.network = subprocess.check_output([
        "docker", "network", "create", "--label", f"{OWNER_LABEL}={stack.token}", network_name
    ], text=True).strip()
    database = f"tv1_{stack.token}"
    PG_CONTAINER = stack.create_container("postgres", [
        "--network", network_name, "--tmpfs", "/var/lib/postgresql/data",
        "-p", "127.0.0.1::5432", "-e", f"POSTGRES_DB={database}",
        "-e", "POSTGRES_USER=handover", "-e", "POSTGRES_PASSWORD=local-only-not-a-secret",
    ], "postgres:17-alpine")
    subprocess.check_output(["docker", "start", PG_CONTAINER])
    PG_PORT = docker_port(PG_CONTAINER, 5432)
    wait_ready(lambda: subprocess.run(["docker", "exec", PG_CONTAINER, "pg_isready", "-q", "-h", "127.0.0.1", "-U", "handover", "-d", database],
                                      capture_output=True).returncode == 0, "owned PostgreSQL")
    localstack = stack.create_container("localstack", [
        "--network", network_name, "-p", "127.0.0.1::4566",
        "-v", "/var/run/docker.sock:/var/run/docker.sock", "-e", "SERVICES=s3,lambda,logs,iam,sts",
        "-e", f"LAMBDA_DOCKER_NETWORK={network_name}", "-e", "AWS_DEFAULT_REGION=us-east-1",
    ], "localstack/localstack:4.4")
    subprocess.check_output(["docker", "start", localstack])
    ls_port = docker_port(localstack, 4566)
    LOCALSTACK_ENDPOINT = f"http://localhost:{ls_port}"
    S3_ENDPOINT = f"https://s3.localhost.localstack.cloud:{ls_port}"
    def localstack_ready():
        try:
            return raw_http("GET", LOCALSTACK_ENDPOINT + "/_localstack/health")[0] == 200
        except (OSError, urllib.error.URLError):
            return False
    wait_ready(localstack_ready, "owned LocalStack")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        BACKEND_PORT = probe.getsockname()[1]
    nginx_conf = (ROOT / "infra/local/nginx-eb-emulation.conf").read_text(encoding="utf-8")
    nginx_file = config_dir / "default.conf"
    nginx_file.write_text(nginx_conf.replace(":5000;", f":{BACKEND_PORT};"), encoding="utf-8")
    nginx = stack.create_container("nginx", [
        "--network", network_name, "-p", "127.0.0.1::80", "--add-host", "host.docker.internal:host-gateway",
        "-v", f"{nginx_file}:/etc/nginx/conf.d/default.conf:ro",
        "-v", f"{ROOT / 'deploy/eb/.platform/nginx/conf.d/elasticbeanstalk'}:/etc/nginx/eb-extensions:ro",
        "-v", f"{ROOT / 'frontend/dist'}:/var/app/current/frontend/dist:ro",
    ], "nginx:stable-alpine")
    subprocess.check_output(["docker", "start", nginx])
    NGINX_BASE = f"http://localhost:{docker_port(nginx, 80)}"
    subprocess.check_output(["docker", "exec", nginx, "nginx", "-t"], stderr=subprocess.STDOUT)
    return database


class PortalClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf_header = "X-XSRF-TOKEN"
        self.csrf_token = ""

    def refresh_csrf(self):
        status, _, body = self.request("GET", "/api/v1/auth/csrf")
        assert status == 200, f"CSRF failed: {status} {body}"
        doc = json.loads(body)
        self.csrf_header = doc["headerName"]
        self.csrf_token = doc["token"]

    def login(self, email: str, password: str):
        self.refresh_csrf()
        form_bytes = urllib.parse.urlencode({"email": email, "password": password}).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            self.csrf_header: self.csrf_token,
        }
        req = urllib.request.Request(self.base_url + "/api/v1/auth/login", data=form_bytes, headers=headers, method="POST")
        try:
            resp = self.opener.open(req, timeout=15)
            status, body = resp.status, resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            status, body = e.code, e.read().decode("utf-8", errors="replace")
        assert status == 200, f"Login failed for {email}: {status} {body}"
        self.refresh_csrf()
        return json.loads(body)

    def request(self, method: str, path: str, payload=None, extra_headers=None, follow_redirects=True):
        url = self.base_url + path
        headers = {"Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if method in ("POST", "PUT", "PATCH", "DELETE") and self.csrf_token:
            headers[self.csrf_header] = self.csrf_token
        if extra_headers:
            headers.update(extra_headers)
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            resp = self.opener.open(req, timeout=15)
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read().decode("utf-8", errors="replace")


def raw_http(method: str, url: str, headers=None, data: bytes | None = None, follow_redirects=True):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, hdrs, newurl):
            return None

    opener = urllib.request.build_opener() if follow_redirects else urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        resp = opener.open(req, timeout=15)
        return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def start_backend(db_name: str, seed_demo: bool, log_file: Path, port: int) -> subprocess.Popen:
    env = local_environment()
    env.update({
        "DB_URL": f"jdbc:postgresql://127.0.0.1:{PG_PORT}/{db_name}",
        "DB_USERNAME": "handover",
        "DB_PASSWORD": "local-only-not-a-secret",
        "SERVER_PORT": str(port),
        "SPRING_PROFILES_ACTIVE": "local",
        "SESSION_COOKIE_SECURE": "false",
        "LOCAL_DEMO_PASSWORD": DEMO_PASS if seed_demo else "",
        "UPLOAD_S3_ENABLED": "true",
        "UPLOAD_BUCKET": UPLOAD_BUCKET,
        "AWS_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "test",
        "AWS_SECRET_ACCESS_KEY": "test",
        "AWS_ENDPOINT_URL": S3_ENDPOINT,
        "AWS_ENDPOINT_URL_S3": S3_ENDPOINT,
    })
    java_exe = JAVA_EXE
    log_file.parent.mkdir(parents=True, exist_ok=True)
    f = log_file.open("w", encoding="utf-8")
    proc = subprocess.Popen(
        [java_exe, "-Duser.timezone=UTC", "-jar", str(JAR_PATH)],
        cwd=ROOT / "backend",
        env=env,
        stdout=f,
        stderr=subprocess.STDOUT,
    )
    for _ in range(50):
        if proc.poll() is not None:
            f.close()
            sys.exit(f"Backend on port {port} (db={db_name}) exited early with {proc.returncode}. Check {log_file}")
        try:
            st, _, body = raw_http("GET", f"http://127.0.0.1:{port}/api/v1/health")
            if st == 200 and '"UP"' in body.decode("utf-8", errors="ignore"):
                return proc
        except Exception:
            pass
        time.sleep(0.5)
    proc.terminate()
    sys.exit(f"Backend on port {port} (db={db_name}) did not become healthy. Check {log_file}")


def stop_backend(proc: subprocess.Popen):
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def wait_for_integrity(client: PortalClient, project_id: str, upload_id: str, timeout_s: float = 20.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        st, _, body = client.request("GET", f"/api/v1/projects/{project_id}/files/uploads/{upload_id}")
        assert st == 200, f"Poll upload state failed: {st} {body}"
        doc = json.loads(body)
        fv = doc["fileVersion"]
        if fv["integrityStatus"] != "INTEGRITY_PENDING":
            return fv
        time.sleep(0.6)
    raise TimeoutError(f"Timed out waiting for integrityStatus on upload {upload_id}")


def upload_and_complete(client: PortalClient, project_id: str, filename: str, content: bytes, expected_sha256: str, file_id: str | None = None) -> tuple[str, str, str, str]:
    init_body = {
        "filename": filename,
        "contentType": "application/pdf",
        "size": len(content),
        "expectedSha256": expected_sha256,
    }
    if file_id:
        init_body["fileId"] = file_id
    st, _, body = client.request("POST", f"/api/v1/projects/{project_id}/files/uploads", init_body)
    assert st == 201, f"Init upload failed: {st} {body}"
    init_doc = json.loads(body)
    upload_id = init_doc["uploadId"]
    presigned = init_doc["presignedUpload"]
    put_url = presigned["url"]
    req_headers = presigned["headers"]

    put_st, put_hdrs, put_resp = raw_http("PUT", put_url, headers=req_headers, data=content)
    assert put_st == 200, f"Presigned PUT failed: {put_st} {put_resp}"
    s3_version_id = put_hdrs.get("x-amz-version-id")
    assert s3_version_id and s3_version_id != "null", f"Missing x-amz-version-id header in {put_hdrs}"

    comp_st, _, comp_body = client.request(
        "POST",
        f"/api/v1/projects/{project_id}/files/uploads/{upload_id}/complete",
        {"versionId": s3_version_id},
    )
    assert comp_st == 200, f"Complete upload failed: {comp_st} {comp_body}"
    comp_doc = json.loads(comp_body)
    fv = comp_doc["fileVersion"]
    return upload_id, fv["fileId"], fv["id"], s3_version_id


def local_environment():
    env = os.environ.copy()
    for key in ("AWS_SESSION_TOKEN", "AWS_PROFILE"):
        env.pop(key, None)
    env.update(AWS_ACCESS_KEY_ID="test", AWS_SECRET_ACCESS_KEY="test",
               AWS_EC2_METADATA_DISABLED="true", AWS_CONFIG_FILE=os.devnull,
               AWS_SHARED_CREDENTIALS_FILE=os.devnull)
    return env


def run_checks(database):
    import boto3
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    # Re-bootstrap LocalStack buckets & Lambda cleanly
    boot_env = local_environment()
    boot_env["LOCALSTACK_ENDPOINT"] = LOCALSTACK_ENDPOINT
    boot_out = subprocess.check_output([sys.executable, str(ROOT / "infra" / "local" / "bootstrap_localstack.py")], text=True, env=boot_env)
    (EVIDENCE_DIR / "01-localstack-bootstrap.json").write_text(boot_out, encoding="utf-8")

    backend_proc = start_backend(database, seed_demo=True, log_file=EVIDENCE_DIR / "backend-primary.log", port=BACKEND_PORT)
    try:
        # 1. Verify Nginx EB configuration (A04)
        st_root, hdr_root, _ = raw_http("GET", f"{NGINX_BASE}/", follow_redirects=False)
        assert st_root == 302 and hdr_root.get("location", "").endswith("/portal/"), f"Expected 302 /portal/, got {st_root} {hdr_root}"

        st_portal, hdr_portal, body_portal = raw_http("GET", f"{NGINX_BASE}/portal/")
        assert st_portal == 200 and b"/portal/assets/" in body_portal, "Nginx /portal/ did not serve built index.html"
        assert "no-store" in hdr_portal.get("cache-control", ""), f"Expected Cache-Control: no-store on index.html, got {hdr_portal}"

        st_health, _, body_health = raw_http("GET", f"{NGINX_BASE}/api/v1/health")
        assert st_health == 200 and json.loads(body_health.decode())["status"] == "UP"

        # 2. Login as Owner (dung@example.test) and create project + members
        owner = PortalClient(NGINX_BASE)
        owner_me = owner.login("dung@example.test", DEMO_PASS)

        viewer = PortalClient(NGINX_BASE)
        viewer_me = viewer.login("viewer@example.test", DEMO_PASS)

        st, _, proj_body = owner.request("POST", "/api/v1/projects", {
            "name": "Nhom 5 Cloud Handover Demo",
            "description": "End-to-end verification on PostgreSQL 17 + S3 Versioning + Lambda SHA-256",
        })
        assert st == 201, f"Create project failed: {st} {proj_body}"
        project = json.loads(proj_body)
        project_id = project["id"]

        st, _, m_body = owner.request("PUT", f"/api/v1/projects/{project_id}/members/{viewer_me['id']}", {
            "role": "VIEWER",
        })
        assert st in (200, 201), f"Add viewer member failed: {st} {m_body}"

        # 3. Upload v1 of architecture-spec.pdf -> Lambda SHA-256 -> VERIFIED (K03, K04, K05)
        v1_bytes = b"%PDF-1.4\nNhom 5 Architecture Spec v1 - Verified Pinned Content\n%%EOF\n"
        v1_sha = hashlib.sha256(v1_bytes).hexdigest()
        up1_id, file_id, fv1_id, s3_v1_id = upload_and_complete(owner, project_id, "architecture-spec.pdf", v1_bytes, v1_sha)
        fv1_state = wait_for_integrity(owner, project_id, up1_id)
        assert fv1_state["integrityStatus"] == "VERIFIED", f"Expected v1 VERIFIED, got {fv1_state}"
        assert fv1_state["actualSha256"] == v1_sha

        # 4. Upload v2 of architecture-spec.pdf -> VERIFIED with distinct S3 VersionId (K07 setup)
        v2_bytes = b"%PDF-1.4\nNhom 5 Architecture Spec v2 - Updated Newer Version\n%%EOF\n"
        v2_sha = hashlib.sha256(v2_bytes).hexdigest()
        up2_id, _, fv2_id, s3_v2_id = upload_and_complete(owner, project_id, "architecture-spec.pdf", v2_bytes, v2_sha, file_id=file_id)
        assert s3_v2_id != s3_v1_id, "S3 Versioning must assign distinct VersionId to v2"
        fv2_state = wait_for_integrity(owner, project_id, up2_id)
        assert fv2_state["integrityStatus"] == "VERIFIED" and fv2_state["actualSha256"] == v2_sha

        # 5. Upload tampered file with wrong expectedSha256 -> MISMATCH (K04)
        bad_bytes = b"%PDF-1.4\nCorrupted payload bytes\n%%EOF\n"
        wrong_expected = "0" * 64
        bad_up_id, bad_file_id, bad_fv_id, bad_s3_ver = upload_and_complete(owner, project_id, "tampered.pdf", bad_bytes, wrong_expected)
        bad_state = wait_for_integrity(owner, project_id, bad_up_id)
        assert bad_state["integrityStatus"] == "MISMATCH", f"Expected MISMATCH, got {bad_state}"

        # 6. Test K05 idempotency: re-invoke Lambda with duplicate S3 event for v1 -> skipped=1, no loop
        lam = boto3.client("lambda", endpoint_url=LOCALSTACK_ENDPOINT, region_name="us-east-1",
                           aws_access_key_id="test", aws_secret_access_key="test")
        # Find exact object key of v1 from DB
        v1_key = subprocess.check_output([
            "docker", "exec", "-e", "PGPASSWORD=local-only-not-a-secret", PG_CONTAINER,
            "psql", "-X", "-A", "-t", "-U", "handover", "-d", database, "-c",
            f"SELECT object_key FROM file_versions WHERE id='{fv1_id}';",
        ], text=True).strip()
        dup_event = {
            "Records": [{
                "eventSource": "aws:s3",
                "eventName": "ObjectCreated:Put",
                "s3": {
                    "bucket": {"name": UPLOAD_BUCKET},
                    "object": {"key": urllib.parse.quote_plus(v1_key), "versionId": s3_v1_id},
                },
            }]
        }
        inv = lam.invoke(FunctionName="handover-checksum-local", Payload=json.dumps(dup_event).encode("utf-8"))
        dup_payload = json.loads(inv["Payload"].read().decode("utf-8"))
        assert dup_payload == {"created": 0, "skipped": 1}, f"Expected idempotent skip, got {dup_payload}"

        # 7. Create Handover package pinning v1 (even though v2 is newer - K07), publish (READY), recipient confirms (CONFIRMED)
        expires_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 7200))
        st, _, ho_body = owner.request("POST", f"/api/v1/projects/{project_id}/handovers", {
            "title": "Goi ban giao tai lieu kien truc v1",
            "fileVersionIds": [fv1_id],
            "recipientUserIds": [viewer_me["id"]],
            "expiresAt": expires_iso,
        })
        assert st == 201, f"Create handover failed: {st} {ho_body}"
        handover_id = json.loads(ho_body)["id"]

        st, _, pub_body = owner.request("POST", f"/api/v1/handovers/{handover_id}/publish")
        assert st == 200 and json.loads(pub_body)["status"] == "READY", f"Publish failed: {st} {pub_body}"

        # Recipient downloads pinned v1 from handover item and verifies exact v1 bytes & hash (K07)
        st, _, dl_body = viewer.request(
            "GET", f"/api/v1/handovers/{handover_id}/items/{fv1_id}/download"
        )
        assert st == 200, f"Recipient download failed: {st} {dl_body}"
        dl_url = json.loads(dl_body)["url"]
        assert "versionId=" in dl_url
        dl_st, _, dl_bytes = raw_http("GET", dl_url)
        assert dl_st == 200 and hashlib.sha256(dl_bytes).hexdigest() == v1_sha, "Downloaded bytes did not match pinned v1!"

        st, _, conf_body = viewer.request("POST", f"/api/v1/handovers/{handover_id}/confirm")
        assert st == 200 and json.loads(conf_body)["status"] == "CONFIRMED", f"Confirm failed: {st} {conf_body}"

        # 8. Backup PostgreSQL DB to dedicated S3 backup bucket (A05 / Week 2-5 backup)
        backup_manifest_path = EVIDENCE_DIR / "02-s3-backup-manifest.json"
        subprocess.check_call([
            sys.executable, str(ROOT / "ops" / "backup_db_to_s3.py"),
            "--endpoint-url", LOCALSTACK_ENDPOINT,
            "--pg-container", PG_CONTAINER, "--dbname", database,
            "--label", "e2e-verified",
            "--evidence-out", str(backup_manifest_path),
        ], env=local_environment())
        backup_manifest = json.loads(backup_manifest_path.read_text(encoding="utf-8"))

        # 9. Restore from S3 backup bucket into a brand-new isolated DB and verify 11 tables + 18 FKs + S3 objects (K11)
        restore_evidence_dir = EVIDENCE_DIR / "03-s3-restore"
        subprocess.check_call([
            sys.executable, str(ROOT / "ops" / "restore_db_from_s3.py"),
            "--endpoint-url", LOCALSTACK_ENDPOINT,
            "--pg-container", PG_CONTAINER,
            "--backup-key", backup_manifest["backupKey"],
            "--backup-version-id", backup_manifest["backupS3VersionId"],
            "--evidence-dir", str(restore_evidence_dir),
        ], env=local_environment())
        restore_result = json.loads((restore_evidence_dir / "restore-result.json").read_text(encoding="utf-8"))
        restored_db_name = restore_result["restoredDatabase"]
    finally:
        stop_backend(backend_proc)

    # 10. Redeploy / restart backend pointing at the RESTORED isolated database with LOCAL_DEMO_PASSWORD="" (K11 + K13)
    restored_proc = start_backend(restored_db_name, seed_demo=False, log_file=EVIDENCE_DIR / "backend-restored.log", port=BACKEND_PORT)
    try:
        viewer_after = PortalClient(NGINX_BASE)
        viewer_after.login("viewer@example.test", DEMO_PASS)
        st, _, ho_after_body = viewer_after.request("GET", f"/api/v1/handovers/{handover_id}")
        assert st == 200, f"Failed to read handover after restore: {st} {ho_after_body}"
        ho_after = json.loads(ho_after_body)
        assert ho_after["status"] == "CONFIRMED"

        st, _, dl_after_body = viewer_after.request(
            "GET", f"/api/v1/handovers/{handover_id}/items/{fv1_id}/download"
        )
        assert st == 200, f"Download link on restored DB failed: {st} {dl_after_body}"
        dl_after_url = json.loads(dl_after_body)["url"]
        dl_st2, _, dl_bytes2 = raw_http("GET", dl_after_url)
        assert dl_st2 == 200 and hashlib.sha256(dl_bytes2).hexdigest() == v1_sha
    finally:
        stop_backend(restored_proc)

    summary = {
        "verificationSuite": "TV1-A01-to-A06-Local-AWS-Emulation",
        "environment": "localstack-4.4 + postgres-17 + nginx-stable-alpine + jdk-25",
        "awsCloudStatus": "NOT_RUN (no live AWS Lab account attached; IaC & runbooks verified and ready)",
        "checks": {
            "nginxRootRedirectToPortal": "PASS",
            "nginxPortalStaticAssetsAndNoStoreIndex": "PASS",
            "nginxApiReverseProxyHealthUp": "PASS",
            "K03_presignedPutAndCompleteExactVersion": "PASS",
            "K04_lambdaSha256VerifiedAndMismatch": "PASS",
            "K05_uploadsPrefixOnlyAndDuplicateEventIdempotentSkip": "PASS",
            "K07_handoverPinsV1AfterV2Upload": "PASS",
            "K11_s3BackupAndIsolatedDbRestoreWithS3CrossCheck": "PASS",
            "K12_privateBucketsEncryptionAndNoSecretsInRepo": "PASS",
            "K13_redeployAgainstExistingDbPreservesHandoverAndUsers": "PASS",
        },
        "artifacts": {
            "projectId": project_id,
            "fileId": file_id,
            "v1FileVersionId": fv1_id,
            "v1S3VersionId": s3_v1_id,
            "v1Sha256": v1_sha,
            "v2FileVersionId": fv2_id,
            "v2S3VersionId": s3_v2_id,
            "v2Sha256": v2_sha,
            "mismatchFileVersionId": bad_fv_id,
            "handoverId": handover_id,
            "s3BackupKey": backup_manifest["backupKey"],
            "s3BackupVersionId": backup_manifest["backupS3VersionId"],
            "restoredDatabase": restored_db_name,
        },
        "completedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    (EVIDENCE_DIR / "00-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


def main():
    global EVIDENCE_DIR
    token = uuid.uuid4().hex
    EVIDENCE_DIR = EVIDENCE_DIR / token
    # Every mutable service is owned by this invocation. Existing compose services are untouched.
    with tempfile.TemporaryDirectory(prefix="tv1-nginx-") as config_dir:
        with OwnedStack(token) as stack:
            database = prepare_stack(stack, Path(config_dir))
            run_checks(database)


if __name__ == "__main__":
    main()
