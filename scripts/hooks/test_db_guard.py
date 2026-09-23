"""The Neon MCP SQL guard, db-guard.py (SCRUM-339 amendment).

Run: python3 -m unittest scripts/hooks/test_db_guard.py

The hook reads the human-kept dev-branch allowlist in the user's config
directory. These tests point db_targets at a temporary file of their own,
through the module attribute rather than an environment variable, so the
test seam is not a switch a session could flip.
"""

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import db_targets  # noqa: E402

spec = importlib.util.spec_from_file_location("db_guard", HERE / "db-guard.py")
db_guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(db_guard)

RUN_SQL = "mcp__plugin_neon_neon__run_sql"
RUN_TX = "mcp__plugin_neon_neon__run_sql_transaction"
DELETE_BRANCH = "mcp__plugin_neon_neon__delete_branch"
DEV = "br-dev-test-123"
PROD = "br-some-other-456"


def run(payload, env=None):
    """(exit code, stdout, stderr) for one payload, as the harness sees it."""
    out, err = io.StringIO(), io.StringIO()
    stdin = io.StringIO(json.dumps(payload) if not isinstance(payload, str) else payload)
    with mock.patch.object(sys, "stdin", stdin), mock.patch.dict("os.environ", env or {}, clear=False), redirect_stdout(out), redirect_stderr(err):
        try:
            code = db_guard.main()
        except SystemExit as exc:
            code = exc.code
    return code, out.getvalue(), err.getvalue()


class DevBranchWrites(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({"neon_branch_ids": [DEV]}, self.tmp)
        self.tmp.close()
        self.patch = mock.patch.object(db_targets, "TARGETS_FILE", Path(self.tmp.name))
        self.patch.start()
        # DB_GUARD_CONFIRMED must not leak in from the environment running the tests.
        self.env = mock.patch.dict("os.environ", {}, clear=False)
        self.env.start()
        import os

        os.environ.pop("DB_GUARD_CONFIRMED", None)

    def tearDown(self):
        self.patch.stop()
        self.env.stop()
        Path(self.tmp.name).unlink(missing_ok=True)

    def test_a_write_on_a_listed_dev_branch_is_allowed_and_says_why(self):
        code, out, _ = run({"tool_name": RUN_SQL, "tool_input": {"sql": "UPDATE t SET x = 1", "branch_id": DEV}})
        self.assertEqual(code, 0)
        self.assertIn("dev branch", out)
        self.assertIn("UPDATE", out.upper())  # the classification still ran and is in the reason

    def test_a_transaction_on_a_listed_dev_branch_is_allowed(self):
        code, _, _ = run({"tool_name": RUN_TX, "tool_input": {"sql_statements": ["DELETE FROM t", "INSERT INTO t VALUES (1)"], "branch_id": DEV}})
        self.assertEqual(code, 0)

    def test_a_write_with_no_branch_is_prod_and_blocked(self):
        code, _, err = run({"tool_name": RUN_SQL, "tool_input": {"sql": "UPDATE t SET x = 1"}})
        self.assertEqual(code, 2)
        self.assertIn("DB_GUARD_CONFIRMED", err)

    def test_a_write_on_a_branch_nobody_listed_is_blocked(self):
        code, _, _ = run({"tool_name": RUN_SQL, "tool_input": {"sql": "UPDATE t SET x = 1", "branch_id": PROD}})
        self.assertEqual(code, 2)

    def test_a_transaction_with_no_branch_stays_blocked_by_identity(self):
        code, _, _ = run({"tool_name": RUN_TX, "tool_input": {"sql_statements": ["SELECT 1"]}})
        self.assertEqual(code, 2)

    def test_destructive_tools_stay_blocked_even_on_a_dev_branch(self):
        code, _, _ = run({"tool_name": DELETE_BRANCH, "tool_input": {"branch_id": DEV}})
        self.assertEqual(code, 2)

    def test_reads_are_allowed_on_any_branch(self):
        self.assertEqual(run({"tool_name": RUN_SQL, "tool_input": {"sql": "SELECT 1"}})[0], 0)
        self.assertEqual(run({"tool_name": RUN_SQL, "tool_input": {"sql": "SELECT 1", "branch_id": PROD}})[0], 0)

    def test_the_human_confirmation_still_works_for_prod(self):
        code, _, _ = run({"tool_name": RUN_SQL, "tool_input": {"sql": "UPDATE t SET x = 1"}}, env={"DB_GUARD_CONFIRMED": "1"})
        self.assertEqual(code, 0)

    def test_no_allowlist_file_means_no_dev_branch(self):
        with mock.patch.object(db_targets, "TARGETS_FILE", Path(self.tmp.name + ".missing")):
            code, _, _ = run({"tool_name": RUN_SQL, "tool_input": {"sql": "UPDATE t SET x = 1", "branch_id": DEV}})
        self.assertEqual(code, 2)

    def test_a_second_spelling_of_the_branch_is_refused(self):
        # The Neon MCP reads `branch_id` only. A dev `branch_id` beside a
        # `branchId` naming another branch must never be taken as dev.
        code, _, _ = run({"tool_name": RUN_SQL, "tool_input": {"sql": "UPDATE t SET x = 1", "branch_id": DEV, "branchId": PROD}})
        self.assertEqual(code, 2)
        code, _, _ = run({"tool_name": RUN_SQL, "tool_input": {"sql": "SELECT 1", "branchId": DEV}})
        self.assertEqual(code, 2)

    def test_a_dev_branch_cannot_be_made_a_bridge_to_another_database(self):
        for sql in [
            "CREATE EXTENSION dblink",
            "SELECT dblink_exec('host=x', 'delete from users')",
            "CREATE SERVER prod FOREIGN DATA WRAPPER postgres_fdw",
            "CREATE USER MAPPING FOR me SERVER prod",
            "IMPORT FOREIGN SCHEMA public FROM SERVER prod INTO x",
            "COPY t FROM PROGRAM 'curl x'",
        ]:
            with self.subTest(sql=sql):
                self.assertEqual(run({"tool_name": RUN_SQL, "tool_input": {"sql": sql, "branch_id": DEV}})[0], 2)

    def test_a_select_that_reaches_another_database_needs_a_human_on_prod_too(self):
        code, _, _ = run({"tool_name": RUN_SQL, "tool_input": {"sql": "SELECT dblink_exec('host=x', 'delete from users')"}})
        self.assertEqual(code, 2)
        code, _, _ = run({"tool_name": RUN_SQL, "tool_input": {"sql": "SELECT pg_read_file('/etc/passwd')"}})
        self.assertEqual(code, 2)

    def test_the_branch_id_is_matched_exactly(self):
        # The value checked has to be the value Neon receives.
        for variant in [DEV.upper(), f" {DEV} ", f"{DEV}\n"]:
            with self.subTest(branch=variant):
                self.assertEqual(run({"tool_name": RUN_SQL, "tool_input": {"sql": "UPDATE t SET x = 1", "branch_id": variant}})[0], 2)

    def test_empty_sql_on_a_dev_branch_fails_closed(self):
        self.assertEqual(run({"tool_name": RUN_SQL, "tool_input": {"sql": "   ", "branch_id": DEV}})[0], 2)

    def test_malformed_payloads_fail_closed(self):
        for bad in ["not json", "[]", "null", '{"tool_name":"x","tool_input":"y"}']:
            with self.subTest(payload=bad):
                self.assertEqual(run(bad)[0], 2)


if __name__ == "__main__":
    unittest.main()
