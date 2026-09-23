"""Which Neon branches count as dev, for db-guard.py (SCRUM-339).

The guards are for PRODUCTION. Dev databases are there to be meddled with,
and they are meddled with through the Neon MCP: a `run_sql` or
`run_sql_transaction` write whose `branch_id` is a dev branch listed here is
allowed. The MCP runs the SQL on that branch itself, so, unlike a psql or
driver client pointed at a "dev" host, nothing relays from it to prod: the
statements that could build such a bridge (extensions, foreign servers,
dblink, server-side file and program access) still need a human on every
branch.

The list lives OUTSIDE the repository, at

    ~/.config/datatorag/db-dev-targets.json

because branch ids are internal ids and this repository is public, and
because a file inside the tree a session works in is a file the session can
write. Its shape is in scripts/hooks/db-dev-targets.example.json.

ONLY A HUMAN EDITS IT, in their own editor. It decides what db-guard lets
write, so a session that could add to it could loosen the guard:
protect-dev-targets.py refuses it to the editing tools and db-client-guard.py
refuses Bash commands that name it. To add a dev branch: create it in Neon,
copy its id (br-...) into the file by hand. NEVER the default branch's id:
that branch is production.

A missing, unreadable or malformed file means no branch is dev, which is the
safe direction to fail in.
"""

from __future__ import annotations

import json
from pathlib import Path

TARGETS_FILE = Path.home() / ".config" / "datatorag" / "db-dev-targets.json"


def load() -> dict[str, set[str]]:
    empty: dict[str, set[str]] = {"neon_branch_ids": set()}
    try:
        raw = json.loads(TARGETS_FILE.read_text())
    except Exception:  # noqa: BLE001 - absent or unreadable means nothing is dev
        return empty
    if not isinstance(raw, dict) or not isinstance(raw.get("neon_branch_ids"), list):
        return empty
    return {"neon_branch_ids": {v.strip().lower() for v in raw["neon_branch_ids"] if isinstance(v, str) and v.strip()}}
