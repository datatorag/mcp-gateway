import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCommand, evaluate, isExempt, originRepo, pushDir, recordsDir } from "./review-gate.mjs";

const SCRIPT = fileURLToPath(new URL("./review-gate.mjs", import.meta.url));

// ----- the decisions -------------------------------------------------------

test("a push, a PR create, and the push scripts are pushes; status posts and record edits are refused kinds", () => {
  assert.equal(classifyCommand("git push -u origin HEAD"), "push");
  assert.equal(classifyCommand("cd /w && git push --force-with-lease origin HEAD:b"), "push");
  assert.equal(classifyCommand("bash /tmp/s/push.sh /w"), "push");
  assert.equal(classifyCommand("bash /tmp/s/push-force.sh /w b"), "push");
  assert.equal(classifyCommand("gh pr create --base main --title x"), "push");
  assert.equal(classifyCommand("gh api repos/o/r/statuses/abc -f context=claude-review -f state=success"), "status");
  assert.equal(classifyCommand("echo x >> .git/review-records/b.jsonl"), "records");
  assert.equal(classifyCommand("git status"), "other");
  assert.equal(classifyCommand("git pushx"), "other");
  assert.equal(classifyCommand("git -C /w push origin HEAD"), "push");
});

test("the directory a push acts on: the script's argument, a cd ahead of it, or the cwd", () => {
  assert.equal(pushDir("bash /s/push.sh /w/a 2>&1 | tail -1", "/cwd"), "/w/a");
  assert.equal(pushDir("cd /w/b && git push -u origin HEAD", "/cwd"), "/w/b");
  assert.equal(pushDir("git push", "/cwd"), "/cwd");
  assert.equal(pushDir("git -C /w/c push origin HEAD", "/cwd"), "/w/c");
  assert.equal(pushDir("cd /w/a && true && cd /w/b && git push", "/cwd"), "/w/b");
});

test("the status goes to origin's repo, read from its URL", () => {
  assert.equal(originRepo("https://github.com/acme/widgets.git"), "acme/widgets");
  assert.equal(originRepo("git@github.com:acme/widgets.git"), "acme/widgets");
  assert.equal(originRepo("/local/path"), null);
});

test("exempt only when every changed path is content, docs, or a registry pair", () => {
  assert.equal(isExempt(["apps/gateway/content/docs/notion.md", "registry/x.sql", "docs/a.md"]), true);
  assert.equal(isExempt(["registry/x.sql", "plugins/notion-mcp/src/a.ts"]), false);
  assert.equal(isExempt([]), false);
});

const rec = (skill, tree, findings = [], branch = "b") => ({ skill, tree, branch, findings });

test("a review of the pushed tree and a simplify, both closed, pass", () => {
  const r = evaluate({ records: [rec("pr-simplify", "t0"), rec("pr-review", "t1", [{ outcome: "fixed" }])], tree: "t1", branch: "b", changedFiles: ["a.ts"] });
  assert.deepEqual(r, { ok: true, exempt: false, reasons: [] });
});

test("a stale tree, an open finding, or a missing simplify fails, each named", () => {
  const stale = evaluate({ records: [rec("pr-simplify", "t0"), rec("pr-review", "t1")], tree: "t2", branch: "b", changedFiles: ["a.ts"] });
  assert.equal(stale.ok, false);
  assert.match(stale.reasons[0], /different tree/);
  const open = evaluate({ records: [rec("pr-simplify", "t0"), rec("pr-review", "t1", [{ outcome: "fixed" }, {}])], tree: "t1", branch: "b", changedFiles: ["a.ts"] });
  assert.match(open.reasons[0], /1 finding\(s\) without an outcome/);
  const noSimplify = evaluate({ records: [rec("pr-review", "t1")], tree: "t1", branch: "b", changedFiles: ["a.ts"] });
  assert.match(noSimplify.reasons.join(" "), /no pr-simplify/);
  const otherBranch = evaluate({ records: [rec("pr-simplify", "t0", [], "x"), rec("pr-review", "t1", [], "x")], tree: "t1", branch: "b", changedFiles: ["a.ts"] });
  assert.equal(otherBranch.ok, false);
});

