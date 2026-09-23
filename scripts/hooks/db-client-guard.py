#!/usr/bin/env python3
"""PreToolUse gate on Bash: no direct database clients (SCRUM-339).

`db-guard.py` classifies SQL sent through the Neon MCP and blocks writes until
a human approves them. It cannot see SQL sent any other way. On 2026-09-22 it
blocked a pre-approved UPDATE, and the session then ran the same statement
through psql instead. The statement had been approved; the route had not. A
guard that can be walked round by changing client is not a guard, so this one
closes the other clients.

DEV DATABASES GO THROUGH THE NEON MCP TOO (Manuel, SCRUM-339 amendment).
The guards are for production, and dev databases are there to be meddled
with, but a client allowed against a "dev" target can relay to prod from
inside itself (psql's \\connect and \\! in -c, a -f script, a subprocess in
driver code), which no text check can see. The security review showed each.
So dev writes go through `run_sql` with a dev `branch_id`, which db-guard.py
allows for branches a human listed in ~/.config/datatorag/db-dev-targets.json
(see db_targets.py): the MCP runs the SQL on that branch itself. No psql
is needed for any database, dev or prod; that is what the Neon MCP is for.

WHAT IT BLOCKS, by COMMAND POSITION, never by substring:
  - the Postgres command-line tools (psql, pgcli, usql, pg_dump, pg_restore,
    pg_dumpall, pgbench, createdb, dropdb, postgres, ...) as the command word
    of any segment: at any path; behind assignments, redirects, sudo, env,
    exec, nohup, time, timeout, nice, ionice, setsid, watch, xargs, script -c,
    find -exec, busybox; after shell keywords ({ ! if then do ...); on any
    line of a multi-line command; inside bash -c, eval, ssh's remote command,
    docker / docker compose / kubectl exec and run, $( ), backticks, process
    substitution, pipelines, git aliases, and heredocs a shell reads;
  - drizzle-kit push, drop and generate --custom, however a package runner
    reaches it, and the db:push package script that IS drizzle-kit push;
  - prisma db push and prisma db execute;
  - node, tsx, bun and deno code (-e, -p, --eval, deno eval, a heredoc) that
    loads a Postgres driver, or -r/--require of one; python, perl and ruby
    code (-c, -e, -m) that names a Postgres driver or client;
  - a command word that is itself an expansion ($X, $(...)), and an alias
    whose value is a client: the program they run cannot be read from the
    text, so it is refused rather than guessed;
  - a Postgres URL carrying credentials anywhere, and any Postgres URL or
    DATABASE_URL reference outside heredoc prose. A connection string in a
    command is also a transcript leak.

"psql" as an ARGUMENT is not a client: `grep psql README.md` and
`git log --grep psql` pass. That is the reason for parsing rather than
matching text.

Journaled migrations run through `pnpm --filter @datatorag-mcp/db db:migrate`
(drizzle-kit migrate), which is not a client this blocks.

DESIGN RULES, the same as db-guard.py's:
  1. FAIL CLOSED. A command or payload this cannot read is blocked, and any
     unexpected error blocks.
  2. BLOCK WITH EXIT 2. A JSON "ask" is overridden in a bypass session, and
     any other non-zero exit is a non-blocking error that lets the call run.
  3. NO ESCAPE HATCH. The answer to a block is to stop and report the exact
     SQL to a human, not to find a third way.

WHAT IT CANNOT SEE: the body of a script FILE the command runs, code whose
text is assembled at run time (`require('p'+'g')`, base64 piped to a shell),
and code piped into an interpreter's stdin from another program. It reads
the command text, as every PreToolUse hook does; those are for review.
"""

# Annotations stay unevaluated, so an interpreter older than 3.10 cannot fail
# at import with exit 1, which would let the call run.
from __future__ import annotations

import json
import re
import shlex
import sys

