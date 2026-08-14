#!/usr/bin/env node
/**
 * Advisory pre-push pattern check.
 *
 * Wired as a PreToolUse hook on Bash in .claude/settings.json; see
 * docs/architecture/pattern-check-hook-wiring.md.
 *
 * IT WRITES ITS REPORT TO A FILE, AND THAT IS NOT BELT-AND-BRACES. Measured on
 * this Claude Code build: a PreToolUse hook that exits 0 has NO channel that
 * reaches the agent. Its stderr is not surfaced in the tool result, and neither
 * `systemMessage` nor an "allow" decision's `permissionDecisionReason` showed up
 * either -- all three were probed directly. The only reliably model-visible
 * PreToolUse channel is exit code 2, which BLOCKS, and blocking is the one
 * thing this hook must never do.
 *
 * So stderr alone would have made this decoration: a check that runs correctly,
 * finds real things, and tells nobody. Writing the report to <git-dir> makes the
 * finding durable and greppable regardless of what any given build chooses to
 * surface, and it is what the ship ritual and the pattern-review skill read.
 *
 * CONTRACT, and every clause is load-bearing:
 *
 *   IT NEVER BLOCKS. Always exits 0. A quality check that can stop a push
 *   spends the credibility the SECURITY gate needs, and the first time it is
 *   wrong about something harmless people start bypassing both.
 *
 *   IT NEVER BLOCKS WHEN IT IS ITSELF BROKEN EITHER. pattern-check exits 2 when
 *   its own matchers or boundaries have gone wrong. That is worth shouting
 *   about, and it is still not a reason to stop a push -- "the quality checker
 *   crashed so you cannot ship" is precisely how a check gets deleted.
 *
 *   IT ONLY FIRES ON `git push`. A PreToolUse hook on Bash sees every command.
 *   Running on all of them would add latency to `ls`.
 *
 *   IT RUNS ONLY THE DETERMINISTIC HALF. No model, no tokens. The judgement
 *   half stays invoked; see .claude/skills/pattern-review/SKILL.md.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the durable report goes: inside the git dir, so it can never be
 *  committed by accident and never needs a .gitignore entry. Resolved THROUGH
 *  git rather than assumed to be `<root>/.git` -- in a worktree `.git` is a
 *  FILE pointing elsewhere, and this repo is developed in worktrees. */
function reportPath() {
  try {
    const dir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    return join(isAbsolute(dir) ? dir : join(REPO_ROOT, dir), "pattern-check-last.txt");
  } catch {
    return null;
  }
}

function persist(text) {
  const p = reportPath();
  if (!p) return;
  try {
    writeFileSync(p, text);
  } catch {
    // A report we cannot write is not a reason to interfere with the push.
  }
}

function readStdin() {
  try {
    return execFileSync("cat", [], { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

let payload = {};
try {
  payload = JSON.parse(readStdin() || "{}");
} catch {
  // A hook that cannot parse its input must not guess. Say nothing, allow.
  process.exit(0);
}

const command = payload?.tool_input?.command ?? "";

// `git push`, allowing flags and remotes between. Not a security boundary --
// anyone wanting to skip it can, and that is fine; this is a reminder, not a
// gate.
if (!/\bgit\b[^\n|;&]*\bpush\b/.test(command)) process.exit(0);

const res = spawnSync("node", [join(REPO_ROOT, "scripts", "pattern-check.mjs")], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});

const stamp = new Date().toISOString();

if (res.error) {
  const msg = `[pattern-check] ${stamp}\ncould not run: ${res.error.message}\n`;
  process.stderr.write(msg);
  persist(msg);
  process.exit(0);
}

// Exit 2 from pattern-check means the CHECK is broken, not the diff. Distinct
// wording, because reporting it as "your code is fine" would be a false
// all-clear and reporting it as findings would send someone hunting a defect
// that is in the checker.
if (res.status === 2) {
  const msg =
    `[pattern-check] ${stamp}\n` +
    "THE CHECK ITSELF IS BROKEN and reviewed nothing. Not blocking the push.\n" +
    (res.stderr || "") +
    "Fix scripts/pattern-check.mjs -- until then this hook is providing no coverage.\n";
  process.stderr.write(msg);
  persist(msg);
  process.exit(0);
}

if (res.status === 1) {
  const msg =
    `[pattern-check] ${stamp}\n` +
    "Advisory findings on origin/main...HEAD. NOT blocking this push.\n\n" +
    (res.stdout || "") +
    "\nThese are mechanical only. For the reuse / source-of-truth / altitude / efficiency\n" +
    "half, invoke the pattern-review skill. The security gate is separate and still required.\n";
  process.stderr.write(msg);
  persist(msg);
  process.exit(0);
}

// CLEAN IS WRITTEN TOO, and overwriting matters more than the message does. A
// report file updated only when something is found goes stale the moment the
// finding is fixed, and the next reader sees a resolved finding presented as
// current -- with a timestamp making it look freshly observed.
persist(`[pattern-check] ${stamp}\n${res.stdout || "no mechanical findings.\n"}`);
process.exit(0);
