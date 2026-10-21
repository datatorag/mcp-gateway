// Tests of the registry change-file generator and the tool-file helpers
// (SCRUM-390). Run with: node --test scripts/registry-diff.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { baseToolFile, changeFiles, chooseBaseToolFile, chooseToolFile, diffTools, FIXTURES, jsonbText, md5, selfTest, serverRow, sqlString } from "./registry-diff.mjs";
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
  assert.throws(() => changeFiles("some-plugin", `${A}\nDROP TABLE tools;`, B, diffTools(file(tool("a")), file(tool("b")))), /full 40-character sha/);
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
  // Two records holding the same text agree.
  assert.deepEqual(chooseToolFile([good(), good({ event: "workflow_dispatch" })], LINE, "p", A), file(tool("a")));
  assert.throws(() => chooseToolFile([good({ toolText: null })], LINE, "p", A), /built before tool files were kept/);
});


/* A NEW plugin (SCRUM-366). The base commit's build record holds no tool file
 * for the slug. That is read as an empty tool set ONLY when the plugin's
 * directory did not exist at the base commit; the two other ways a tool file
 * can be missing still refuse. */
const kept = (over = {}) => good({ keptToolFiles: true, ...over });

test("a base with no tool file for a plugin that did not exist at that commit is an empty tool set", () => {
  assert.equal(chooseBaseToolFile([kept({ toolText: null })], LINE, "p", A, false), null);
  // A plugin that did exist reads its tool file as before.
  assert.deepEqual(chooseBaseToolFile([kept()], LINE, "p", A, true), file(tool("a")));
});

test("a base record from before tool files were kept still refuses, even with no plugin directory", () => {
  assert.throws(() => chooseBaseToolFile([kept({ toolText: null, keptToolFiles: false })], LINE, "p", A, false), /built before tool files were kept/);
});

test("a plugin that existed at the base commit but has no tool file there still refuses", () => {
  assert.throws(() => chooseBaseToolFile([kept({ toolText: null })], LINE, "p", A, true), /p existed at a{40} but its build record holds no tool file for it/);
});

test("the base applies the same rule to which records are believed", () => {
  // A forged record with no tool file must not make a plugin look new.
  assert.throws(() => chooseBaseToolFile([kept({ toolText: null, headOnMain: false })], LINE, "p", A, false), /no build record on main/);
  assert.throws(() => chooseBaseToolFile([kept(), kept({ toolText: null })], LINE, "p", A, false), /different tool files/);
});

const MANIFEST = {
  name: "Some Plugin",
  description: "Some plugin: it's for tests",
  oauth: { provider: "some", scopes: [], clientIdEnv: "$SOME_CLIENT_ID" },
};
const PKG = { name: "@datatorag-mcp/some-plugin", description: "from package.json", license: "MIT" };
const ROW = serverRow("some-plugin", MANIFEST, PKG, "datatorag/mcp-gateway");

test("the server row of a new plugin comes from its manifest and package.json", () => {
  assert.deepEqual(ROW, {
    slug: "some-plugin",
    name: "Some Plugin",
    description: "Some plugin: it's for tests",
    githubRepoUrl: "https://github.com/datatorag/mcp-gateway/tree/main/plugins/some-plugin",
    githubRepoOwner: "datatorag",
    githubRepoName: "mcp-gateway",
    licenseSpdx: "MIT",
    manifest: MANIFEST,
    status: "active",
  });
  // The manager's own fallbacks: a description from package.json, no license.
  const bare = serverRow("some-plugin", { name: "X" }, { description: "pkg says" }, "datatorag/mcp-gateway");
  assert.equal(bare.description, "pkg says");
  assert.equal(bare.licenseSpdx, null);
  assert.equal(serverRow("some-plugin", { name: "X" }, {}, "datatorag/mcp-gateway").description, null);
});

