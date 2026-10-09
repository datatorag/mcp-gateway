// Tests of the registry change-file generator and the tool-file helpers
// (SCRUM-390). Run with: node --test scripts/registry-diff.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { changeFiles, chooseToolFile, diffTools, FIXTURES, jsonbText, md5, selfTest, sqlString } from "./registry-diff.mjs";
import { compareToolFiles, toToolFile } from "./plugin-tools.mjs";

const tool = (name, over = {}) => ({
  name,
  description: `Describes ${name}.`,
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  readOnlyHint: true,
  ...over,
});
const file = (...tools) => ({ tools });
const A = "a".repeat(40);
const B = "b".repeat(40);

test("the self-test passes, and its fixtures are real ground truth", () => {
  assert.deepEqual(selfTest(), []);
  assert.ok(FIXTURES.length >= 5);
  // Known-bad: compact JSON is NOT what Postgres prints, for every fixture.
  for (const f of FIXTURES) assert.notEqual(md5(JSON.stringify(f.inputSchema)), f.schemaMd5, f.name);
});

test("jsonbText orders keys by length then bytes, whatever order they arrive in", () => {
  const one = jsonbText({ required: ["a"], type: "object", properties: { b: 1, a: 2 } });
  const two = jsonbText({ properties: { a: 2, b: 1 }, type: "object", required: ["a"] });
  assert.equal(one, two);
  assert.equal(one, '{"type": "object", "required": ["a"], "properties": {"a": 2, "b": 1}}');
});

test("jsonbText refuses what it cannot render exactly, instead of guessing", () => {
  assert.throws(() => jsonbText({ n: 1.5 }), /cannot render exactly/);
  assert.throws(() => jsonbText("a\u0000b"), /NUL/);
  assert.throws(() => jsonbText(undefined), /not a JSON value/);
});

test("no change means no file", () => {
  const diff = diffTools(file(tool("a"), tool("b")), file(tool("b"), tool("a")));
  assert.deepEqual([diff.changed, diff.added, diff.removed], [[], [], []]);
  assert.equal(changeFiles("some-plugin", A, B, diff), null);
});

test("a schema whose keys only moved is not a change", () => {
  const moved = tool("a", { inputSchema: { required: ["id"], properties: { id: { type: "string" } }, type: "object" } });
  assert.equal(diffTools(file(tool("a")), file(moved)).changed.length, 0);
});

test("a changed description is one guarded UPDATE, and the rollback is its mirror", () => {
  const before = tool("a");
  const after = tool("a", { description: "It's new." });
  const diff = diffTools(file(before, tool("b")), file(after, tool("b")));
  assert.deepEqual(diff.changed.map((c) => [c.name, c.fields]), [["a", ["description"]]]);
  const { forward, rollback } = changeFiles("some-plugin", A, B, diff);

  assert.match(forward, /PROPOSAL: NOT RUN/);
  assert.match(rollback, /PROPOSAL: NOT RUN/);
  assert.equal(forward.match(/UPDATE tools/g).length, 1);
  assert.ok(forward.includes("description = 'It''s new.'"), "the quote is doubled");
  assert.ok(forward.includes("updated_at = now()"));
  // Forward is guarded by the OLD row, rollback by the NEW one.
  assert.ok(forward.includes(`md5(t.description) = '${md5(before.description)}'`));
  assert.ok(rollback.includes(`md5(t.description) = '${md5(after.description)}'`));
  assert.ok(forward.includes(`md5(t.input_schema_json::text) = '${md5(jsonbText(before.inputSchema))}'`));
  assert.ok(rollback.includes("description = 'Describes a.'"));
  // One transaction, and the row count for the plugin is asserted.
  for (const sql of [forward, rollback]) {
    assert.equal(sql.match(/^BEGIN;$/gm).length, 1);
    assert.equal(sql.match(/^COMMIT;$/gm).length, 1);
    assert.match(sql, /expected 2, found %/);
    assert.match(sql, /expected 1 row, updated %/);
  }
  // The untouched tool is not mentioned in a statement.
  assert.ok(!forward.includes("t.name = 'b'"));
});

