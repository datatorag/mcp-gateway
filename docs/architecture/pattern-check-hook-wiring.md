# Pattern-check hook — exact wiring, NOT applied

Companion to `decisions/2026-08-13-generated-code-quality-pass.md`. That decision
recommends automating **only** the deterministic half of the pattern review, and
recommends it sit beside the pre-push security gate rather than on commit or on
every edit. This file is the wiring, ready to apply once that is agreed.

**Nothing here is installed.** `.claude/settings.json` has no `hooks` key, and
`scripts/hooks/pattern-check-on-push.mjs` is referenced by nothing, so it never
runs. Applying this is one edit; reverting it is deleting that edit.

## Why a Claude Code hook and not a git hook

`.git/hooks/pre-commit` protects exactly one machine — git hooks are not copied
by clone, so it would not survive a fresh checkout, a second machine, a worktree
or a background agent, while reading to everyone like the repo is covered.
`.claude/settings.json` is checked in, so a hook declared there travels with the
repo. Prefer the guard that travels.

## The wiring

Add to `.claude/settings.json` (the file currently holds only `enabledPlugins`;
this adds a sibling key, it does not replace anything):

```json
{
  "enabledPlugins": {
    "interface-design@interface-design": true
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/scripts/hooks/pattern-check-on-push.mjs\""
          }
        ]
      }
    ]
  }
}
```

The hook fires on every `Bash` call and returns immediately unless the command
is a `git push` — the filter is in the script, because a matcher cannot inspect
the command string.

## What it does, and the three things it deliberately does not

- Runs `scripts/pattern-check.mjs` on `origin/main...HEAD` — the same range the
  security gate uses. ~0.5s, no model, no network.
- **It never blocks.** Always exits 0. Findings print to stderr as advisory
  notes. A quality check that can stop a push spends credibility the security
  gate needs, and the first time it is wrong about something harmless people
  start bypassing both.
- **It does not block when it is itself broken.** `pattern-check` exits 2 when
  its own matchers have gone blind; the hook reports that in distinct wording
  and still allows the push. Reporting a broken checker as "your code is fine"
  would be a false all-clear; refusing the push over it is how a check gets
  deleted.
- **It does not run the model half.** Reuse, source-of-truth, altitude and
  efficiency stay with the invoked `pattern-review` skill.

## Verifying it after you apply it

A hook that silently does nothing is indistinguishable from a hook that ran and
found nothing, so do not accept silence as proof it works. Prove both directions:

```bash
# 1. It fires and reports. Commit a file that breaks a rule, then push.
mkdir -p apps/gateway/src/app/api/__wiring
cat > apps/gateway/src/app/api/__wiring/route.ts <<'EOF'
import { NextResponse } from "next/server";
export const GET = async () => NextResponse.json({ ok: true });
EOF
git add apps/gateway/src/app/api/__wiring/route.ts
git commit -m "temp: prove the hook fires"
#   -> the next `git push` in-session must print [pattern-check] findings
#      naming session-route-wrapper, and must still go through.

# 2. Clean up, and confirm it goes quiet again.
git reset --hard HEAD~1
```

If step 1 prints nothing, the hook is not wired — check that
`$CLAUDE_PROJECT_DIR` resolves and that `.claude/settings.json` parses.

The script's own argument handling is testable without the harness:

```bash
echo '{"tool_input":{"command":"ls"}}'          | node scripts/hooks/pattern-check-on-push.mjs; echo $?  # 0, silent
echo '{"tool_input":{"command":"git push -u origin x"}}' | node scripts/hooks/pattern-check-on-push.mjs; echo $?  # 0, reports
echo 'not json'                                  | node scripts/hooks/pattern-check-on-push.mjs; echo $?  # 0, silent
```

**Tested so far:** the script's dispatch, its findings path, and its exit code,
by piping payloads directly (above). **Not tested:** the harness integration —
whether this Claude Code build passes `tool_input.command` in that shape and
honours the entry as written. That cannot be tested without wiring it, which is
the thing being held for approval. Treat the harness half as unverified until
step 1 above has actually printed.

## Removing it

Delete the `hooks` key. The script becomes inert again; nothing else references
it. No state, no cache, no install step.

## If a different option is chosen instead

- **On commit rather than on push:** same script, `PreToolUse` matcher `Bash`,
  and widen the regex in the script from `git push` to `git commit`. The
  argument against is in the decision doc: commits here are frequently
  work-in-progress, so it fires far more often for the same coverage.
- **On `Write|Edit`:** do not wire this script — it is diff-scoped and there is
  no diff yet at write time. That option needs a different tool, and the
  decision doc explains why it is the weakest of the four.
