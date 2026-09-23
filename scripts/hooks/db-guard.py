#!/usr/bin/env python3
"""PreToolUse gate for database calls.

Reads a Claude Code hook payload on stdin, classifies the SQL, and lets reads
through while BLOCKING anything that can change or destroy data. A blocked call
is meant to be brought to a human, shown as exact SQL, and re-run only after
they say yes.

TWO DESIGN RULES, both learned the hard way.

1. FAIL CLOSED. An unrecognised statement is treated as destructive, never as a
   read. This codebase has previously shipped a write gate that classified an
   unknown verb as a read and let it run unapproved. A gate that guesses
   "probably a read" is worse than no gate, because it is trusted.

2. BLOCK WITH EXIT 2, NOT WITH A JSON DECISION. `permissionDecision: "ask"` is
   not reliable: in a bypass-permissions session it is silently overridden and
   the call proceeds. `systemMessage` and `permissionDecisionReason` do not
   reach the model either. Exit 2 is the only channel that both stops the call
   and explains why. This was found by installing the gate, verifying it fired,
   and then discovering a destructive statement had executed anyway -- proving a
   gate FIRES is not proving it STOPS.

Escape hatch, deliberately awkward: set `DB_GUARD_CONFIRMED=1` for a single call
after a human has seen the exact SQL and approved it. An env var rather than
anything in the SQL, so it cannot be set from inside a query and does not
persist. A session cannot set it; when it is needed, a human runs the SQL.

PROD ONLY (SCRUM-339 amendment). A write through `run_sql` or
`run_sql_transaction` whose `branch_id` is a dev branch a HUMAN listed in
~/.config/datatorag/db-dev-targets.json, outside the repo, is allowed, and the
reason says so. This is how dev databases are meddled with: no psql is
needed for any database, since the MCP runs the SQL on the named branch. The SQL is still classified and the reason logged. A write with no
`branch_id` runs on the default branch, which is production, and keeps
needing the confirmation above, as does any branch nobody listed. The list is
an allowlist of dev branches rather than a test for "not the default branch"
because this hook cannot ask Neon which branch is the default, and a branch
it does not recognise must be treated as prod. See db_targets.py.
"""

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import db_targets  # noqa: E402

# The SQL runners a listed dev branch may write through. Every other tool in
# ALWAYS_BLOCK_TOOLS stays blocked on any branch: deleting or resetting a
# branch is not a write to be waved through because the branch is dev.
DEV_BRANCH_WRITABLE = {
    "mcp__plugin_neon_neon__run_sql",
    "mcp__plugin_neon_neon__run_sql_transaction",
}

# Statements that let one database reach another. Refused on a dev branch.
RELAY_SQL = re.compile(
    r"\b(create\s+extension|alter\s+extension|dblink\w*|postgres_fdw|create\s+server|alter\s+server"
    r"|user\s+mapping|import\s+foreign\s+schema|create\s+foreign\s+table|create\s+subscription"
    r"|create\s+publication|pg_read_file|pg_ls_dir|lo_import|lo_export|copy\b[^;]*\bprogram)\b"
)

# Tools that are destructive by identity, whatever arguments they carry.
ALWAYS_BLOCK_TOOLS = {
    "mcp__plugin_neon_neon__delete_project",
    "mcp__plugin_neon_neon__delete_branch",
    "mcp__plugin_neon_neon__reset_from_parent",
    "mcp__plugin_neon_neon__prepare_database_migration",
    "mcp__plugin_neon_neon__complete_database_migration",
    "mcp__plugin_neon_neon__run_sql_transaction",
}

READ_VERBS = {"select", "explain", "show", "table", "values"}

WRITE_VERBS = {
    "insert", "update", "delete", "merge", "upsert",
    "drop", "truncate", "alter", "create", "rename", "comment",
    "grant", "revoke", "vacuum", "analyze", "reindex", "cluster",
    "begin", "commit", "rollback", "savepoint",
    "copy", "call", "do", "set", "reset", "lock", "refresh",
}


def strip_sql_comments(sql: str) -> str:
    """Remove -- and /* */ comments so keywords cannot hide inside them."""
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


