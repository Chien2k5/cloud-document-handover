"""Executable F008 cases. Docker is a stateful in-memory boundary, never a daemon."""
import ast
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("tv1_runner", ROOT / "ops/verify_tv1_local_stack.py")
runner = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"boto3": types.ModuleType("boto3")}):
    spec.loader.exec_module(runner)

class Docker:
    def __init__(self):
        self.resources = {"external": {"Id": "external", "Config": {"Labels": {"owner": "someone-else"}}}}
        self.sentinel = {"handover": ["keep-me"]}
        self.calls = []
    def output(self, cmd, **kwargs):
        self.calls.append(cmd)
        if cmd[1] == "create":
            name = cmd[cmd.index("--name") + 1]
            label = cmd[cmd.index("--label") + 1].split("=", 1)
            rid = "id-" + name
            self.resources[rid] = {"Id": rid, "Config": {"Labels": {label[0]: label[1]}}}
            return rid + "\n"
        if cmd[1] == "inspect":
            return json.dumps([self.resources[cmd[-1]]])
        if cmd[1] == "rm":
            del self.resources[cmd[-1]]
            return ""
        raise AssertionError("Unexpected command: " + repr(cmd))

class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.docker = Docker()
        self.patch = patch.object(runner.subprocess, "check_output", side_effect=self.docker.output)
        self.patch.start(); self.addCleanup(self.patch.stop)
    def stack(self, token="a" * 32):
        return runner.OwnedStack(token)
    def create(self, stack):
        return stack.create_container("postgres", ["--tmpfs", "/var/lib/postgresql/data"], "postgres:17-alpine")
    def test_T008_01_foreign_resource_is_rejected(self):
        stack = self.stack()
        with self.assertRaisesRegex(RuntimeError, "ownership"):
            stack.remove_container("external")
        self.assertFalse(any(c[1] == "rm" for c in self.docker.calls))
    def test_T008_02_external_sentinel_is_unchanged(self):
        stack = self.stack(); self.create(stack); stack.cleanup()
        self.assertEqual(self.docker.sentinel, {"handover": ["keep-me"]})
        self.assertIn("external", self.docker.resources)
    def test_T008_03_uses_its_own_disposable_postgres(self):
        stack = self.stack(); rid = self.create(stack)
        command = self.docker.calls[0]
        self.assertIn("--tmpfs", command)
        self.assertIn("--pull=never", command)
        self.assertIn(rid, stack.containers)
        self.assertEqual(self.docker.resources[rid]["Config"]["Labels"][runner.OWNER_LABEL], stack.token)
        stack.cleanup()
    def test_T008_04_failure_preserves_external_database(self):
        with self.assertRaisesRegex(RuntimeError, "injected"):
            with self.stack() as stack:
                self.create(stack)
                raise RuntimeError("injected")
        self.assertEqual(list(self.docker.resources), ["external"])
        self.assertEqual(self.docker.sentinel["handover"], ["keep-me"])
    def test_T008_05_runs_have_distinct_resources(self):
        one, two = self.stack(), self.stack("b" * 32)
        first, second = self.create(one), self.create(two)
        self.assertNotEqual(first, second)
        one.cleanup(); self.assertIn(second, self.docker.resources)
        two.cleanup()
    def test_T008_06_cleanup_rechecks_ownership(self):
        stack = self.stack(); rid = self.create(stack)
        self.docker.resources[rid]["Config"]["Labels"][runner.OWNER_LABEL] = "changed"
        with self.assertRaisesRegex(RuntimeError, "ownership"):
            stack.cleanup()
        self.assertIn(rid, self.docker.resources)
        self.assertFalse(any(c[1] == "rm" for c in self.docker.calls))
    def test_T008_07_missing_safety_configuration_fails_closed(self):
        for token in (None, "", "default", "handover", "a;bad"):
            with self.subTest(token=token), self.assertRaisesRegex(ValueError, "run token"):
                self.stack(token)
        self.assertEqual(self.docker.calls, [])
    def test_T008_08_no_shared_drop_or_container_fallback(self):
        source = (ROOT / "ops/verify_tv1_local_stack.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        literals = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        self.assertFalse(any("DROP DATABASE" in value.upper() for value in literals))
        self.assertFalse(any("handover-local-aws-postgres-1" in value for value in literals))
        self.assertIn("OwnedStack", source)

    def test_local_credentials_do_not_inherit_a_session(self):
        with patch.dict(runner.os.environ, {"AWS_SESSION_TOKEN": "fixture-sensitive", "AWS_PROFILE": "fixture"}):
            env = runner.local_environment()
        self.assertNotIn("AWS_SESSION_TOKEN", env)
        self.assertNotIn("AWS_PROFILE", env)
        self.assertEqual(env["AWS_ACCESS_KEY_ID"], "test")
        self.assertEqual(env["AWS_SECRET_ACCESS_KEY"], "test")
    def test_remote_docker_is_rejected_before_mutation(self):
        with patch.object(runner.subprocess, "check_output", return_value="tcp://remote:2376") as command:
            with self.assertRaisesRegex(RuntimeError, "local disposable"):
                runner.prepare_stack(self.stack(), ROOT)
        self.assertEqual(command.call_count, 1)

if __name__ == "__main__":
    unittest.main(verbosity=2)
