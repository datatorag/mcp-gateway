#!/usr/bin/env node
/**
 * Advisory pre-push pattern check. INERT UNTIL WIRED.
 *
 * Nothing references this file. It runs only if someone adds the PreToolUse
 * entry documented in docs/architecture/pattern-check-hook-wiring.md to
 * .claude/settings.json. Checked in unwired on purpose, so the wiring is a
 * one-line decision rather than a build.
 *
 * CONTRACT, and every clause is load-bearing:
 *
 *   IT NEVER BLOCKS. Always exits 0. It prints findings and gets out of the
 *   way. A quality check that can stop a push spends the credibility the
 *   SECURITY gate needs, and the first time it is wrong about something
 *   harmless people start bypassing both.
 *
 *   IT NEVER BLOCKS WHEN IT IS ITSELF BROKEN EITHER. pattern-check exits 2 when
 *   its own matchers have gone blind. That is worth shouting about, and it is
 *   still not a reason to stop a push -- "the quality checker crashed so you
 *   cannot ship" is precisely how a check gets deleted.
 *
 *   IT ONLY FIRES ON `git push`. A PreToolUse hook on Bash sees every command.
 *   Running on all of them would add latency to `ls`.
 *
 *   IT RUNS ONLY THE DETERMINISTIC HALF. No model, no tokens, ~0.5s. The
 *   judgement half stays invoked; see .claude/skills/pattern-review/SKILL.md.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

if (res.error) {
  process.stderr.write(`[pattern-check] could not run: ${res.error.message}\n`);
  process.exit(0);
}

// Exit 2 from pattern-check means the CHECK is broken, not the diff. Distinct
// message, because reporting it as "your code is fine" would be a false
// all-clear and reporting it as findings would send someone hunting a defect
// that is in the checker.
if (res.status === 2) {
  process.stderr.write(
    "[pattern-check] THE CHECK ITSELF IS BROKEN and reviewed nothing. Not blocking the push.\n" +
      (res.stderr || "") +
      "Fix scripts/pattern-check.mjs -- until then this hook is providing no coverage.\n"
  );
  process.exit(0);
}

if (res.status === 1) {
  process.stderr.write(
    "\n[pattern-check] Advisory findings on origin/main...HEAD. NOT blocking this push.\n\n" +
      (res.stdout || "") +
      "\nThese are mechanical only. For the reuse / source-of-truth / altitude / efficiency\n" +
      "half, invoke the pattern-review skill. The security gate is separate and still required.\n\n"
  );
}

process.exit(0);
