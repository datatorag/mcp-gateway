#!/usr/bin/env python3
"""Scan a commit range for text that must not be published: the added lines
of its diff, and every commit message in it.

    leak-scan.py --range <base>...<head>     # default: origin/main...HEAD
    leak-scan.py --tree                      # every tracked file
    leak-scan.py --self-test                 # prove every rule still fires

Exit 0 = clean. 1 = findings. 2 = the scan itself could not run.

THE RULE LIST IS NOT IN THIS REPOSITORY, AND IT NEVER WILL BE. A list of the
strings that must not be published is itself one of those strings. The scanner
is public; the list is handed to it, as JSON, in the LEAK_SCAN_PATTERNS
environment variable or in a file named by --patterns:

    {"patterns": [{"id": "...", "re": "...", "sample": "..."}],
     "allow":    [{"re": "..."}]}

WHAT THIS PRINTS, AND WHY IT IS SO LITTLE. In CI the output lands in a log that
anyone can read. So a finding names the rule and the place and nothing else:
never the matched text, never the line, never the rule's pattern, never its
sample. A scanner that printed what it caught would publish it. --show-matches
prints the detail for a person at a terminal and is refused wherever CI is set.

WHAT A CLEAN RESULT MEANS. That these rules, over this range, matched nothing.
It reads commit messages as well as content, because a message cannot be fixed
by a later commit, and the names of changed files, because a name is published
too. It reads bytes, so a file git would call binary is still read; content
with NUL bytes is read as UTF-16 as well, since that is what such a file
usually is. Text in an encoding other than UTF-8, UTF-16 or UTF-32 is read as
bytes and a rule will not match it.

An allow rule silences the whole line it matches on, as the scan run before a
push does. Keep allow rules narrow. Every commit in the range is read on its own, so text
added by one commit and deleted by the next is still found: it is in history,
and history is what gets published. A range scan sees only what the range
ADDS; text committed before a rule existed is invisible to it, which is what
--tree is for.

NOT READ: the author and committer names and addresses of a commit. A rule
for addresses would fire on every commit a person makes.

RULE IDS AND THE RULE COUNT ARE PRINTED, so they are public. An id must be a
category ("stripe-secret"), never a name.

A scan that had nothing to scan, or no rules to scan with, is an error and not
a pass. Skipped is not clean.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import warnings

# A warning about a regex can quote the regex, and the regexes are the secret.
warnings.simplefilter("ignore")

# Always on, and deliberately harmless: the one rule whose text may be public,
# so a pull request can prove the check goes red without publishing anything.
# Assembled from parts so this file does not contain the string it catches.
CANARY_ID = "canary"
CANARY = "LEAKSCAN" + "-" + "CANARY" + "-" + "DO-NOT-MERGE"

NO_LIST = (
    "leak-scan: no rule list. LEAK_SCAN_PATTERNS is empty and --patterns was not given.\n"
    "On a pull request from a fork the list is not available by design: nothing was\n"
    "scanned, and a maintainer must run the scan before this change can merge.\n"
)


def in_ci():
    return bool(os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"))


def load_rules(path):
    """Return (patterns, allow). Exits 2 when there is no list or it is malformed."""
    raw = None
    if path:
        try:
            raw = pathlib.Path(path).read_text()
        except OSError:
            sys.stderr.write("leak-scan: the --patterns file could not be read.\n")
            sys.exit(2)
    else:
        raw = os.environ.get("LEAK_SCAN_PATTERNS", "")
    if not raw.strip():
        sys.stderr.write(NO_LIST)
        sys.exit(2)
    try:
        cfg = json.loads(raw)
        patterns = list(cfg["patterns"])
        allow = list(cfg.get("allow", []))
    except (ValueError, KeyError, TypeError):
        # Say nothing about the content: a parse error message can quote it.
        sys.stderr.write("leak-scan: the rule list is not the expected JSON shape.\n")
        sys.exit(2)
    if not patterns:
        sys.stderr.write("leak-scan: the rule list has no rules. Refusing to report clean.\n")
        sys.exit(2)
    patterns.append({"id": CANARY_ID, "re": re.escape(CANARY), "sample": CANARY})
    return patterns, allow


def compile_rules(patterns, allow):
    rules = []
    for index, p in enumerate(patterns, 1):
        try:
            rules.append((str(p["id"]), re.compile(p["re"], re.I)))
        except (re.error, KeyError, TypeError):
            sys.stderr.write(f"leak-scan: rule {index} does not compile.\n")
            sys.exit(2)
    allows = []
    for index, a in enumerate(allow, 1):
        try:
            allows.append(re.compile(a["re"], re.I))
        except (re.error, KeyError, TypeError):
            sys.stderr.write(f"leak-scan: allow rule {index} does not compile.\n")
            sys.exit(2)
    return rules, allows


def self_test(patterns, allow):
    """Every rule must match its own sample, and no allow rule may swallow one.
    A rule that has stopped matching reports clean forever."""
    rules, allows = compile_rules(patterns, allow)
    broken = []
    for (rule_id, rx), p in zip(rules, patterns):
        sample = p.get("sample")
        if not sample:
            broken.append(f"{rule_id}: has no sample, so it can never be shown to work")
        elif not rx.search(sample):
            broken.append(f"{rule_id}: no longer matches its own sample")
        elif any(a.search(sample) for a in allows):
            broken.append(f"{rule_id}: its sample is swallowed by an allow rule")
    if broken:
        sys.stderr.write("leak-scan: SELF-TEST FAILED. Nothing was scanned:\n")
        for line in broken:
            sys.stderr.write(f"  - {line}\n")
        return 2
    print(f"leak-scan: self-test ok, {len(rules)} rules each match their sample.")
    return 0


EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
GITLINK = "160000"


def git(repo, *args):
    """Run git and return its output as BYTES. Nothing here decodes a whole
    output or lets Python choose where lines end: a file may hold any byte, and
    a carriage return or a form feed inside a line is not the end of it."""
    # Replacement refs are local and can hide a commit from a scan; ignore them.
    env = dict(os.environ, GIT_NO_REPLACE_OBJECTS="1")
    done = subprocess.run(["git", "-C", repo, *args], capture_output=True, env=env)
    if done.returncode != 0:
        sys.stderr.write(f"leak-scan: git {args[0]} failed. Nothing was scanned.\n")
        sys.exit(2)
    return done.stdout


def _split(text):
    """Split decoded text on the newline only. Each line loses one trailing
    carriage return, and the first a byte-order mark, so a rule anchored with
    ^ or $ matches in a CRLF file exactly as it does in an LF one."""
    lines = text.split("\n")
    if lines and lines[0].startswith("\ufeff"):
        lines[0] = lines[0][1:]
    return [line[:-1] if line.endswith("\r") else line for line in lines]


def text_lines(data):
    """Every (line_number, text) this content could be read as.

    Bytes are split on the newline byte and decoded as UTF-8, leniently. That
    is the whole answer for ordinary text. UTF-16 and UTF-32 text is the case
    it gets wrong: every character carries NUL bytes, so the line is read and
    no rule can match it. So content that starts with a byte-order mark is
    decoded by it, and content holding NUL bytes is ALSO read as UTF-16 in
    both byte orders and with the NULs removed. Extra readings can only add
    findings. They cannot hide one.
    """
    readings = []
    if data.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
        readings.append(data.decode("utf-32", "replace"))
    elif data.startswith((b"\xff\xfe", b"\xfe\xff")):
        readings.append(data.decode("utf-16", "replace"))
    readings.append(None)  # the plain reading, split as bytes below
    if b"\x00" in data:
        readings.append(data.decode("utf-16-le", "replace"))
        readings.append(data.decode("utf-16-be", "replace"))
        readings.append(data.replace(b"\x00", b"").decode("utf-8", "replace"))
    out, seen = [], set()
    for reading in readings:
        if reading is None:
            lines = _split("\n".join(raw.decode("utf-8", "replace") for raw in data.split(b"\n")))
        else:
            lines = _split(reading)
        for number, line in enumerate(lines, 1):
            if (number, line) not in seen:
                seen.add((number, line))
                out.append((number, line))
    return out


def printable(path):
    """A path as it may be printed: control characters shown, never emitted,
    so a file name cannot write a line of its own into the log."""
    return "".join(ch if ch.isprintable() else repr(ch)[1:-1] for ch in path)


def matches(line, rules, allows):
    """Yield (rule_id, matched_text) for every rule that fires on the line."""
    if any(a.search(line) for a in allows):
        return
    for rule_id, rx in rules:
        m = rx.search(line)
        if m:
            yield rule_id, m.group(0)


def changed_entries(repo, old, new):
    """What differs between two trees, as (old_blob, new_blob, mode, path).

    Read from git's raw, NUL-separated form: no unified diff is parsed, so no
    file content can pass for a header, and a path arrives as its own bytes
    whatever characters it holds. Renames are off, so a moved file is a new
    path. Deleted paths are left out: a deletion publishes nothing new.
    """
    raw = git(repo, "diff-tree", "-r", "-z", "--no-renames", "--raw", old, new)
    parts = raw.split(b"\0")
    entries = []
    for at in range(0, len(parts) - 1, 2):
        meta = parts[at].decode("ascii", "replace").lstrip(":").split()
        if len(meta) != 5:
            sys.stderr.write("leak-scan: git's change list was not in the expected form.\n")
            sys.exit(2)
        _old_mode, new_mode, old_blob, new_blob, status = meta
        if status.startswith("D"):
            continue
        entries.append((old_blob, new_blob, new_mode, parts[at + 1].decode("utf-8", "replace")))
    return entries


def blob_lines(repo, blob):
    if set(blob) == {"0"}:
        return []
    return text_lines(git(repo, "cat-file", "blob", blob))


def scan_change(repo, old, new, label, rules, allows, note):
    """Scan what `new` adds over `old`: every line of each changed file that
    the old version of that file did not already hold, and every changed
    path's name. Binary or not makes no difference; the bytes are read."""
    for position, (old_blob, new_blob, mode, path) in enumerate(changed_entries(repo, old, new), 1):
        name_hits = list(matches(path, rules, allows))
        for rule_id, hit in name_hits:
            note(rule_id, f"{label}, the name of changed path {position}", hit)
        # A path that itself matches a rule is never printed: it is the match.
        shown = f"changed path {position}" if name_hits else printable(path)
        if mode == GITLINK:
            continue  # a submodule pointer: a commit id, not content
        before = {line for _number, line in blob_lines(repo, old_blob)}
        for number, line in blob_lines(repo, new_blob):
            if line in before:
                continue
            for rule_id, hit in matches(line, rules, allows):
                note(rule_id, f"{label}, {shown}:{number}", hit)


