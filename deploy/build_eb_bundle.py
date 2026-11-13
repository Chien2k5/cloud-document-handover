"""TV1 (A02/A04) - Build the Elastic Beanstalk Java SE staging bundle (eb-release.zip)
and its SHA-256 manifest, strictly following docs/integration/aws-deployment-handover.md.

Bundle layout at ZIP root (no parent directory wrapper, forward slashes, LF line endings
on text configuration files):
  app.jar
  Procfile
  frontend/dist/index.html
  frontend/dist/assets/...
  .platform/nginx/conf.d/elasticbeanstalk/99_portal.conf

Never includes node_modules, .env, source secrets, or test fixtures.
"""
import argparse
import hashlib
import json
import ssl
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JAR = ROOT / "backend" / "target" / "document-handover-0.1.0-SNAPSHOT.jar"
DEFAULT_DIST = ROOT / "frontend" / "dist"
DEFAULT_OUT = ROOT / "output" / "eb-release.zip"
PROCFILE = ROOT / "deploy" / "eb" / "Procfile"
RDS_CA_BUNDLE = ROOT / "deploy" / "eb" / "certs" / "rds-global-bundle.pem"
RDS_CA_SOURCE = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem"
RDS_CA_SHA256 = "90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b"
NGINX_CONF = ROOT / "deploy" / "eb" / ".platform" / "nginx" / "conf.d" / "elasticbeanstalk" / "99_portal.conf"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def git_head() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:
        return "unknown"


def normalize_lf(path: Path) -> bytes:
    text = path.read_text(encoding="utf-8")
    return text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")


def build_bundle(jar_path: Path, dist_dir: Path, out_zip: Path) -> dict:
    if not jar_path.is_file():
        sys.exit(f"Missing backend JAR: {jar_path}. Build backend first with mvnw package.")
    index_html = dist_dir / "index.html"
    if not index_html.is_file():
        sys.exit(f"Missing frontend dist index: {index_html}. Build frontend with --base=/portal/.")
    index_text = index_html.read_text(encoding="utf-8")
    if "/portal/assets/" not in index_text:
        sys.exit("frontend/dist/index.html does not reference /portal/assets/. Rebuild with: npm run build -- --base=/portal/")

    if not RDS_CA_BUNDLE.is_file():
        sys.exit("Missing RDS public CA bundle; refresh the reviewed trust material before building.")
    ca_bytes = RDS_CA_BUNDLE.read_bytes()
    if b"PRIVATE KEY" in ca_bytes or sha256_bytes(ca_bytes) != RDS_CA_SHA256:
        sys.exit("RDS CA bundle does not match the reviewed public trust material.")
    try:
        ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT).load_verify_locations(cadata=ca_bytes.decode("ascii"))
    except (UnicodeError, ssl.SSLError):
        sys.exit("RDS CA bundle is not a valid PEM trust bundle.")
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    entries = []

    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # 1. app.jar
        zf.write(jar_path, "app.jar")
        entries.append({
            "arcname": "app.jar",
            "sizeBytes": jar_path.stat().st_size,
            "sha256": sha256_file(jar_path),
        })

        # 2. Procfile (UTF-8 / LF)
        procfile_bytes = normalize_lf(PROCFILE)
        zf.writestr("Procfile", procfile_bytes)
        entries.append({
            "arcname": "Procfile",
            "sizeBytes": len(procfile_bytes),
            "sha256": sha256_bytes(procfile_bytes),
        })

        # 3. .platform/nginx/conf.d/elasticbeanstalk/99_portal.conf (UTF-8 / LF)
        nginx_arc = ".platform/nginx/conf.d/elasticbeanstalk/99_portal.conf"
        nginx_bytes = normalize_lf(NGINX_CONF)
        zf.writestr(nginx_arc, nginx_bytes)
        entries.append({
            "arcname": nginx_arc,
            "sizeBytes": len(nginx_bytes),
            "sha256": sha256_bytes(nginx_bytes),
        })

        # Public CA only; readable by the EB application user after extraction.
        ca_info = zipfile.ZipInfo("certs/rds-global-bundle.pem")
        ca_info.create_system = 3
        ca_info.external_attr = 0o100644 << 16
        ca_info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(ca_info, ca_bytes)
        entries.append({"arcname": ca_info.filename, "sizeBytes": len(ca_bytes), "sha256": sha256_bytes(ca_bytes)})

        # 4. frontend/dist/**
        for file_path in sorted(dist_dir.rglob("*")):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(dist_dir).as_posix()
            if (rel.startswith(".env") or "secret" in rel.lower()
                    or file_path.suffix.lower() in {".key", ".p12", ".pfx"}
                    or b"PRIVATE KEY" in file_path.read_bytes()):
                sys.exit(f"Refusing to package suspicious file in dist: {rel}")
            arc = f"frontend/dist/{rel}"
            zf.write(file_path, arc)
            entries.append({
                "arcname": arc,
                "sizeBytes": file_path.stat().st_size,
                "sha256": sha256_file(file_path),
            })

    manifest = {
        "bundleType": "elastic-beanstalk-javase-al2023",
        "gitCommit": git_head(),
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "bundlePath": str(out_zip.relative_to(ROOT).as_posix()),
        "bundleSizeBytes": out_zip.stat().st_size,
        "bundleSha256": sha256_file(out_zip),
        "entries": entries,
        "publicTrustBundle": {"source": RDS_CA_SOURCE, "sha256": RDS_CA_SHA256},
    }
    manifest_path = out_zip.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Build Elastic Beanstalk release bundle.")
    parser.add_argument("--jar", type=Path, default=DEFAULT_JAR)
    parser.add_argument("--dist", type=Path, default=DEFAULT_DIST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    manifest = build_bundle(args.jar.resolve(), args.dist.resolve(), args.output.resolve())
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
