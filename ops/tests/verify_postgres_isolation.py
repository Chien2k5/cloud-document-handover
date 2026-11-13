"""Opt-in live PostgreSQL regression: all containers are created by this test."""
import json
import subprocess
import time
import unittest
import uuid
from test_verify_isolation import runner

class PostgresIsolationRegression(unittest.TestCase):
    def test_owned_cleanup_on_pass_and_failure_preserves_other_test_container(self):
        def make(stack, service):
            rid = stack.create_container(service, ["--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_HOST_AUTH_METHOD=trust"], "postgres:17-alpine")
            subprocess.check_output(["docker", "start", rid])
            runner.wait_ready(lambda: subprocess.run(["docker", "exec", rid, "pg_isready", "-q", "-h", "127.0.0.1", "-U", "postgres"], capture_output=True).returncode == 0, "test PostgreSQL", timeout=30)
            return rid
        def query(rid, sql):
            return subprocess.check_output(["docker", "exec", rid, "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", sql], text=True).strip()
        with runner.OwnedStack(uuid.uuid4().hex) as sentinel_owner:
            sentinel = make(sentinel_owner, "sentinel")
            query(sentinel, "CREATE TABLE sentinel(value text); INSERT INTO sentinel VALUES ('keep-me');")
            for failure in (False, True):
                current = runner.OwnedStack(uuid.uuid4().hex)
                try:
                    with current:
                        rid = make(current, "postgres")
                        self.assertNotEqual(rid, sentinel)
                        with self.assertRaisesRegex(RuntimeError, "ownership"):
                            current.remove_container(sentinel)
                        query(rid, "CREATE TABLE owned(value int); INSERT INTO owned VALUES (42);")
                        self.assertEqual(query(rid, "SELECT value FROM owned"), "42")
                        if failure:
                            raise RuntimeError("injected failure")
                except RuntimeError as exc:
                    if not failure or str(exc) != "injected failure":
                        raise
                self.assertEqual(query(sentinel, "SELECT value FROM sentinel"), "keep-me")
                check = subprocess.run(["docker", "inspect", rid], capture_output=True)
                self.assertNotEqual(check.returncode, 0)
                self.assertEqual(current.containers, [])
        self.assertNotEqual(subprocess.run(["docker", "inspect", sentinel], capture_output=True).returncode, 0)

if __name__ == "__main__":
    unittest.main(verbosity=2)
