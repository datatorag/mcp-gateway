# Pattern-check hook — wiring, and what it was verified to do

Companion to `decisions/2026-08-13-generated-code-quality-pass.md`. That decision
automates **only** the deterministic half of the pattern review, advisory and
non-blocking, beside the pre-push security gate rather than on commit or on
every edit.

**This is applied.** `.claude/settings.json` carries the `hooks` key below.
Reverting it is deleting that key; the script then goes inert, since nothing
else references it.

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

## Where the findings actually appear

**Read `<git-dir>/pattern-check-last.txt`.** `git rev-parse --git-dir` resolves
it, which matters because this repo is developed in worktrees where `.git` is a
file rather than a directory.

That file is not a convenience. Measured on this build: **a `PreToolUse` hook
that exits 0 surfaces nothing to the agent** — stderr is not shown in the tool
result, and neither `systemMessage` nor an `allow` decision's
`permissionDecisionReason` appeared either. All three were probed directly. The
only reliably model-visible channel is exit code 2, which blocks, and blocking
is the one thing this hook must never do. Without the file the hook would run
correctly, find real things, and tell nobody.

The file is rewritten on **every** push, including clean ones, so a finding that
has since been fixed cannot sit there looking current under a fresh timestamp.

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

**Verified end to end, wired**, on 2026-08-13:

- The harness fires the hook on `git push` and passes `tool_input.command` in
  exactly the shape the script reads — confirmed by capturing the raw payload.
- Hooks take effect **without a session restart**; confirmed with a marker file
  rather than assumed.
- A planted `route.ts` without `withRoute` produced the expected advisory report
  in `<git-dir>/pattern-check-last.txt`, and **the push was not blocked**.
- Removing the planted file and pushing again overwrote the report with a clean
  one, so a stale finding cannot linger.
- Non-push commands, malformed JSON and empty stdin all exit 0 silently.

Use `git push --dry-run` for this: it triggers `PreToolUse` without pushing.

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