def scan_range(repo, rng, rules, allows):
    """Scan EVERY COMMIT in the range on its own, then the range as a whole.

    The net change alone is not enough: text added by one commit and deleted
    by the next is absent from it and present in history, which is where a
    merge puts it for good. So each commit is compared with its first parent
    and its message is read, and the range's net change is read as well.
    """
    if "..." in rng:
        base, head = rng.split("...", 1)
    elif ".." in rng:
        base, head = rng.split("..", 1)
    else:
        sys.stderr.write("leak-scan: --range needs the form <base>...<head>.\n")
        sys.exit(2)
    commits = git(repo, "rev-list", "--reverse", f"{base}..{head}").decode().split()
    fork = git(repo, "merge-base", base, head).decode().strip()
    tip = git(repo, "rev-parse", f"{head}^{{commit}}").decode().strip()
    if not commits and fork == tip:
        sys.stderr.write(
            "leak-scan: the range has no commits and no change. Refusing to report clean "
            "on an empty scan.\n"
        )
        sys.exit(2)

    found = {}

    def note(rule_id, where, hit):
        found.setdefault((rule_id, where), hit)

    for sha in commits:
        label = f"commit {sha[:12]}"
        for _number, line in text_lines(git(repo, "show", "--no-patch", "--format=%B", sha)):
            for rule_id, hit in matches(line, rules, allows):
                note(rule_id, f"{label}, message", hit)
        parents = git(repo, "rev-list", "--parents", "-n", "1", sha).decode().split()[1:]
        scan_change(repo, parents[0] if parents else EMPTY_TREE, sha, label, rules, allows, note)
    scan_change(repo, fork, tip, "range", rules, allows, note)

    findings = [(rule_id, where, hit) for (rule_id, where), hit in found.items()]
    scope = (
        f"{len(commits)} commit(s) in {base}..{head}: each commit's added lines, "
        "changed path names and message, and the net change"
    )
    return findings, scope


