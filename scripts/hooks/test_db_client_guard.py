"""The direct-database-client guard (SCRUM-339).

Run: python3 -m unittest scripts/hooks/test_db_client_guard.py

Two lists, and the second matters as much as the first: a guard that blocks
ordinary work gets deleted by whoever it blocks. The must-pass list therefore
includes the shapes this session actually runs (heredoc commit messages with
apostrophes in them, greps for the word psql, the migration task).
"""

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("db_client_guard", HERE / "db-client-guard.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

MUST_BLOCK = [
    # the clients, plainly and at a path
    "psql --version",
    "/usr/bin/psql -c 'select 1'",
    "/opt/homebrew/opt/libpq/bin/psql",
    "pgcli",
    "pg_dump -Fc -f out.dump",
    "pg_restore -d x out.dump",
    "pg_dumpall",
    "pgbench -i",
    # behind wrappers and assignments
    "command psql",
    "PGPASSWORD=x psql -h h -U u",
    "sudo -u postgres psql",
    "env PGHOST=h psql",
    "timeout 30 psql",
    "nohup pg_dump > x &",
    "xargs psql",
    # inside other commands
    "ssh host 'psql -c \"select 1\"'",
    "ssh -i key.pem ubuntu@1.2.3.4 'cd x && psql'",
    "docker exec db psql -U postgres",
    "docker exec -it -e X=1 db psql",
    "kubectl exec -n ns pod -- psql",
    "echo 'select 1' | psql",
    "cat q.sql | /usr/bin/psql",
    "bash -c 'psql -c x'",
    "sh -c \"pg_dump x\"",
    "eval psql",
    "echo $(psql -c 'select 1')",
    "echo `pg_dump`",
    "cd apps && psql",
    "true || psql",
    "bash <<'EOF'\npsql -c 'select 1'\nEOF",
    # drizzle-kit outside the journal
    "drizzle-kit push",
    "pnpm exec drizzle-kit push",
    "npx drizzle-kit drop",
    "pnpm dlx drizzle-kit push --force",
    "drizzle-kit generate --custom --name x",
    "pnpm db:push",
    "pnpm --filter @datatorag-mcp/db db:push",
    "npm run db:push",
    "turbo run db:push",
    # prisma
    "prisma db push",
    "npx prisma db execute --file x.sql",
    # driver one-liners
    "node -e \"require('pg')\"",
    "node --eval 'import(\"postgres\")'",
    "tsx -e \"import { neon } from '@neondatabase/serverless'\"",
    "node -p \"require('drizzle-orm/node-postgres')\"",
    # connection strings, anywhere
    "curl -d 'postgres://u:p@h/db' x",
    "DATABASE_URL=postgresql://u:p@h/db pnpm test",
    "echo $DATABASE_URL",
    "node script.js ${DATABASE_URL}",
    # fail closed
    "echo 'unterminated",
    # --- found by the security review of the first version ---
    # newlines and mid-word '#' (both HIGH: a second line never reached
    # command position, and shlex dropped the rest of a line after a#b)
    "git status\npsql -c 'update t set x=1'",
    "echo x\npsql",
    "cd /tmp\n/usr/bin/psql",
    "echo a#b; psql",
    "curl https://x.test/#top && psql -c 'x'",
    # dynamic command words and aliases
    "X=psql; $X -c x",
    "$(echo psql) -c x",
    "$(which psql) -c 1",
    "alias q=psql; q",
    "f() { psql; }; f",
    # keywords and redirects in front of the command word
    "{ psql; }",
    "if true; then psql; fi",
    "for i in 1; do psql; done",
    "! psql",
    "coproc psql",
    ">out psql",
    "2>&1 psql",
    "<in psql",
    "psql<<<\"select 1\"",
    # wrappers that take values, or were missing
    "exec -a foo psql",
    "timeout -s KILL 5 psql",
    "timeout --signal KILL 5 psql",
    "ionice psql",
    "setsid psql",
    "watch psql",
    "find . -exec psql {} ;",
    "busybox sh -c psql",
    "fish -c psql",
    "script -c psql",
    "git -c alias.x='!psql' x",
    # containers and ssh
    "docker compose exec db psql",
    "docker-compose exec postgres psql",
    "docker run --rm -it --network host postgres:16 psql",
    "kubectl exec -it pod -c c -- psql",
    "ssh host -- psql",
    "docker exec -i db sh <<'X'\npsql\nX",
    # package runners reaching drizzle-kit
    "pnpm drizzle-kit push",
    "pnpm run drizzle-kit push",
    "yarn drizzle-kit push",
    "pnpm --filter @datatorag-mcp/db exec drizzle-kit push",
    "pnpm -F db exec drizzle-kit push",
    "npx -p drizzle-kit drizzle-kit push",
    "drizzle-kit --config x push",
    "pnpm db:push:force",
    "pnpm exec tsx -e \"import('pg')\"",
    # JS forms
    "node -pe \"require('pg')\"",
    "node -e\"require('pg')\"",
    "node -r pg -e 1",
    "node - <<'E'\nrequire('pg')\nE",
    "deno eval \"import 'npm:pg'\"",
    # other interpreters and clients
    "python3 -c \"import psycopg2\"",
    "perl -e 'exec \"psql\"'",
    "python3 -m pgcli",
    "uvx pgcli",
    "usql pg://u@h/d",
    "createdb x",
    "dropdb x",
    "postgres --single",
    "printenv DATABASE_URL",
    "x=DATABASE_URL; echo ${!x}",
    # a credential-bearing URL is refused even in heredoc prose
    "cat > f <<'E'\npostgres://user:secret@host/db\nE",
]

# NOT CAUGHT, and stated rather than hidden. Each needs the program's own
# text or its run-time state, which a PreToolUse hook does not have:
#   node -e "require('p'+'g')"            (assembled at run time)
#   echo cHNxbA== | base64 -d | sh        (encoded, then piped to a shell)
#   printf psql | sh, echo "require('pg')" | node   (code on stdin)
#   bash script.sh                        (a script file's body)
#   cat .env                              (a file that holds the string)

MUST_PASS = [
    "pnpm --filter @datatorag-mcp/db db:migrate",
    # The seed is a scripted write against whatever the local .env names, not
    # ad hoc SQL, so it is allowed like the migration task (HQ, SCRUM-339).
    "pnpm db:seed",
    "pnpm --filter @datatorag-mcp/db db:seed",
    "grep psql README.md",
    "grep -rn 'psql' apps/gateway/src",
    "git log --grep psql",
    "cat scripts/psql-notes.md",
    "sed -n 1,20p docs/pg_dump.md",
    "git status --short",
    "pnpm vitest run",
    "cd apps/gateway && pnpm exec tsc --noEmit",
    "pnpm exec drizzle-kit migrate",
    "drizzle-kit generate",
    "pnpm --filter @datatorag-mcp/db db:generate",
    "node -e \"console.log(1)\"",
    "grep -n DATABASE_URL .env.example",
    "echo 'the word psql in prose'",
    # heredoc prose with apostrophes, fed to git, is data
    "git commit -q -F - <<'EOF'\nfix: it's the case's own fault, don't psql\n\nbody\nEOF",
    "python3 - <<'EOF'\nprint(\"don't\")\nEOF",
    "cat > f.md <<'EOF'\nrun psql -c 'x' by hand, it's fine\nEOF",
    # prose may NAME the scheme and the variable, as docs and commit
    # messages do; the review found the first version refused them
    "git commit -q -F - <<'EOF'\na postgres:// URL and $DATABASE_URL are blocked\nEOF",
    "git commit -m \"it's fine\"",
    "gh pr create --title x --body \"we don't psql\"",
    "echo '#not a comment'; ls",
    "grep -n '#' file",
    "docker logs psql-container",
    "docker ps",
]


class Decide(unittest.TestCase):
    def test_blocks(self):
        for command in MUST_BLOCK:
            with self.subTest(command=command):
                self.assertIsNotNone(guard.decide(command), f"should block: {command!r}")

    def test_passes(self):
        for command in MUST_PASS:
            with self.subTest(command=command):
                self.assertIsNone(guard.decide(command), f"should pass: {command!r} ({guard.decide(command)})")


class Hook(unittest.TestCase):
    """The script end to end, as the harness runs it: exit 2 and the message
    on stderr for a block, exit 0 and silence for a pass."""

    def run_hook(self, payload):
        return subprocess.run(
            [sys.executable, str(HERE / "db-client-guard.py")],
            input=json.dumps(payload) if not isinstance(payload, str) else payload,
            capture_output=True,
            text=True,
        )

    def test_block_exits_2_with_the_rule(self):
        r = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "psql --version"}})
        self.assertEqual(r.returncode, 2)
        self.assertIn("A blocked guard means stop and report the exact SQL to a human", r.stderr)
        self.assertIn("never a different client", r.stderr)

    def test_pass_exits_0(self):
        r = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "git status"}})
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stderr, "")

    def test_malformed_payload_fails_closed(self):
        # Exit 1 would be a NON-blocking error and let the call run, so every
        # unreadable payload has to come back as exactly 2.
        for bad in ["not json", "", "null", "[]", '"x"', '{"tool_name":"Bash","tool_input":"x"}',
                    '{"tool_name":"Bash","tool_input":null}', '{"tool_name":"Bash","tool_input":{"command":5}}']:
            with self.subTest(payload=bad):
                self.assertEqual(self.run_hook(bad).returncode, 2)

    def test_no_escape_hatch(self):
        # db-guard honours DB_GUARD_CONFIRMED; this hook must not.
        import os

        env = {**os.environ, "DB_GUARD_CONFIRMED": "1", "DB_CLIENT_GUARD_CONFIRMED": "1"}
        r = subprocess.run(
            [sys.executable, str(HERE / "db-client-guard.py")],
            input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "psql"}}),
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
