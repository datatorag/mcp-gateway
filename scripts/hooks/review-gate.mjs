#!/usr/bin/env node
/**
 * The PR review gate: both repo review skills ran on the exact code that is
 * pushed, and no finding was left without an outcome.
 *
 * Wired in .claude/settings.json on four hook points, all of which pass this
 * script the hook's JSON on stdin:
 *
 *   PostToolUse Skill           a load of `pr-simplify` or `pr-review` notes,
 *                               for this session, which skill is running.
 *   PostToolUse ReportFindings  the findings report writes a RECORD: the skill
 *                               that ran, the tree of the work tree at that
 *                               moment, the branch, the time, and every
 *                               finding with its outcome.
 *   PreToolUse Bash             a push or `gh pr create` is refused unless the
 *                               records allow it; a command that posts the
 *                               `claude-review` status or touches the records
 *                               is refused always.
 *   PreToolUse Write|Edit       a file write into the records is refused.
 *   PostToolUse Bash            after a push the remote holds, this script
 *                               (never the session) posts the `claude-review`
 *                               commit status on the pushed sha.
 *
 * Verified on this Claude Code build (2026-11-20), headless, with every hook
 * logging its input: a Skill hook gets {"skill": "<name>"} when the skill is
 * LOADED (there is no event when its work finishes, which is why the record
 * is written by the findings report, not by the skill); a ReportFindings hook
 * gets the full findings with their outcomes; a Bash hook gets the command;
 * exit 2 blocks the call and its stderr reaches the model; and the same hooks
 * fire for a subagent's tool calls.
 *
 * Records live in <git common dir>/review-records/, outside every work tree,
 * shared by all worktrees of the clone. The session never writes them: only
 * this script, run by the harness.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILLS = ["pr-simplify", "pr-review"];
export const STATUS_CONTEXT = "claude-review";
/** Outcomes that close a finding. Anything else, or none, leaves it open. */
export const CLOSED = new Set(["fixed", "skipped", "no_change_needed"]);

/** Paths a PR may change and still pass without a review: content pages,
 * docs, and generated registry pairs. A rule by path, never a choice. */
export const EXEMPT_PATHS = [/^apps\/gateway\/content\//, /^docs\//, /^registry\/[^/]+\.sql$/];

/** Every changed path is exempt (and there is at least one). */
export function isExempt(files) {
  return files.length > 0 && files.every((f) => EXEMPT_PATHS.some((re) => re.test(f)));
}

/** What a Bash command does, for the gate. */
export function classifyCommand(command) {
  const c = String(command ?? "");
  if (/review-records/.test(c)) return "records";
  if (/statuses\//.test(c) && /claude-review/.test(c)) return "status";
  if (/(^|[\s;&|(])git\s+(-C\s+\S+\s+)?push\b/.test(c) || /push(-force)?\.sh\b/.test(c) || /\bgh\s+pr\s+(create|ready)\b/.test(c)) {
    return "push";
  }
  return "other";
}

/** The directory a push command acts on: the worktree a push script names,
 * a `git -C <dir> push`, the last `cd <dir>` ahead of the push, or the hook's
 * own cwd. */
export function pushDir(command, cwd) {
  const script = /push(?:-force)?\.sh\s+("?)([^\s"]+)\1/.exec(command);
  if (script) return script[2];
  const dashC = /git\s+-C\s+("?)([^\s"]+)\1\s+push\b/.exec(command);
  if (dashC) return dashC[2];
  const at = command.search(/git\s+push\b|gh\s+pr\s+(?:create|ready)\b/);
  const before = at >= 0 ? command.slice(0, at) : command;
  const cds = [...before.matchAll(/(?:^|[;&|]\s*)cd\s+("?)([^\s"&;|]+)\1/g)];
  if (cds.length > 0) return cds.at(-1)[2];
  return cwd;
}

const openCount = (findings) => findings.filter((f) => !CLOSED.has(f?.outcome)).length;

/**
 * Whether the pushed tree may go: a pr-review record whose tree is the
 * pushed tree with no open finding, and a pr-simplify record on this branch
 * with no open finding. Returns { ok, reasons }.
 */
export function evaluate({ records, tree, branch, changedFiles }) {
  if (isExempt(changedFiles)) return { ok: true, exempt: true, reasons: [] };
  const mine = records.filter((r) => r.branch === branch);
  const reasons = [];
  const review = mine.filter((r) => r.skill === "pr-review" && r.tree === tree);
  if (review.length === 0) {
    const any = mine.some((r) => r.skill === "pr-review");
    reasons.push(
      any
        ? "the last pr-review ran on a different tree than the one being pushed: a commit after the review needs a re-review of what changed since"
        : "no pr-review has run on this branch"
    );
  } else if (openCount(review.at(-1).findings) > 0) {
    reasons.push(`pr-review left ${openCount(review.at(-1).findings)} finding(s) without an outcome`);
  }
  const simplify = mine.filter((r) => r.skill === "pr-simplify");
  if (simplify.length === 0) reasons.push("no pr-simplify has run on this branch");
  else if (openCount(simplify.at(-1).findings) > 0) {
    reasons.push(`pr-simplify left ${openCount(simplify.at(-1).findings)} finding(s) without an outcome`);
  }
  return { ok: reasons.length === 0, exempt: false, reasons };
}

// ----- git and file plumbing -------------------------------------------

const git = (dir, args, env) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "ignore"] }).trim();

export function recordsDir(dir) {
  const common = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return join(common, "review-records");
}

const safe = (s) => s.replace(/[^A-Za-z0-9._-]/g, "_");

