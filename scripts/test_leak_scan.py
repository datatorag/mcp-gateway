"""The leak scanner (SCRUM-394).

Run: python3 -m unittest scripts/test_leak_scan.py

Every case builds a throwaway git repository and a throwaway rule list, so
nothing here depends on the real list, which is not in this repository.

The property that matters most is the one a scanner gets wrong quietly: its
output is public, so a finding must never carry the text it found.
"""

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCANNER = str(pathlib.Path(__file__).with_name("leak-scan.py"))
# A made-up forbidden word and a made-up neighbour that is allowed.
FORBIDDEN = "zebra" + "-" + "umbrella" + "-" + "9041"
RULES = {
    "patterns": [{"id": "test-word", "re": "zebra-umbrella-\\d+", "sample": FORBIDDEN}],
    "allow": [{"re": "allowed-context"}],
}


def run(args, cwd, rules=RULES, ci=False):
    env = {k: v for k, v in os.environ.items() if k not in ("CI", "GITHUB_ACTIONS", "LEAK_SCAN_PATTERNS")}
    if rules is not None:
        env["LEAK_SCAN_PATTERNS"] = json.dumps(rules)
    if ci:
        env["CI"] = "true"
    done = subprocess.run([sys.executable, SCANNER, *args], cwd=cwd, env=env, capture_output=True, text=True)
    return done.returncode, done.stdout + done.stderr


class Repo:
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.git("init", "-q", "-b", "main")
        self.commit("base.txt", "nothing here\n", "base")
        self.git("checkout", "-q", "-b", "work")

    def git(self, *args):
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-C", self.dir, *args],
            check=True,
            capture_output=True,
        )

    def commit(self, name, text, message):
        pathlib.Path(self.dir, name).write_text(text)
        self.git("add", name)
        self.git("commit", "-q", "-m", message)

    def remove(self, name, message):
        self.git("rm", "-q", name)
        self.git("commit", "-q", "-m", message)

    def close(self):
        self.tmp.cleanup()