test("a server row is refused when its sources cannot say what it is", () => {
  assert.throws(() => serverRow("some-plugin", null, PKG, "datatorag/mcp-gateway"), /datatorag\.json/);
  assert.throws(() => serverRow("some-plugin", { description: "no name" }, PKG, "datatorag/mcp-gateway"), /no name/);
  assert.throws(() => serverRow("some-plugin", MANIFEST, { license: 1 }, "datatorag/mcp-gateway"), /license/);
  assert.throws(() => serverRow("some-plugin", { name: "X", description: 3 }, PKG, "datatorag/mcp-gateway"), /description/);
  assert.throws(() => serverRow("some-plugin", MANIFEST, PKG, "not a repo"), /repository/);
  assert.throws(() => serverRow("Bad Slug", MANIFEST, PKG, "datatorag/mcp-gateway"), /not a plugin slug/);
  assert.throws(() => serverRow("some-plugin", { name: "X", n: 1.5 }, PKG, "datatorag/mcp-gateway"), /cannot render exactly/);
});

const NEW_TOOL = tool("read_it", { description: "Reads it." });
const NEW = changeFiles("some-plugin", A, B, diffTools(null, file(NEW_TOOL)), ROW);
const ROW_MD5 = md5(jsonbText([ROW.name, ROW.description, ROW.githubRepoUrl, ROW.githubRepoOwner, ROW.githubRepoName, ROW.licenseSpdx, ROW.manifest, ROW.status]));
const NEW_SCHEMA = `'{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}'::jsonb`;
const MANIFEST_SQL = `'{"name":"Some Plugin","description":"Some plugin: it''s for tests","oauth":{"provider":"some","scopes":[],"clientIdEnv":"$SOME_CLIENT_ID"}}'::jsonb`;

test("a new plugin's forward file: the server row first, then its tools, one transaction (golden)", () => {
  assert.equal(
    NEW.forward,
    `-- Registry change for some-plugin. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway ${A} (what is running) and ${B}.
-- A NEW plugin: some-plugin is not a directory under plugins/ at ${A}.
-- Its mcp_servers row is inserted first, from plugins/some-plugin/datatorag.json and package.json at ${B}:
--   name, description, the manifest as manifest_json, the license, a source link in this repository,
--   status active, and container_port the lowest port from 40000 that no mcp_servers row holds,
--   chosen by the statement itself. It raises if a row for some-plugin already exists.
-- 0 row(s) change, 1 added, 0 removed.
-- Rows for some-plugin: 0 before, 1 after.
--   adds read_it
-- Each statement is guarded by the md5 of the row's description and of input_schema_json::text
-- as the other commit's plugin served them. If the live row differs, the statement touches
-- nothing, the block raises and the transaction rolls back.
-- One transaction. Run by a person, on a confirmation that names the database. See the
-- SCRUM-390 spec for the order against the deploy.

BEGIN;
SET LOCAL standard_conforming_strings = on;
DO $registry_change$
DECLARE n int;
BEGIN
  -- some-plugin: a new plugin, its server row
  INSERT INTO mcp_servers (slug, name, description, github_repo_url, github_repo_owner, github_repo_name, license_spdx, manifest_json, status, container_port)
  SELECT 'some-plugin', 'Some Plugin',
    'Some plugin: it''s for tests',
    'https://github.com/datatorag/mcp-gateway/tree/main/plugins/some-plugin', 'datatorag', 'mcp-gateway',
    'MIT',
    ${MANIFEST_SQL},
    'active',
    (SELECT min(p.port) FROM generate_series(40000, 40999) AS p(port) WHERE NOT EXISTS (SELECT 1 FROM mcp_servers o WHERE o.container_port = p.port))
  WHERE NOT EXISTS (SELECT 1 FROM mcp_servers s WHERE s.slug = 'some-plugin');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers some-plugin: expected 1 row, inserted %', n; END IF;
  SELECT count(*) INTO n FROM mcp_servers s JOIN mcp_servers o ON o.container_port = s.container_port WHERE s.slug = 'some-plugin';
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers some-plugin: expected 1 row on its port, found %', n; END IF;

  -- read_it: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'read_it', 'some-plugin__read_it',
    'Reads it.',
    ${NEW_SCHEMA},
    true
  FROM mcp_servers s
  WHERE s.slug = 'some-plugin'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'some-plugin__read_it');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward read_it: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'some-plugin';
  IF n <> 1 THEN RAISE EXCEPTION 'rows for some-plugin: expected 1, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'some-plugin' AND t.name IN ('read_it');
COMMIT;
`
  );
});

