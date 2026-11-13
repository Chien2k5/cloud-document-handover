"""TV1 (A03) - Package Dang's checksum Lambda into a clean ZIP with ONLY
lambda_function.py at the root of the archive (no tests, no .env).
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAMBDA_SRC = ROOT / "aws" / "lambda" / "lambda_function.py"
DEFAULT_OUT = ROOT / "output" / "lambda-checksum.zip"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_head() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:
        return "unknown"


def main():
    parser = argparse.ArgumentParser(description="Package checksum Lambda ZIP.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if not LAMBDA_SRC.is_file():
        sys.exit(f"Missing Lambda source: {LAMBDA_SRC}")

    out_zip = args.output.resolve()
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(LAMBDA_SRC, "lambda_function.py")

    # Verify archive contains strictly lambda_function.py
    with zipfile.ZipFile(out_zip, "r") as zf:
        names = zf.namelist()
        if names != ["lambda_function.py"]:
            sys.exit(f"Unexpected entries in Lambda ZIP: {names}")

    manifest = {
        "bundleType": "aws-lambda-python3.12",
        "handler": "lambda_function.lambda_handler",
        "gitCommit": git_head(),
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "zipPath": str(out_zip.relative_to(ROOT).as_posix()),
        "zipSizeBytes": out_zip.stat().st_size,
        "zipSha256": sha256_file(out_zip),
        "sourceSha256": sha256_file(LAMBDA_SRC),
    }
    out_zip.with_suffix(".manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