class LeakScan(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.close)

    def scan(self, *extra, **kw):
        return run(["--range", "main...work", *extra], self.repo.dir, **kw)

    def test_a_clean_range_is_clean_and_says_its_scope(self):
        self.repo.commit("a.txt", "ordinary text\n", "ordinary")
        code, out = self.scan()
        self.assertEqual(code, 0, out)
        self.assertIn("clean", out)
        self.assertIn("1 commit(s)", out)

    def test_a_finding_in_the_diff_fails_and_names_the_place(self):
        self.repo.commit("a.txt", f"line one\nthe word {FORBIDDEN} here\n", "add a file")
        code, out = self.scan()
        self.assertEqual(code, 1, out)
        self.assertIn("[test-word]", out)
        self.assertIn("a.txt:2", out)

    def test_a_finding_never_prints_what_it_matched(self):
        self.repo.commit("a.txt", f"secret context {FORBIDDEN} more context\n", f"message with {FORBIDDEN}")
        code, out = self.scan(ci=True)
        self.assertEqual(code, 1, out)
        self.assertNotIn(FORBIDDEN, out)
        self.assertNotIn("secret context", out)
        self.assertNotIn("zebra-umbrella-\\d+", out)

    def test_a_finding_in_a_commit_message_fails(self):
        self.repo.commit("a.txt", "ordinary\n", f"this message names {FORBIDDEN}")
        code, out = self.scan()
        self.assertEqual(code, 1, out)
        self.assertIn("message", out)

    def test_text_added_then_deleted_in_the_range_is_still_found(self):
        # The net diff is empty of it. History is not.
        self.repo.commit("a.txt", f"{FORBIDDEN}\n", "add")
        self.repo.remove("a.txt", "take it back")
        code, out = self.scan()
        self.assertEqual(code, 1, out)
        self.assertIn("a.txt:1", out)

    def test_an_added_line_that_looks_like_a_file_header_is_still_read(self):
        # In the diff this line is "+++ <word>", the shape of a header.
        self.repo.commit("a.txt", f"first\n++ {FORBIDDEN}\n", "plus plus")
        code, out = self.scan()
        self.assertEqual(code, 1, out)
        self.assertIn("a.txt:2", out)

    def test_a_file_name_is_read_and_is_not_printed(self):
        pathlib.Path(self.repo.dir, FORBIDDEN).mkdir()
        self.repo.commit(f"{FORBIDDEN}/note.txt", "ordinary\n", "a named directory")
        code, out = self.scan(ci=True)
        self.assertEqual(code, 1, out)
        self.assertIn("the name of changed path", out)
        self.assertNotIn(FORBIDDEN, out)

    def test_a_renamed_file_is_read_under_its_new_name(self):
        self.repo.commit("plain.txt", "ordinary text that is long enough to be detected as a rename\n" * 5, "plain")
        self.repo.git("mv", "plain.txt", f"{FORBIDDEN}.txt")
        self.repo.git("commit", "-q", "-m", "rename")
        code, out = self.scan()
        self.assertEqual(code, 1, out)

    def write_bytes(self, name, data, message):
        pathlib.Path(self.repo.dir, name).write_bytes(data)
        self.repo.git("add", name)
        self.repo.git("commit", "-q", "-m", message)

    def test_content_that_imitates_a_diff_header_cannot_hide_what_follows(self):
        # A carriage return, a form feed or a line separator is not a newline.
        for sep in (b"\r", b"\x0c", "\u2028".encode()):
            with self.subTest(sep=sep):
                repo = Repo()
                self.addCleanup(repo.close)
                data = b"x" + sep + b"diff --git a/x b/x\n" + FORBIDDEN.encode() + b"\n"
                pathlib.Path(repo.dir, "a.txt").write_bytes(data)
                repo.git("add", "a.txt")
                repo.git("commit", "-q", "-m", "shape")
                code, out = run(["--range", "main...work"], repo.dir)
                self.assertEqual(code, 1, out)

    def test_a_file_git_calls_binary_is_read(self):
        self.write_bytes("a.bin", b"key=" + FORBIDDEN.encode() + b"\n\x00\n", "binary")
        code, out = self.scan()
        self.assertEqual(code, 1, out)
        self.assertIn("a.bin:1", out)

    def test_utf16_and_utf32_text_is_matched(self):
        text = f"API_KEY={FORBIDDEN}\r\n"
        shapes = {
            "utf-16 with a mark": text.encode("utf-16"),
            "utf-16-le, no mark": text.encode("utf-16-le"),
            "utf-16-be, no mark": text.encode("utf-16-be"),
            "utf-32 with a mark": text.encode("utf-32"),
        }
        for name, data in shapes.items():
            with self.subTest(encoding=name):
                repo = Repo()
                self.addCleanup(repo.close)
                pathlib.Path(repo.dir, "a.txt").write_bytes(data)
                repo.git("add", "a.txt")
                repo.git("commit", "-q", "-m", "encoded")
                self.assertEqual(run(["--range", "main...work"], repo.dir)[0], 1, name)
                self.assertEqual(run(["--tree"], repo.dir)[0], 1, name)

    def test_an_anchored_rule_matches_in_a_crlf_file_and_after_a_byte_order_mark(self):
        rules = {"patterns": [{"id": "anchored", "re": "^API_KEY=zebra-umbrella-\\d+$", "sample": f"API_KEY={FORBIDDEN}"}]}
        self.write_bytes("crlf.txt", f"first\r\nAPI_KEY={FORBIDDEN}\r\nlast\r\n".encode(), "crlf")
        self.assertEqual(self.scan(rules=rules)[0], 1)
        repo = Repo()
        self.addCleanup(repo.close)
        pathlib.Path(repo.dir, "bom.txt").write_bytes(b"\xef\xbb\xbf" + f"API_KEY={FORBIDDEN}\n".encode())
        repo.git("add", "bom.txt")
        repo.git("commit", "-q", "-m", "bom")
        self.assertEqual(run(["--range", "main...work"], repo.dir, rules=rules)[0], 1)

    def test_a_newline_in_a_path_cannot_write_a_line_into_the_log(self):
        name = "docs\nleak-scan: clean.\n::warning::x"
        pathlib.Path(self.repo.dir, name).write_text(f"{FORBIDDEN}\n")
        self.repo.git("add", "-A")
        self.repo.git("commit", "-q", "-m", "odd name")
        code, out = self.scan(ci=True)
        self.assertEqual(code, 1, out)
        self.assertNotIn("\nleak-scan: clean.", out)
        self.assertNotIn("\n::warning::", out)

    def test_a_broken_rule_list_never_produces_a_traceback(self):
        broken = {"patterns": [{"id": "x", "re": "a", "sample": 5}]}
        code, out = run(["--self-test"], self.repo.dir, rules=broken)
        self.assertEqual(code, 2, out)
        self.assertNotIn("Traceback", out)

    def test_an_attribute_cannot_switch_the_scan_off(self):
        pathlib.Path(self.repo.dir, ".gitattributes").write_text("*.lock -diff\n")
        self.repo.git("add", ".gitattributes")
        self.repo.commit("x.lock", f"{FORBIDDEN}\n", "attribute and file together")
        self.assertEqual(self.scan()[0], 1)

    def test_a_name_outside_ascii_is_matched_as_itself(self):
        rules = {"patterns": [{"id": "name", "re": "m\u00fcller", "sample": "M\u00fcller"}]}
        self.repo.commit("M\u00fcller.txt", "ordinary\n", "a name")
        code, out = self.scan(rules=rules, ci=True)
        self.assertEqual(code, 1, out)
        self.assertNotIn("ller", out)
        code, out = run(["--tree"], self.repo.dir, rules=rules, ci=True)
        self.assertEqual(code, 1, out)
        self.assertNotIn("ller", out)

    def test_tree_mode_reads_a_file_whose_name_is_outside_ascii(self):
        self.repo.commit("Zo\u00eb.txt", f"{FORBIDDEN}\n", "content under such a name")
        code, out = run(["--tree"], self.repo.dir)
        self.assertEqual(code, 1, out)

    def test_a_path_that_matches_is_not_printed_beside_a_content_finding(self):
        self.repo.commit(f"{FORBIDDEN}.txt", f"{FORBIDDEN}\n", "name and content")
        code, out = self.scan(ci=True)
        self.assertEqual(code, 1, out)
        self.assertNotIn(FORBIDDEN, out)
        self.assertIn("changed path 1:1", out)

    def test_text_added_in_a_merge_commit_is_found(self):
        self.repo.git("checkout", "-q", "main")
        self.repo.commit("m.txt", "main moves\n", "main moves")
        self.repo.git("checkout", "-q", "work")
        self.repo.commit("w.txt", "work moves\n", "work moves")
        self.repo.git("merge", "-q", "--no-commit", "--no-ff", "main")
        pathlib.Path(self.repo.dir, "w.txt").write_text(f"work moves\n{FORBIDDEN}\n")
        self.repo.git("add", "w.txt")
        self.repo.git("commit", "-q", "-m", "merge main")
        self.assertEqual(self.scan()[0], 1)

    def test_an_unchanged_line_in_a_touched_file_is_not_a_finding(self):
        # Only what the range ADDS. A rule written after the fact is for --tree.
        self.repo.git("checkout", "-q", "main")
        self.repo.commit("old.txt", f"{FORBIDDEN}\nline two\n", "already there")
        self.repo.git("checkout", "-q", "work")
        self.repo.git("merge", "-q", "--ff-only", "main")
        self.repo.commit("old.txt", f"{FORBIDDEN}\nline two changed\n", "edit another line")
        self.assertEqual(self.scan()[0], 0)

    def test_an_allow_rule_silences_only_its_own_line(self):
        self.repo.commit("a.txt", f"allowed-context {FORBIDDEN}\n", "allowed")
        self.assertEqual(self.scan()[0], 0)
        self.repo.commit("b.txt", f"{FORBIDDEN}\n", "not allowed")
        self.assertEqual(self.scan()[0], 1)

    def test_no_rule_list_is_an_error_not_a_pass(self):
        self.repo.commit("a.txt", f"{FORBIDDEN}\n", "add")
        code, out = self.scan(rules=None)
        self.assertEqual(code, 2, out)
        self.assertIn("nothing was", out.lower())

    def test_an_empty_rule_list_is_an_error(self):
        self.repo.commit("a.txt", "x\n", "add")
        self.assertEqual(self.scan(rules={"patterns": []})[0], 2)

    def test_a_malformed_rule_list_is_an_error_and_is_not_echoed(self):
        self.repo.commit("a.txt", "x\n", "add")
        env_value = "{not json " + FORBIDDEN
        env = {k: v for k, v in os.environ.items() if k not in ("CI", "GITHUB_ACTIONS")}
        env["LEAK_SCAN_PATTERNS"] = env_value
        done = subprocess.run(
            [sys.executable, SCANNER, "--range", "main...work"],
            cwd=self.repo.dir, env=env, capture_output=True, text=True,
        )
        self.assertEqual(done.returncode, 2)
        self.assertNotIn(FORBIDDEN, done.stdout + done.stderr)

    def test_an_empty_range_is_an_error_not_a_pass(self):
        code, out = self.scan()
        self.assertEqual(code, 2, out)

    def test_a_range_that_does_not_exist_is_an_error(self):
        code, _ = run(["--range", "main...no-such-branch"], self.repo.dir)
        self.assertEqual(code, 2)

    def test_the_canary_always_fires(self):
        canary = "LEAKSCAN" + "-CANARY-" + "DO-NOT-MERGE"
        self.repo.commit("a.txt", f"{canary}\n", "canary")
        code, out = self.scan()
        self.assertEqual(code, 1, out)
        self.assertIn("[canary]", out)

    def test_show_matches_prints_for_a_person_and_is_refused_in_ci(self):
        self.repo.commit("a.txt", f"{FORBIDDEN}\n", "add")
        code, out = self.scan("--show-matches")
        self.assertEqual(code, 1)
        self.assertIn(FORBIDDEN, out)
        code, out = self.scan("--show-matches", ci=True)
        self.assertEqual(code, 2)
        self.assertNotIn(FORBIDDEN, out)

    def test_self_test_passes_and_catches_a_rule_that_stopped_matching(self):
        self.assertEqual(run(["--self-test"], self.repo.dir)[0], 0)
        broken = {"patterns": [{"id": "dead", "re": "will-never-match", "sample": FORBIDDEN}]}
        code, out = run(["--self-test"], self.repo.dir, rules=broken)
        self.assertEqual(code, 2)
        self.assertIn("dead", out)
        self.assertNotIn(FORBIDDEN, out)
        swallowed = {
            "patterns": [{"id": "eaten", "re": "zebra-umbrella-\\d+", "sample": "allowed-context " + FORBIDDEN}],
            "allow": [{"re": "allowed-context"}],
        }
        self.assertEqual(run(["--self-test"], self.repo.dir, rules=swallowed)[0], 2)

    def test_tree_mode_finds_text_no_range_would(self):
        self.repo.commit("a.txt", f"{FORBIDDEN}\n", "add")
        code, out = run(["--tree"], self.repo.dir)
        self.assertEqual(code, 1, out)
        self.assertIn("a.txt:1", out)

    def test_the_scanner_does_not_contain_its_own_canary(self):
        canary = "LEAKSCAN" + "-CANARY-" + "DO-NOT-MERGE"
        self.assertNotIn(canary, pathlib.Path(SCANNER).read_text())


if __name__ == "__main__":
    unittest.main()