def classify(sql: str):
    """Return (decision, reason). decision is 'allow' or 'block'."""
    if not sql or not sql.strip():
        return "block", "empty or unreadable SQL — cannot classify, so treating as destructive"

    cleaned = strip_sql_comments(sql)
    lowered = cleaned.lower()

    # A CTE can carry a data-modifying statement:
    #   WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x
    # The leading verb is WITH, so verb-matching alone would call this a read.
    if re.search(r"\bwith\b", lowered) and re.search(
        r"\b(insert|update|delete|merge)\b", lowered
    ):
        return "block", "CTE contains a data-modifying statement (INSERT/UPDATE/DELETE/MERGE)"

    # Classify every statement, not just the first — a read can be followed by a write.
    statements = [s.strip() for s in cleaned.split(";") if s.strip()]
    if not statements:
        return "block", "no parseable statement — treating as destructive"

    for stmt in statements:
        match = re.match(r"[\(\s]*([a-zA-Z_]+)", stmt)
        if not match:
            return "block", f"could not read a leading verb from: {stmt[:60]!r}"
        verb = match.group(1).lower()

        if verb in WRITE_VERBS:
            return "block", f"statement begins with {verb.upper()} — this can change or destroy data"
        if verb == "with":
            continue  # read-only CTE; the data-modifying case is caught above
        if verb not in READ_VERBS:
            return "block", f"unrecognised statement verb {verb.upper()!r} — failing closed"

    return "allow", f"read-only ({len(statements)} statement(s))"


def allow(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "permissionDecisionReason": f"db-guard: {reason}",
                }
            }
        )
    )


def block(reason: str) -> None:
    sys.stderr.write(
        "DB GUARD — BLOCKED. This statement can change or destroy data:\n"
        f"  {reason}\n"
        "Destructive database calls require explicit human confirmation. Show the exact "
        "SQL, get an approval, then re-run that single call with DB_GUARD_CONFIRMED=1.\n"
    )
    sys.exit(2)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001 - a malformed payload must not open the gate
        block(f"could not parse the hook payload ({exc}) — failing closed")

    if os.environ.get("DB_GUARD_CONFIRMED") == "1":
        allow("explicitly confirmed for this call (DB_GUARD_CONFIRMED=1)")
        return 0

    # Anything but an object is unreadable. Without this a payload like `[]`
    # raised on .get, exited 1, and exit 1 is a NON-blocking error.
    if not isinstance(payload, dict):
        block("the hook payload is not an object — failing closed")
    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        block("the tool input is not an object — failing closed")

    # The Neon MCP's own schema names it `branch_id` (additionalProperties:
    # false). A call carrying a second spelling is refused, so two keys can
    # never disagree about which branch the SQL runs on.
    if any(k in tool_input for k in ("branchId", "BranchId", "branch")):
        block("the call names its branch in a key the Neon MCP does not read — failing closed")
    branch = tool_input.get("branch_id")
    # EXACT match: the value checked is the value Neon receives.
    dev_branch = (
        isinstance(branch, str)
        and tool in DEV_BRANCH_WRITABLE
        and branch in db_targets.load()["neon_branch_ids"]
    )

    if tool in ALWAYS_BLOCK_TOOLS and not dev_branch:
        block(f"{tool} is destructive by identity, whatever it is passed")

    sql = tool_input.get("sql") or tool_input.get("query") or tool_input.get("sql_statements") or ""
    if isinstance(sql, list):  # run_sql_transaction passes a list
        sql = ";\n".join(str(s) for s in sql)

    # A BRIDGE TO ANOTHER DATABASE needs a human on EVERY branch. `SELECT
    # dblink_exec(...)` classifies as a read, so it was allowed on prod as
    # well as on a dev branch; and on a listed dev branch the extension and
    # the foreign server it needs would otherwise run unasked, which made the
    # "nothing relays to prod" claim in db_targets.py false (security review,
    # SCRUM-339). Checked before the read allowance for that reason.
    if RELAY_SQL.search(strip_sql_comments(str(sql)).lower()):
        block("extensions, foreign servers, dblink and server-side file access can reach beyond this database, so they need a human")

    decision, reason = classify(str(sql))
    if decision == "allow":
        allow(reason)
    elif dev_branch:
        if not str(sql).strip():
            block("empty or unreadable SQL on a dev branch — failing closed")
        allow(f"write on dev branch {branch}, listed in the dev-branch allowlist ({reason})")
    else:
        block(reason)
    return 0


if __name__ == "__main__":
    sys.exit(main())