test("a new tool is an INSERT forward and a guarded DELETE back; a removed tool the reverse", () => {
  const diff = diffTools(file(tool("keep"), tool("gone")), file(tool("keep"), tool("fresh", { readOnlyHint: null })));
  assert.deepEqual([diff.added.map((t) => t.name), diff.removed.map((t) => t.name)], [["fresh"], ["gone"]]);
  const { forward, rollback } = changeFiles("some-plugin", A, B, diff);
  assert.ok(forward.includes("'fresh', 'some-plugin__fresh'"));
  assert.ok(forward.includes("NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'some-plugin__fresh')"));
  assert.match(forward, /\n    NULL\n/, "an absent hint is NULL, not false");
  assert.match(forward, /DELETE FROM tools t USING mcp_servers s\n  WHERE .* t\.name = 'gone'/);
  assert.match(rollback, /DELETE FROM tools t USING mcp_servers s\n  WHERE .* t\.name = 'fresh'/);
  assert.ok(rollback.includes("'gone', 'some-plugin__gone'"));
  assert.match(rollback, /A re-inserted row is a NEW row/);
});

test("a changed read-only hint is a change, guarded by the old hint", () => {
  const diff = diffTools(file(tool("a")), file(tool("a", { readOnlyHint: false })));
  assert.deepEqual(diff.changed[0].fields, ["read_only_hint"]);
  const { forward } = changeFiles("some-plugin", A, B, diff);
  assert.ok(forward.includes("read_only_hint = false"));
  assert.ok(forward.includes("t.read_only_hint IS NOT DISTINCT FROM true"));
});

test("a malformed tool file is refused", () => {
  assert.throws(() => diffTools({ tools: [] }, file(tool("a"))), /lists no tools/);
  assert.throws(() => diffTools(file(tool("a"), tool("a")), file(tool("a"))), /listed twice/);
  assert.throws(() => diffTools(file(tool("a'; DROP")), file(tool("a"))), /not a plain name/);
  assert.throws(() => diffTools(file(tool("a", { description: null })), file(tool("a"))), /no description/);
  assert.throws(() => changeFiles("Bad Slug", A, B, diffTools(file(tool("a")), file(tool("b")))), /not a plugin slug/);
});

test("nothing a tool file holds can end a SQL string early", () => {
  const nasty = tool("a", { description: "x'); DELETE FROM tools; --", inputSchema: { type: "object", description: "it's" } });
  const { forward } = changeFiles("some-plugin", A, B, diffTools(file(tool("a")), file(nasty)));
  assert.ok(forward.includes("'x''); DELETE FROM tools; --'"));
  assert.ok(forward.includes(`'{"type":"object","description":"it''s"}'::jsonb`));
  assert.equal(sqlString("a'b'c"), "'a''b''c'");
});

test("a tool file is sorted by name and keeps only what a registry row is made from", () => {
  const made = toToolFile([
    { name: "b", description: "B", inputSchema: { type: "object" }, annotations: { readOnlyHint: true, title: "T" }, extra: 1 },
    { name: "a", inputSchema: { type: "object" } },
  ]);
  assert.deepEqual(made, {
    tools: [
      { name: "a", description: null, inputSchema: { type: "object" }, readOnlyHint: null },
      { name: "b", description: "B", inputSchema: { type: "object" }, readOnlyHint: true },
    ],
  });
  assert.throws(() => toToolFile([{ name: "a" }, { name: "a" }]), /twice/);
});

test("comparing two tool files names every difference, tool by tool", () => {
  const one = file(tool("a"), tool("b"), tool("c"));
  const two = file(tool("a", { description: "changed" }), tool("c", { readOnlyHint: false }), tool("d"));
  assert.deepEqual(compareToolFiles(one, one), []);
  assert.deepEqual(compareToolFiles(one, two), [
    "a: description differs",
    "b: only in the first",
    "c: readOnlyHint differs",
    "d: only in the second",
  ]);
});

/* The block that holds every statement is dollar-quoted. Text from a tool
 * file sits inside it, so that text must not be able to end it. Known-bad: a
 * bare `$$` as the tag, which a description containing `$$` closes. */
