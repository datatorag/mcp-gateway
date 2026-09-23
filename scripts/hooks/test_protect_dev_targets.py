"""The editing-tool guard on the dev-branch allowlist (SCRUM-339).

Run: python3 -m unittest scripts/hooks/test_protect_dev_targets.py
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

HOOK = Path(__file__).parent / "protect-dev-targets.py"
ALLOWLIST = str(Path.home() / ".config" / "datatorag" / "db-dev-targets.json")


def run(payload) -> int:
    data = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run([sys.executable, str(HOOK)], input=data, capture_output=True, text=True).returncode


class ProtectDevTargets(unittest.TestCase):
    def test_every_editing_tool_is_refused_the_allowlist(self):
        for tool, key in [("Write", "file_path"), ("Edit", "file_path"), ("MultiEdit", "file_path"), ("NotebookEdit", "notebook_path")]:
            with self.subTest(tool=tool):
                self.assertEqual(run({"tool_name": tool, "tool_input": {key: ALLOWLIST}}), 2)

    def test_the_directory_and_any_copy_of_the_name(self):
        for p in [str(Path.home() / ".config" / "datatorag" / "other.json"), "/tmp/DB-DEV-TARGETS.json", "x/db-dev-targets.local.json"]:
            with self.subTest(path=p):
                self.assertEqual(run({"tool_name": "Write", "tool_input": {"file_path": p}}), 2)

    def test_other_files_and_the_example_are_editable(self):
        for p in ["/repo/scripts/hooks/db-dev-targets.example.json", "/repo/README.md", "/repo/scripts/hooks/db_targets.py"]:
            with self.subTest(path=p):
                self.assertEqual(run({"tool_name": "Edit", "tool_input": {"file_path": p}}), 0)

    def test_unreadable_payloads_fail_closed(self):
        for bad in ["not json", "[]", '{"tool_name":"Write","tool_input":"x"}']:
            with self.subTest(payload=bad):
                self.assertEqual(run(bad), 2)


if __name__ == "__main__":
    unittest.main()