// ----- the script, end to end, on a throwaway repo ---------------------------

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "review-gate-test-"));
  const g = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "feature");
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  g("add", "a.ts");
  g("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init");
  return { dir, g, done: () => rmSync(dir, { recursive: true, force: true }) };
}

function hook(dir, event, tool, toolInput, session = "s1") {
  const input = JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: toolInput, cwd: dir, session_id: session });
  return spawnSync("node", [SCRIPT], { input, encoding: "utf8" });
}

function runSkill(dir, skill, findings) {
  assert.equal(hook(dir, "PostToolUse", "Skill", { skill }).status, 0);
  assert.equal(hook(dir, "PostToolUse", "ReportFindings", { findings }).status, 0);
}

const push = (dir) => hook(dir, "PreToolUse", "Bash", { command: "git push -u origin HEAD" });

test("the harness writes a record for each skill's findings report, and a matching record lets the push through", () => {
  const { dir, done } = repo();
  try {
    runSkill(dir, "pr-simplify", []);
    runSkill(dir, "pr-review", [{ file: "a.ts", summary: "x", failure_scenario: "y", outcome: "fixed" }]);
    const lines = readFileSync(join(recordsDir(dir), "feature.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.skill), ["pr-simplify", "pr-review"]);
    assert.equal(lines[1].open, 0);
    assert.equal(push(dir).status, 0);
  } finally {
    done();
  }
});

test("a commit after the review makes the record stale, and the push is refused", () => {
  const { dir, g, done } = repo();
  try {
    runSkill(dir, "pr-simplify", []);
    runSkill(dir, "pr-review", []);
    writeFileSync(join(dir, "a.ts"), "export const a = 2;\n");
    g("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qam", "after");
    const res = push(dir);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /different tree/);
  } finally {
    done();
  }
});

test("a review run before the commit counts for the commit of exactly that work", () => {
  const { dir, g, done } = repo();
  try {
    writeFileSync(join(dir, "b.ts"), "export const b = 1;\n");
    runSkill(dir, "pr-simplify", []);
    runSkill(dir, "pr-review", []);
    g("add", "b.ts");
    g("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "b");
    assert.equal(push(dir).status, 0);
  } finally {
    done();
  }
});

test("an open finding, or a missing simplify, refuses the push", () => {
  const { dir, done } = repo();
  try {
    runSkill(dir, "pr-review", [{ file: "a.ts", summary: "x", failure_scenario: "y" }]);
    const res = push(dir);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /without an outcome/);
    assert.match(res.stderr, /no pr-simplify/);
  } finally {
    done();
  }
});

test("a findings report outside the two skills writes no record", () => {
  const { dir, done } = repo();
  try {
    assert.equal(hook(dir, "PostToolUse", "Skill", { skill: "simplify" }).status, 0);
    assert.equal(hook(dir, "PostToolUse", "ReportFindings", { findings: [] }).status, 0);
    const res = push(dir);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /no pr-review/);
  } finally {
    done();
  }
});

test("posting the claude-review status by hand, and writing the records, are refused", () => {
  const { dir, done } = repo();
  try {
    const status = hook(dir, "PreToolUse", "Bash", { command: "gh api repos/o/r/statuses/abc -f state=success -f context=claude-review" });
    assert.equal(status.status, 2);
    assert.match(status.stderr, /posted by the gate/);
    const bash = hook(dir, "PreToolUse", "Bash", { command: `echo '{}' >> ${recordsDir(dir)}/feature.jsonl` });
    assert.equal(bash.status, 2);
    const write = hook(dir, "PreToolUse", "Write", { file_path: join(recordsDir(dir), "feature.jsonl"), content: "{}" });
    assert.equal(write.status, 2);
    assert.equal(hook(dir, "PreToolUse", "Bash", { command: "git status" }).status, 0);
  } finally {
    done();
  }
});