export function readRecords(dir, branch) {
  const file = join(recordsDir(dir), `${safe(branch)}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

/** The tree of the work tree as it is now, untracked files included and
 * ignored ones not, built in a throwaway index so nothing is staged. */
export function workTree(dir) {
  const tmp = mkdtempSync(join(tmpdir(), "review-gate-"));
  const env = { GIT_INDEX_FILE: join(tmp, "index") };
  try {
    git(dir, ["read-tree", "HEAD"], env);
    git(dir, ["add", "-A"], env);
    return git(dir, ["write-tree"], env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The files this branch changes against the REMOTE's main, read with
 * ls-remote: a local origin/main ref is the session's to move, and a moved
 * base could make a code branch look like a docs-only one. With no answer
 * from the remote, nothing counts as exempt. */
function changedFiles(dir) {
  try {
    const main = git(dir, ["ls-remote", "origin", "refs/heads/main"]).split(/\s/)[0];
    if (!/^[0-9a-f]{40}$/.test(main)) return [];
    git(dir, ["cat-file", "-e", `${main}^{commit}`]);
    return git(dir, ["diff", "--name-only", `${main}...HEAD`]).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** owner/repo of the origin remote, the one ls-remote checked. */
export function originRepo(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

function sessionFile(dir, sessionId) {
  return join(recordsDir(dir), `session-${safe(sessionId ?? "unknown")}.json`);
}

// ----- the hook entry points ---------------------------------------------

function deny(reason) {
  process.stderr.write(`Blocked by the PR review gate: ${reason}\n`);
  process.exit(2);
}

function onSkillLoaded(input) {
  const skill = input.tool_input?.skill;
  if (!SKILLS.includes(skill)) return;
  const dir = input.cwd;
  mkdirSync(recordsDir(dir), { recursive: true });
  writeFileSync(sessionFile(dir, input.session_id), JSON.stringify({ skill, at: new Date().toISOString() }));
}

function onFindingsReported(input) {
  const dir = input.cwd;
  const file = sessionFile(dir, input.session_id);
  if (!existsSync(file)) return; // A findings report outside the two skills writes nothing.
  const { skill } = JSON.parse(readFileSync(file, "utf8"));
  rmSync(file, { force: true });
  const findings = (input.tool_input?.findings ?? []).map((f) => ({
    file: f.file,
    summary: f.summary,
    outcome: f.outcome ?? null,
  }));
  const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const record = {
    skill,
    branch,
    tree: workTree(dir),
    head: git(dir, ["rev-parse", "HEAD"]),
    at: new Date().toISOString(),
    session_id: input.session_id ?? null,
    findings,
    open: openCount(findings),
  };
  appendFileSync(join(recordsDir(dir), `${safe(branch)}.jsonl`), `${JSON.stringify(record)}\n`);
}

function gateFor(dir) {
  const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const tree = git(dir, ["rev-parse", "HEAD^{tree}"]);
  return { branch, ...evaluate({ records: readRecords(dir, branch), tree, branch, changedFiles: changedFiles(dir) }) };
}

function beforeBash(input) {
  const command = input.tool_input?.command ?? "";
  const kind = classifyCommand(command);
  if (kind === "records") deny("the review records are written by the harness, never by a command.");
  if (kind === "status") deny(`the ${STATUS_CONTEXT} status is posted by the gate after a push, never by hand.`);
  if (kind !== "push") return;
  const dir = pushDir(command, input.cwd);
  let result;
  try {
    result = gateFor(dir);
  } catch (err) {
    // A push the gate could not check does not pass.
    deny(`it could not check the push from ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!result.ok) {
    deny(`${result.reasons.join("; ")}. Run the pr-simplify and pr-review skills on this branch, close every finding, and push the tree they reviewed.`);
  }
}

function beforeWrite(input) {
  const path = String(input.tool_input?.file_path ?? "");
  if (path.includes("review-records")) deny("the review records are written by the harness, never by a tool.");
}

function afterBash(input) {
  const command = input.tool_input?.command ?? "";
  if (classifyCommand(command) !== "push") return;
  const dir = pushDir(command, input.cwd);
  const result = gateFor(dir);
  if (!result.ok) return;
  const head = git(dir, ["rev-parse", "HEAD"]);
  let remote = "";
  try {
    remote = git(dir, ["ls-remote", "origin", `refs/heads/${result.branch}`]).split(/\s/)[0];
  } catch {
    return;
  }
  if (remote !== head) return; // The push did not land; nothing to vouch for.
  // The repo the status goes to is origin's, the remote just checked.
  const repo = originRepo(git(dir, ["remote", "get-url", "origin"]));
  if (!repo) return;
  execFileSync(
    "gh",
    [
      "api",
      `repos/${repo}/statuses/${head}`,
      "-f", "state=success",
      "-f", `context=${STATUS_CONTEXT}`,
      "-f", `description=${result.exempt ? "exempt by path: content, docs, or registry pair" : "pr-simplify and pr-review ran on this tree"}`,
    ],
    { cwd: dir, stdio: "ignore" }
  );
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const event = input.hook_event_name;
  const tool = input.tool_name;
  if (event === "PostToolUse" && tool === "Skill") return onSkillLoaded(input);
  if (event === "PostToolUse" && tool === "ReportFindings") return onFindingsReported(input);
  if (event === "PreToolUse" && tool === "Bash") return beforeBash(input);
  if (event === "PreToolUse" && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) return beforeWrite(input);
  if (event === "PostToolUse" && tool === "Bash") return afterBash(input);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    // Anything but a push (whose check fails closed above) is never blocked
    // by the gate breaking; it says so and lets the call through.
    process.stderr.write(`PR review gate: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