CLIENTS = {
    "psql", "pgcli", "usql", "pg_dump", "pg_restore", "pg_dumpall", "pgbench",
    "createdb", "dropdb", "createuser", "dropuser", "postgres", "pg_ctl",
    "vacuumdb", "reindexdb", "clusterdb", "pg_upgrade", "pg_basebackup",
}
# Words that come before the real command word and are skipped over.
PREFIX_WORDS = {
    "sudo", "env", "command", "exec", "nohup", "time", "nice", "ionice", "setsid",
    "builtin", "stdbuf", "xargs", "watch", "busybox", "doas", "chronic", "unbuffer",
}
KEYWORDS = {"{", "}", "!", "if", "then", "else", "elif", "fi", "do", "done", "while",
            "until", "for", "in", "case", "esac", "coproc", "function", "select"}
PREFIX_VALUE_FLAGS = {
    "sudo": {"-u", "-g", "-C", "-D", "-R", "-T", "-U", "-p", "-h", "--user", "--group"},
    "env": {"-u", "-C", "-S", "--unset", "--chdir"},
    "xargs": {"-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a"},
    "nice": {"-n"},
    "ionice": {"-c", "-n", "-p"},
    "stdbuf": {"-i", "-o", "-e"},
    "exec": {"-a"},
    "watch": {"-n", "-d"},
}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "fish", "ash", "script"}
JS_RUNNERS = {"node", "tsx", "bun", "deno", "ts-node", "nodejs"}
SCRIPT_RUNNERS = {"python", "python3", "python2", "perl", "ruby", "php"}
PACKAGE_RUNNERS = {"pnpm", "npm", "yarn", "bun", "turbo", "npx", "pnpx", "bunx", "uvx", "pipx", "uv"}
CONTAINER_TOOLS = {"docker", "podman", "kubectl", "docker-compose", "nerdctl", "oc"}
DB_PACKAGES = re.compile(r"""(['"`]|npm:)(pg|postgres|@neondatabase/serverless|drizzle-orm(/[\w-]+)*|pg-promise|slonik|knex)(['"`@/]|$)""")
JS_DRIVER_NAMES = {"pg", "postgres", "@neondatabase/serverless", "drizzle-orm", "pg-promise", "slonik", "knex"}
SCRIPT_DB_WORDS = re.compile(r"\b(psycopg2?|psycopg_pool|asyncpg|pg8000|pgcli|DBI:Pg|DBD::Pg|PG::Connection|pg_connect)\b|\b(" + "|".join(sorted(CLIENTS)) + r")\b")
CRED_URL = re.compile(r"postgres(ql)?://[^\s/@'\"]*:[^\s/@'\"]*@", re.I)
URL = re.compile(r"postgres(ql)?://", re.I)
DB_URL_REF = re.compile(r"\$\{?!?DATABASE_URL\b")
DRIZZLE_WRITES = {"push", "drop"}

MESSAGE = (
    "DB CLIENT GUARD — BLOCKED: {reason}\n"
    "Direct database clients are blocked. Reads and writes go through the Neon MCP "
    "(run_sql), where db-guard classifies them; dev writes use run_sql with a dev branch_id "
    "a human has listed. A blocked guard means stop and report "
    "the exact SQL to a human; never a different client. Journaled migrations run only "
    "via `pnpm --filter @datatorag-mcp/db db:migrate` from the repo root.\n"
)


class Blocked(Exception):
    pass


def base(word: str) -> str:
    return word.rsplit("/", 1)[-1]