test("a new plugin's rollback file: its tools go, then the server row, each guarded (golden)", () => {
  assert.equal(
    NEW.rollback,
    `-- ROLLBACK of the registry change for some-plugin. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway ${A} served, from what ${B} served.
-- A NEW plugin: the rollback deletes its tool rows and then its mcp_servers row, which is
-- guarded by the md5 of every column the forward file wrote except the port it chose, and
-- refuses while any tool, env var or plugin connection row still points at it, so the
-- foreign keys' cascade can never remove one.
-- 0 row(s) change, 1 added, 0 removed.
-- Rows for some-plugin: 0 before, 1 after.
--   deletes read_it
-- A re-inserted row is a NEW row: its id, enabled flag and counters are the table's defaults,
-- not what the deleted row had.
-- Each statement is guarded by the md5 of the row's description and of input_schema_json::text
-- as the other commit's plugin served them. If the live row differs, the statement touches
-- nothing, the block raises and the transaction rolls back.
-- One transaction. Run by a person, on a confirmation that names the database. See the
-- SCRUM-390 spec for the order against the deploy.

BEGIN;
SET LOCAL standard_conforming_strings = on;
DO $registry_change$
DECLARE n int;
BEGIN
  -- read_it: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'some-plugin' AND t.name = 'read_it'
    AND md5(t.description) = '${md5("Reads it.")}'
    AND md5(t.input_schema_json::text) = '${md5(jsonbText(NEW_TOOL.inputSchema))}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback read_it: expected 1 row, deleted %', n; END IF;

  -- some-plugin: the new plugin's server row goes
  DELETE FROM mcp_servers s
  WHERE s.slug = 'some-plugin'
    AND md5(jsonb_build_array(s.name, s.description, s.github_repo_url, s.github_repo_owner, s.github_repo_name, s.license_spdx, s.manifest_json, s.status)::text) = '${ROW_MD5}'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM mcp_server_env_vars e WHERE e.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM plugin_connections c WHERE c.mcp_server_id = s.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback mcp_servers some-plugin: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'some-plugin';
  IF n <> 0 THEN RAISE EXCEPTION 'rows for some-plugin: expected 0, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'some-plugin' AND t.name IN ('read_it');
COMMIT;
`
  );
});

test("the server row's guard is the md5 of the jsonb array Postgres prints, not of compact JSON", () => {
  const values = [ROW.name, ROW.description, ROW.githubRepoUrl, ROW.githubRepoOwner, ROW.githubRepoName, ROW.licenseSpdx, ROW.manifest, ROW.status];
  assert.ok(NEW.rollback.includes(`= '${md5(jsonbText(values))}'`));
  // Known-bad: the compact rendering is a different md5, so a guard built from it would never match.
  assert.notEqual(md5(JSON.stringify(values)), md5(jsonbText(values)));
  assert.ok(!NEW.rollback.includes(md5(JSON.stringify(values))));
  // A null description and license are JSON nulls in the array, not the string "null".
  const bare = serverRow("some-plugin", { name: "X" }, {}, "datatorag/mcp-gateway");
  const bareFiles = changeFiles("some-plugin", A, B, diffTools(null, file(NEW_TOOL)), bare);
  assert.ok(bareFiles.forward.includes("'https://github.com/datatorag/mcp-gateway/tree/main/plugins/some-plugin', 'datatorag', 'mcp-gateway',\n    NULL,\n"));
  assert.match(bareFiles.forward, /SELECT 'some-plugin', 'X',\n    NULL,\n/);
  assert.ok(bareFiles.rollback.includes(md5(jsonbText(["X", null, bare.githubRepoUrl, "datatorag", "mcp-gateway", null, { name: "X" }, "active"]))));
});