test("a $$ in a description or a schema cannot end the statement block", () => {
  const nasty = tool("a", {
    description: "x $$; ROLLBACK; DELETE FROM users; --",
    inputSchema: { type: "object", description: "also $$ here; DROP TABLE tools; --" },
  });
  for (const sql of Object.values(changeFiles("some-plugin", A, B, diffTools(file(tool("a")), file(nasty))))) {
    const open = sql.match(/^DO (\$[a-z_]+\$)$/m);
    assert.ok(open, "the block is opened with a named tag");
    const tag = open[1];
    assert.notEqual(tag, "$$");
    // The tag appears exactly twice: where the block opens and where it ends.
    assert.equal(sql.split(tag).length - 1, 2);
    const body = sql.slice(sql.indexOf(tag) + tag.length, sql.lastIndexOf(tag));
    assert.ok(body.includes("DELETE FROM users") || body.includes("Describes a."), "the tool's text is inside the block");
    // Nothing of the tool's text is left after the block ends.
    assert.ok(!sql.slice(sql.lastIndexOf(tag)).includes("DELETE FROM users"));
    assert.ok(!sql.slice(sql.lastIndexOf(tag)).includes("DROP TABLE"));
  }
});

test("a tool whose text contains the block's own tag is refused, not written", () => {
  const nasty = tool("a", { description: "ends it: $registry_change$; DELETE FROM users;" });
  assert.throws(() => changeFiles("some-plugin", A, B, diffTools(file(tool("a")), file(nasty))), /would end the statement block early/);
  const inSchema = tool("a", { inputSchema: { type: "object", title: "$registry_change$" } });
  assert.throws(() => changeFiles("some-plugin", A, B, diffTools(file(tool("a")), file(inSchema))), /would end the statement block early/);
});

test("every file pins how strings are read, inside its own transaction", () => {
  const { forward, rollback } = changeFiles("some-plugin", A, B, diffTools(file(tool("a")), file(tool("a", { description: "new" }))));
  for (const sql of [forward, rollback]) assert.match(sql, /^BEGIN;\nSET LOCAL standard_conforming_strings = on;$/m);
});

/* Which build records are believed. The record that must NOT win: one from a
 * run at a commit that is not on main, where the workflow can be edited. */
const REPO = process.env.GITHUB_REPOSITORY ?? "datatorag/mcp-gateway";
const LINE = `gateway ${A} sha256:${"1".repeat(64)}`;
const good = (over = {}) => ({
  runPath: ".github/workflows/build.yml",
  event: "push",
  repo: REPO,
  headOnMain: true,
  line: LINE,
  toolText: JSON.stringify(file(tool("a"))),
  ...over,
});
const forged = JSON.stringify(file(tool("a", { description: "forged" })));

test("a tool file is taken from a build record on main, and from no other", () => {
  assert.deepEqual(chooseToolFile([good()], LINE, "p", A), file(tool("a")));
  assert.deepEqual(chooseToolFile([good({ event: "workflow_dispatch" })], LINE, "p", A), file(tool("a")));
  const refused = [
    ["a run at a commit that is not on main", { headOnMain: false }],
    ["a pull request run", { event: "pull_request" }],
    ["another workflow", { runPath: ".github/workflows/other.yml" }],
    ["a fork", { repo: "someone/fork" }],
    ["a record for another image", { line: `gateway ${A} sha256:${"2".repeat(64)}` }],
  ];
  for (const [what, over] of refused) {
    assert.throws(() => chooseToolFile([good({ ...over, toolText: forged })], LINE, "p", A), /no build record on main/, what);
    // Beside an honest record, the other one is ignored, not chosen.
    assert.deepEqual(chooseToolFile([good({ ...over, toolText: forged }), good()], LINE, "p", A), file(tool("a")), what);
  }
});

test("two believed records that disagree are refused; a record with no tool file says why", () => {
  assert.throws(() => chooseToolFile([good(), good({ toolText: forged })], LINE, "p", A), /different tool files/);
  // The same file with its keys in another order is not a disagreement.
  assert.deepEqual(chooseToolFile([good(), good({ event: "workflow_dispatch" })], LINE, "p", A), file(tool("a")));
  assert.throws(() => chooseToolFile([good({ toolText: null })], LINE, "p", A), /built before tool files were kept/);
});