def strip_heredocs(command: str) -> tuple[str, list[tuple[str, str]]]:
    """Remove heredoc bodies, returning the command and (opening line, body)
    pairs. A body is prose or data far more often than a script, and prose with
    an apostrophe would make every such command unparseable, so a body is
    scanned only when the command reading it is an interpreter."""
    lines = command.split("\n")
    out: list[str] = []
    bodies: list[tuple[str, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        delims = re.findall(r"<<-?\s*(['\"]?)([A-Za-z_][\w]*)\1", line)
        i += 1
        for _q, delim in delims:
            body: list[str] = []
            while i < len(lines) and lines[i].strip() != delim:
                body.append(lines[i])
                i += 1
            i += 1  # the delimiter line
            bodies.append((line, "\n".join(body)))
    return "\n".join(out), bodies


def normalise(text: str) -> str:
    """Newlines and comments, the way bash reads them.

    shlex treats a newline as whitespace, so a second line joined the first
    line's arguments and never reached command position; and it treats a `#`
    in the middle of a word as a comment, which bash does not. Outside quotes,
    a newline becomes `;` and a `#` starting a word drops the rest of the
    line. Inside quotes both are left alone."""
    out: list[str] = []
    quote: str | None = None
    i = 0
    while i < len(text):
        c = text[i]
        if quote:
            out.append(c)
            if c == "\\" and quote == '"' and i + 1 < len(text):
                out.append(text[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
        elif c == "\\" and i + 1 < len(text):
            if text[i + 1] == "\n":
                i += 2  # a line continuation joins the lines
                continue
            out.append(c)
            out.append(text[i + 1])
            i += 2
            continue
        elif c in "'\"":
            quote = c
            out.append(c)
        elif c == "\n":
            out.append(" ; ")
        elif c == "#" and (i == 0 or text[i - 1] in " \t;&|()\n"):
            while i < len(text) and text[i] != "\n":
                i += 1
            continue
        else:
            out.append(c)
        i += 1
    return "".join(out)


def substitutions(text: str) -> list[str]:
    """The contents of $( ), <( ), >( ) and backticks, which run as commands."""
    found = re.findall(r"`([^`]*)`", text)
    depth, start = 0, None
    i = 0
    while i < len(text):
        opener = text[i : i + 2]
        if opener in ("$(", "<(", ">(") and not text.startswith("$((", i):
            if depth == 0:
                start = i + 2
            depth += 1
            i += 2
            continue
        if text[i] == "(" and depth > 0:
            depth += 1
        elif text[i] == ")" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                found.append(text[start:i])
                start = None
        i += 1
    return found


def segments(text: str) -> list[list[str]]:
    lexer = shlex.shlex(normalise(text), posix=True, punctuation_chars=";&|()<>")
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        tokens = list(lexer)
    except ValueError as exc:
        raise Blocked(f"the command could not be parsed ({exc}), so it cannot be checked") from exc
    segs: list[list[str]] = []
    cur: list[str] = []
    skip_next = False
    for n, tok in enumerate(tokens):
        if skip_next:
            skip_next = False
            continue
        is_punct = tok != "" and set(tok) <= set(";&|()<>")
        if is_punct and ("<" in tok or ">" in tok):
            if tok.endswith("("):
                # Process substitution: its body is scanned by `substitutions`,
                # and here it only ends the segment.
                if cur:
                    segs.append(cur)
                cur = []
                continue
            # A redirect: drop it, the fd number before it, and its target
            # (a file, a here-string, a heredoc delimiter, or an fd after >&).
            if cur and cur[-1].isdigit():
                cur.pop()
            skip_next = True
            continue
        if is_punct:
            if cur:
                segs.append(cur)
            cur = []
        else:
            cur.append(tok)
    if cur:
        segs.append(cur)
    return segs


def strip_prefix(argv: list[str]) -> list[str]:
    """The segment from its real command word on."""
    i = 0
    while i < len(argv):
        w = argv[i]
        if re.match(r"^[A-Za-z_][\w]*=", w):
            i += 1
            continue
        if w in KEYWORDS:
            i += 1
            continue
        b = base(w)
        if b in PREFIX_WORDS:
            i += 1
            while i < len(argv) and argv[i].startswith("-"):
                flag = argv[i]
                i += 1
                if flag in PREFIX_VALUE_FLAGS.get(b, set()) and i < len(argv):
                    i += 1
            continue
        if b == "timeout":
            i += 1
            while i < len(argv) and argv[i].startswith("-"):
                flag = argv[i]
                i += 1
                if flag in {"-s", "--signal", "-k", "--kill-after"} and i < len(argv):
                    i += 1
            if i < len(argv) and re.match(r"^\d", argv[i]):
                i += 1
            continue
        break
    return argv[i:]


def first_tool(args: list[str], names: set[str]) -> int:
    """Index of the first argument naming one of `names`, or -1."""
    for j, a in enumerate(args):
        if base(a) in names:
            return j
    return -1


def check_segment(argv: list[str], depth: int) -> None:
    argv = strip_prefix(argv)
    if not argv:
        return
    word = argv[0]
    cmd, args = base(word), argv[1:]

    if word.startswith("$") or word.startswith("`"):
        raise Blocked("the command word is an expansion, so the program it runs cannot be checked")

    if cmd in CLIENTS:
        raise Blocked(f"{cmd} is a direct database client")

    if cmd == "alias":
        for a in args:
            value = a.split("=", 1)[1] if "=" in a else ""
            if value:
                scan(value, depth + 1)
        return

    if cmd in SHELLS or cmd == "eval":
        if cmd == "eval":
            scan(" ".join(args), depth + 1)
            return
        for j, a in enumerate(args):
            if a.startswith("-") and not a.startswith("--") and "c" in a[1:]:
                scan(args[j + 1] if j + 1 < len(args) else "", depth + 1)
                return
        return

    if cmd == "find":
        for j, a in enumerate(args):
            if a in {"-exec", "-execdir", "-ok", "-okdir"}:
                rest = []
                for b in args[j + 1 :]:
                    if b in {";", "+", "\\;"}:
                        break
                    rest.append(b)
                check_segment(rest, depth + 1)
        return

    if cmd == "git":
        for a in args:
            m = re.match(r"^alias\.[^=]+=!(.*)$", a)
            if m:
                scan(m.group(1), depth + 1)
        return

    if cmd == "ssh":
        j = 0
        takes_value = set("bcDEeFIiJLlmOopQRSWw")
        while j < len(args):
            a = args[j]
            if a == "--":
                j += 1
                continue
            if a.startswith("-") and len(a) >= 2:
                j += 2 if (len(a) == 2 and a[1] in takes_value) else 1
                continue
            break
        remote = [a for a in args[j + 1 :] if a != "--"]
        if remote:
            scan(" ".join(remote), depth + 1)
        return

    if cmd in CONTAINER_TOOLS:
        # Everything after exec/run is the container's command, somewhere past
        # the flags and the container or image name. Rather than model every
        # tool's flags, the first word naming something this guard checks is
        # taken as the start of it.
        if any(a in {"exec", "run"} for a in args):
            k = first_tool(args, CLIENTS | SHELLS | JS_RUNNERS | SCRIPT_RUNNERS | {"drizzle-kit", "prisma", "eval"})
            if k != -1:
                check_segment(args[k:], depth + 1)
        return

    if cmd in PACKAGE_RUNNERS:
        # The package script that IS drizzle-kit push, reached by its name.
        if any(re.match(r"^([\w@/.-]+#)?db:push(:|$)", a) for a in args):
            raise Blocked("db:push is drizzle-kit push, which changes a database outside the migration journal")
        k = first_tool(args, CLIENTS | JS_RUNNERS | SCRIPT_RUNNERS | {"drizzle-kit", "prisma"})
        if k != -1:
            check_segment(args[k:], depth + 1)
        return

    if cmd == "drizzle-kit":
        if any(a in DRIZZLE_WRITES or a.startswith("push:") or a.startswith("drop:") for a in args):
            raise Blocked("drizzle-kit push or drop changes a database outside the migration journal")
        if any(a.startswith("generate") for a in args) and "--custom" in args:
            raise Blocked("drizzle-kit generate --custom writes SQL outside the reviewed schema")
        return

    if cmd == "prisma" and "db" in args and any(a in {"push", "execute"} for a in args):
        raise Blocked("prisma db push or execute changes a database directly")

    if cmd in JS_RUNNERS:
        for j, a in enumerate(args):
            nxt = args[j + 1] if j + 1 < len(args) else ""
            if a in {"-r", "--require", "--import"} and base(nxt.split("/")[0]) in JS_DRIVER_NAMES | {"drizzle-orm"}:
                raise Blocked(f"{cmd} preloads a database driver")
            joined = re.match(r"^(-[a-z]*[ep][a-z]*|--eval|--print)(=?)(.*)$", a)
            code = None
            if a == "eval" and cmd == "deno":
                code = nxt
            elif joined and (a.startswith("--") or re.match(r"^-[a-z]+$", a) or joined.group(3)):
                code = joined.group(3) if joined.group(3) else nxt
            if code and DB_PACKAGES.search(code):
                raise Blocked(f"{cmd} code that loads a database driver is a direct client")
        return

    if cmd in SCRIPT_RUNNERS:
        for j, a in enumerate(args):
            nxt = args[j + 1] if j + 1 < len(args) else ""
            if a in {"-c", "-e", "-E", "-r"} and SCRIPT_DB_WORDS.search(nxt):
                raise Blocked(f"{cmd} code that names a database client or driver is a direct client")
            if a == "-m" and base(nxt) in CLIENTS | {"psycopg", "psycopg2", "asyncpg"}:
                raise Blocked(f"{cmd} -m {nxt} is a direct database client")
        return

    if cmd == "printenv" and "DATABASE_URL" in args:
        raise Blocked("printing DATABASE_URL puts the connection string in the transcript")


def interpreter_of(line: str) -> str | None:
    """The interpreter a heredoc opened on this line feeds, if any."""
    try:
        segs = segments(line.split("<<", 1)[0])
    except Blocked:
        return None
    for seg in segs[-1:]:
        argv = strip_prefix(seg)
        if not argv:
            continue
        cmd = base(argv[0])
        if cmd in SHELLS | {"ssh"} | CONTAINER_TOOLS:
            return "shell"
        if cmd in JS_RUNNERS:
            return "js"
        if cmd in SCRIPT_RUNNERS:
            return "script"
    return None


def scan(text: str, depth: int = 0) -> None:
    if depth > 8:
        raise Blocked("the command nests too deeply to check")
    # The dev-branch allowlist decides what db-guard lets write, so a session
    # must not touch it. Quotes and backslashes are dropped first so a split
    # name reads as bash reads it. BEST EFFORT: a name assembled at run time
    # gets past any text check; the file lives outside the repo and the
    # editing tools refuse it by path, and that is the real line.
    unquoted = re.sub(r"[\\'\"]", "", text)
    if "db-dev-targets" in unquoted or re.search(r"\.config/datatorag\b", unquoted):
        raise Blocked("the dev-branch allowlist decides what db-guard lets write, so only a human edits or reads it")
    if CRED_URL.search(text):
        raise Blocked("the command carries a Postgres connection string with credentials")

    stripped, bodies = strip_heredocs(text)
    if URL.search(stripped):
        raise Blocked("the command carries a Postgres connection string")
    if DB_URL_REF.search(stripped):
        raise Blocked("the command references DATABASE_URL")
    if "${!" in stripped:
        # Indirect expansion names its variable at run time, so what it
        # prints, DATABASE_URL included, cannot be read from the text.
        raise Blocked("the command uses an indirect ${!...} expansion, which cannot be checked")

    for inner in substitutions(stripped):
        scan(inner, depth + 1)
    for seg in segments(stripped):
        check_segment(seg, depth)

    # A heredoc fed to an interpreter is code; fed to anything else it is data.
    for line, body in bodies:
        kind = interpreter_of(line)
        if kind == "shell":
            scan(body, depth + 1)
        elif kind == "js" and DB_PACKAGES.search(body):
            raise Blocked("a heredoc fed to a JavaScript runtime loads a database driver")
        elif kind == "script" and SCRIPT_DB_WORDS.search(body):
            raise Blocked("a heredoc fed to an interpreter names a database client or driver")


def decide(command: str) -> str | None:
    """None to allow, or the reason to block. Any error blocks."""
    try:
        scan(command)
    except Blocked as b:
        return str(b)
    except Exception as exc:  # noqa: BLE001 - fail closed on anything unexpected
        return f"the command could not be checked ({type(exc).__name__}), so it is refused"
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("the payload is not an object")
        if payload.get("tool_name") != "Bash":
            return 0
        tool_input = payload.get("tool_input")
        command = tool_input.get("command") if isinstance(tool_input, dict) else None
        if not isinstance(command, str):
            raise ValueError("the Bash call carries no command string")
        reason = decide(command)
    except Exception as exc:  # noqa: BLE001 - a malformed payload must not open the gate
        reason = f"could not read the hook payload ({exc})"
    if reason is None:
        return 0
    sys.stderr.write(MESSAGE.format(reason=reason))
    return 2


if __name__ == "__main__":
    sys.exit(main())
