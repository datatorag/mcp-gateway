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
persist.
"""

import json
import os
import re
import sys

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

    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input") or {}

    if tool in ALWAYS_BLOCK_TOOLS:
        block(f"{tool} is destructive by identity, whatever it is passed")

    sql = tool_input.get("sql") or tool_input.get("query") or ""
    if isinstance(sql, list):  # run_sql_transaction passes a list
        sql = ";\n".join(str(s) for s in sql)

    decision, reason = classify(str(sql))
    if decision == "allow":
        allow(reason)
    else:
        block(reason)
    return 0


if __name__ == "__main__":
    sys.exit(main())
