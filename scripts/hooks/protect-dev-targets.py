#!/usr/bin/env python3
"""PreToolUse gate on the editing tools: the dev-target allowlist is a human's (SCRUM-339).

~/.config/datatorag/db-dev-targets.json decides which Neon branches
db-guard.py lets write. A session that could write to it could list the
production branch and loosen the guard, so the editing tools refuse it, and
anything else in that directory, by path. db-client-guard.py refuses Bash
commands that name it.

Blocks with exit 2, fails closed on a payload it cannot read, and has no
escape hatch: a human edits the file in their own editor.
"""

from __future__ import annotations

import json
import sys
from pathlib import PurePath

PROTECTED = "db-dev-targets"
PROTECTED_DIR = (".config", "datatorag")


def protected(path: str) -> bool:
    p = PurePath(path)
    name = p.name.lower()
    if name.startswith(PROTECTED) and "example" not in name:
        return True
    parts = [x.lower() for x in p.parts]
    return any(parts[i : i + 2] == list(PROTECTED_DIR) for i in range(len(parts) - 1))


def target_paths(tool_input: dict) -> list[str]:
    paths = [tool_input.get(k) for k in ("file_path", "notebook_path", "path")]
    for edit in tool_input.get("edits") or []:
        if isinstance(edit, dict):
            paths.append(edit.get("file_path"))
    return [p for p in paths if isinstance(p, str)]


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict) or not isinstance(payload.get("tool_input"), dict):
            raise ValueError("the payload is not a tool call object")
        paths = target_paths(payload["tool_input"])
    except Exception as exc:  # noqa: BLE001 - an unreadable payload must not open the gate
        sys.stderr.write(f"DEV TARGETS GUARD — BLOCKED: could not read the hook payload ({exc})\n")
        return 2
    for p in paths:
        if protected(p):
            sys.stderr.write(
                "DEV TARGETS GUARD — BLOCKED: this file decides which databases the guards treat "
                "as dev, so only a human edits it, in their own editor. Stop and ask for the change.\n"
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
