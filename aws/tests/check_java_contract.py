"""Check Python output against the compiled backend JAR; requires JDK 21+ only."""
import argparse
import copy
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile
import zipfile

from test_checksum_lambda import TestChecksumLambda, worker


def make_cases():
    fixture = TestChecksumLambda(); fixture.setUp(); fixture.run_event()
    base = json.loads(fixture.s3.saved[fixture.SHARED_KEY])
    cases = []

    def add(name, payload, expected=None, size=3, version=fixture.VERSION):
        cases.append(dict(name=name, bucket=fixture.BUCKET, objectKey=fixture.KEY,
                          versionId=version, size=size,
                          resultKey=worker.result_key(fixture.BUCKET, fixture.KEY, version),
                          document=payload if isinstance(payload, str) else json.dumps(payload),
                          expectedHash=expected))

    add("valid-v1", base, base["actualSha256"])
    fixture.s3.sources["v2"] = b"second version"
    fixture.run_event(fixture.event(version="v2"))
    second = json.loads(fixture.s3.saved[worker.result_key(fixture.BUCKET, fixture.KEY, "v2")])
    add("valid-v2", second, second["actualSha256"], size=len(b"second version"), version="v2")
    fixture.s3.reported_size = worker.MAX_FILE_BYTES + 1
    fixture.s3.saved.clear(); fixture.run_event()
    failed = json.loads(fixture.s3.saved[fixture.SHARED_KEY])
    add("failed-too-large", failed, size=worker.MAX_FILE_BYTES + 1)
    for field, value in (("bucket", "other"), ("objectKey", "uploads/other"), ("versionId", "wrong"),
                         ("size", 4), ("status", "HASHED"), ("processedAt", "invalid")):
        bad = copy.deepcopy(base); bad[field] = value
        add("wrong-"+field, bad)
    bad = copy.deepcopy(base); bad.pop("schemaVersion"); add("missing-schema", bad)
    bad = copy.deepcopy(base); bad["writeStatus"] = "CREATED"; add("extra-field", bad)
    add("duplicate-field", json.dumps(base).replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'))
    return cases


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--backend-jar", required=True, type=Path)
    args = cli.parse_args()
    jar = args.backend_jar.resolve()
    if not jar.is_file(): raise SystemExit("Build the backend JAR first")
    java, javac = shutil.which("java"), shutil.which("javac")
    if not java or not javac: raise SystemExit("JDK java and javac are required")
    flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    with tempfile.TemporaryDirectory(prefix="checksum-java-contract-") as temporary:
        root = Path(temporary).resolve()
        (root/"lib").mkdir(); (root/"classes").mkdir()
        with zipfile.ZipFile(jar) as archive:
            for entry in archive.infolist():
                if entry.is_dir(): continue
                parts = PurePosixPath(entry.filename)
                if parts.is_absolute() or ".." in parts.parts or any(":" in p or "\\" in p for p in parts.parts):
                    raise ValueError("Unsafe JAR entry")
                if entry.filename.startswith("BOOT-INF/lib/") and entry.filename.endswith(".jar"):
                    target = root/"lib"/parts.name
                elif entry.filename.startswith("BOOT-INF/classes/"):
                    target = root/"classes"/Path(*parts.parts[2:])
                else: continue
                if not target.resolve().is_relative_to(root): raise ValueError("Unsafe target")
                target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(archive.read(entry))
        cases = root/"cases.json"; cases.write_text(json.dumps(make_cases()), encoding="utf-8")
        classpath = os.pathsep.join((str(root/"classes"), str(root/"lib/*")))
        source = Path(__file__).with_name("ChecksumContractCheck.java")
        subprocess.run([javac,"-encoding","UTF-8","-cp",classpath,"-d",str(root/"classes"),str(source)],
                       check=True, timeout=60, capture_output=True, text=True, **flags)
        checked = subprocess.run([java,"-cp",classpath,"vn.edu.uet.handover.upload.ChecksumContractCheck",str(cases)],
                                 check=True, timeout=60, capture_output=True, text=True, **flags)
        if "PASS Java production checksum parser" not in checked.stdout:
            raise RuntimeError("Java checker did not report success")
        print(checked.stdout.strip())


if __name__ == "__main__":
    main()