def scan_tree(repo, rules, allows):
    files = [f.decode("utf-8", "replace") for f in git(repo, "ls-files", "-z").split(b"\0") if f]
    if not files:
        sys.stderr.write("leak-scan: no tracked files. Refusing to report clean.\n")
        sys.exit(2)
    findings, unread = [], 0
    for position, rel in enumerate(files, 1):
        name_hits = list(matches(rel, rules, allows))
        for rule_id, hit in name_hits:
            findings.append((rule_id, f"the name of tracked file {position}", hit))
        shown = f"tracked file {position}" if name_hits else printable(rel)
        full = pathlib.Path(repo, rel)
        try:
            data = os.readlink(full).encode() if full.is_symlink() else full.read_bytes()
        except IsADirectoryError:
            continue  # a submodule
        except OSError:
            unread += 1
            continue
        for number, line in text_lines(data):
            for rule_id, hit in matches(line, rules, allows):
                findings.append((rule_id, f"{shown}:{number}", hit))
    if unread:
        # A file the scan could not open was not scanned. That is not clean.
        sys.stderr.write(f"leak-scan: {unread} tracked file(s) could not be read. Refusing to report clean.\n")
        sys.exit(2)
    return findings, f"{len(files)} tracked files (whole tree), names and content"


def report(findings, scope, rule_count, show):
    if not findings:
        print(f"leak-scan: clean. {rule_count} rules over {scope}.")
        return 0
    print(f"leak-scan: {len(findings)} finding(s) over {scope}.")
    for rule_id, where, hit in findings:
        print(f"  [{rule_id}] {where}")
        if show:
            print(f"      matched: {hit}")
    if not show:
        print("The matched text is not printed. Run the scan locally with --show-matches to see it.")
    print("Remove it from every commit in the range. A later commit that deletes it is not enough.")
    return 1