test("a server row only with a new plugin, and a new plugin only with a server row", () => {
  assert.throws(() => changeFiles("some-plugin", A, B, diffTools(null, file(NEW_TOOL))), /new plugin needs its server row/);
  assert.throws(() => changeFiles("some-plugin", A, B, diffTools(file(tool("a")), file(tool("a"), NEW_TOOL)), ROW), /only for a new plugin/);
  assert.throws(() => changeFiles("other-plugin", A, B, diffTools(null, file(NEW_TOOL)), ROW), /server row is for some-plugin/);
  assert.equal(diffTools(null, file(NEW_TOOL)).newPlugin, true);
  assert.equal(diffTools(file(tool("a")), file(tool("a"))).newPlugin, false);
  // An empty base is not something a tool FILE can say; only the absent-directory rule says it.
  assert.throws(() => diffTools({ tools: [] }, file(NEW_TOOL)), /lists no tools/);
});

test("the server row's text is inside the block too, so its own tag in a manifest is refused", () => {
  const nasty = serverRow("some-plugin", { name: "x $registry_change$ y" }, {}, "datatorag/mcp-gateway");
  assert.throws(() => changeFiles("some-plugin", A, B, diffTools(null, file(NEW_TOOL)), nasty), /would end the statement block early/);
});

/* --new-plugin (SCRUM-366): the base is forced empty whatever the base commit
 * holds, because a main image holding the plugin can be running before its
 * rows exist. The insert's NOT EXISTS guard on the slug is what makes forcing
 * safe; the one thing still refused is a --to with no plugin to add. */
const fakeGit = (dirs) => (sha, slug) => dirs.includes(`${sha}:${slug}`);
const noFetch = () => {
  throw new Error("the base commit's records must not be read under --new-plugin");
};

test("--new-plugin forces an empty base without reading the base commit's records", () => {
  // The base commit holds the plugin AND a tool file for it; neither matters.
  assert.equal(baseToolFile({ forced: true, slug: "p", from: A, to: B, pluginDirAt: fakeGit([`${A}:p`, `${B}:p`]), fetchBase: noFetch }), null);
});

test("--new-plugin refuses when the --to commit has no plugin directory", () => {
  assert.throws(
    () => baseToolFile({ forced: true, slug: "p", from: A, to: B, pluginDirAt: fakeGit([`${A}:p`]), fetchBase: noFetch }),
    /--new-plugin: b{40} has no plugins\/p/
  );
});

test("without --new-plugin the automatic rule decides, from the base commit's records", () => {
  let asked = null;
  const fetchBase = (slug, sha) => ((asked = [slug, sha]), file(tool("a")));
  assert.deepEqual(baseToolFile({ forced: false, slug: "p", from: A, to: B, pluginDirAt: fakeGit([]), fetchBase }), file(tool("a")));
  assert.deepEqual(asked, ["p", A]);
});

test("a forced file says so in its header, and is otherwise the same file", () => {
  const forced = changeFiles("some-plugin", A, B, diffTools(null, file(NEW_TOOL)), ROW, { forced: true });
  assert.match(forced.forward, /^-- A NEW plugin, by --new-plugin: the tool file kept for a{40} is not read, whatever it holds\.$/m);
  assert.ok(!forced.forward.includes("is not a directory under plugins/"), "a forced header does not claim the directory was absent");
  assert.match(forced.rollback, /^-- Returns the registry to no row for some-plugin, from what b{40} served\.$/m);
  const body = (s) => s.slice(s.indexOf("\nBEGIN;\n"));
  assert.equal(body(forced.forward), body(NEW.forward));
  assert.equal(body(forced.rollback), body(NEW.rollback));
  assert.throws(() => changeFiles("some-plugin", A, B, diffTools(file(tool("a")), file(tool("a"), NEW_TOOL)), null, { forced: true }), /--new-plugin needs a new plugin's diff/);
});