def main(argv):
    args = list(argv)
    show = "--show-matches" in args
    tree = "--tree" in args
    test = "--self-test" in args
    args = [a for a in args if a not in ("--show-matches", "--tree", "--self-test")]

    def take(flag, default):
        if flag in args:
            at = args.index(flag)
            if at + 1 >= len(args):
                sys.stderr.write(f"leak-scan: {flag} needs a value.\n")
                sys.exit(2)
            value = args[at + 1]
            del args[at : at + 2]
            return value
        return default

    patterns_path = take("--patterns", None)
    rng = take("--range", "origin/main...HEAD")
    repo = take("--repo", ".")
    if args:
        sys.stderr.write(__doc__)
        return 2
    if show and in_ci():
        sys.stderr.write("leak-scan: --show-matches is refused in CI. Its output would be public.\n")
        return 2

    patterns, allow = load_rules(patterns_path)
    if test:
        return self_test(patterns, allow)
    rules, allows = compile_rules(patterns, allow)
    findings, scope = scan_tree(repo, rules, allows) if tree else scan_range(repo, rng, rules, allows)
    return report(findings, scope, len(rules), show)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001
        # Never a traceback: it can carry a value. The type alone says enough.
        sys.stderr.write(f"leak-scan: stopped on {type(exc).__name__}. Nothing is reported clean.\n")
        sys.exit(2)
