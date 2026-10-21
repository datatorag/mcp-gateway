// Tests of the registry file check (SCRUM-423).
// Run with: node --test scripts/registry-file-check.test.mjs
//
// Two directions. Everything the generator writes passes, so the check
// never refuses a real change. And every way a file could be made to do
// something else fails, each for its own reason, so no refusal can be
// deleted without a test going red.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changeFiles, diffTools, serverRow } from "./registry-diff.mjs";
import { checkRegistryFile, MAX_ROW_STATEMENTS, Refusal, requestLines, sha256Of, tokenize } from "./registry-file-check.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const tool = (name, over = {}) => ({
  name,
  description: `Describes ${name}.`,
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  readOnlyHint: true,
  ...over,
});
const file = (...tools) => ({ tools });
const gen = (from, to, slug = "gws-mcp") => changeFiles(slug, A, B, diffTools(from, to));

// A change of every kind at once, and text that tries everything a literal
// can hold: quotes, backslashes, comment markers, semicolons, keywords.
const nasty = `It's "quoted"; -- not a comment; /* nor this */ \\n \\'; DROP TABLE users; COMMIT; $$ end`;
const MIXED = gen(
  file(tool("keep"), tool("old"), tool("edit")),
  file(tool("keep"), tool("edit", { description: nasty, inputSchema: { type: "object", description: nasty } }), tool("fresh", { description: nasty, readOnlyHint: null }))
);

test("passes everything the generator writes: one add, one change, one removal, and all three", () => {
  const cases = [
    gen(file(tool("a")), file(tool("a"), tool("b"))),
    gen(file(tool("a")), file(tool("a", { description: "changed" }))),
    gen(file(tool("a"), tool("b")), file(tool("a"))),
    MIXED,
  ];
  for (const { forward, rollback } of cases) {
    assert.ok(checkRegistryFile(forward).ops.length > 0);
    assert.ok(checkRegistryFile(rollback).ops.length > 0);
  }
  const r = checkRegistryFile(MIXED.forward);
  assert.equal(r.slug, "gws-mcp");
  assert.deepEqual(
    r.ops.map((o) => `${o.op} ${o.name}`),
    ["changes edit", "adds fresh", "removes old"]
  );
});

test("passes every file committed under registry/, so a broken one fails CI before anyone dispatches it", () => {
  const dir = new URL("../registry/", import.meta.url).pathname;
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length >= 2);
  for (const f of files) assert.ok(checkRegistryFile(readFileSync(join(dir, f), "utf8")), f);
});

test("text inside a literal is never read as a statement", () => {
  const { skeleton, strings } = tokenize(MIXED.forward);
  assert.ok(strings.some((s) => s.includes("DROP TABLE users")));
  assert.ok(!skeleton.includes("DROP"));
  assert.ok(!skeleton.includes("/*"));
});

test("the request a reviewer reads names the file, its sha256 and each row", () => {
  const lines = requestLines("registry/x.sql", MIXED.forward, checkRegistryFile(MIXED.forward));
  assert.equal(lines[1], `sha256: ${sha256Of(MIXED.forward)}`);
  assert.ok(lines.includes("  adds fresh"));
});

/** Each near-miss is a small edit to a real generated file, and must be
 * refused with a reason that matches. */
const base = gen(file(tool("a")), file(tool("a", { description: "changed" }), tool("b"))).forward;
const nearMisses = [
  ["a statement after COMMIT", (s) => s + "DELETE FROM users;\n", /does not close/],
  ["a second statement before BEGIN", (s) => s.replace("\nBEGIN;\n", "\nDELETE FROM users;\nBEGIN;\n"), /does not open/],
  ["another table", (s) => s.replace("UPDATE tools t SET", "UPDATE users t SET"), /changes no row|not one the generator/],
  ["DDL inside the block", (s) => s.replace("DECLARE n int;\nBEGIN\n", "DECLARE n int;\nBEGIN\n  DROP TABLE users;\n"), /changes no row|not one the generator/],
  ["another SET", (s) => s.replace("SET LOCAL standard_conforming_strings = on;", "SET LOCAL role = postgres;"), /does not open/],
  ["an update without its description guard", (s) => s.replace(/\n    AND md5\(t\.description\) = '[0-9a-f]{32}'\n    AND md5\(t\.input_schema_json::text\) = '[0-9a-f]{32}'\n    AND t\.read_only_hint/, "\n    AND md5(t.input_schema_json::text) = 'cccccccccccccccccccccccccccccccc'\n    AND t.read_only_hint"), /changes no row|not one the generator|does not close/],
  ["a delete without its guards", () => gen(file(tool("a"), tool("b")), file(tool("a"))).forward.replace(/\n    AND md5\(t\.description\) = '[0-9a-f]{32}'\n    AND md5\(t\.input_schema_json::text\) = '[0-9a-f]{32}';/, ";"), /changes no row|not one the generator|does not close/],
  ["an update that sets a fifth column", (s) => s.replace("updated_at = now()", "updated_at = now(), namespaced_name = 'other-mcp__a'"), /changes no row|not one the generator|does not close/],
  ["an update that moves the row to another server", (s) => s.replace("SET description =", "SET mcp_server_id = s.id, description ="), /changes no row|not one the generator|does not close/],
  ["an E'' string", (s) => s.replace("SET description = '", "SET description = E'"), /prefixed string/],
  ["another dollar tag", (s) => s.replace("DECLARE n int;", "DECLARE n int; -- $x$").replace("-- $x$", "$x$"), /dollar sign/],
  ["the block tag inside a description", (s) => s.replace("SET description = 'changed'", "SET description = 'x $registry_change$ y'"), /appears 3 times/],
  ["a backslash outside a literal", (s) => s.replace("DECLARE n int;", "\\! id\nDECLARE n int;"), /backslash/],
  ["a block comment", (s) => s.replace("DECLARE n int;", "/* x */ DECLARE n int;"), /block comment/],
  ["a quoted identifier", (s) => s.replace("UPDATE tools t", 'UPDATE "tools" t'), /quoted identifier/],
  ["a carriage return", (s) => s.replace("COMMIT;\n", "COMMIT;\r\n"), /carriage return/],
  ["two plugins in one file", (s) => s.replace(/s\.slug = 'gws-mcp' AND t\.name = 'a'/, "s.slug = 'atlassian-mcp' AND t.name = 'a'"), /two plugins/],
  ["an insert whose namespaced name is another plugin's", (s) => s.replace("'gws-mcp__b',", "'atlassian-mcp__b',"), /does not name it as/],
  ["a guard message that is not the generator's", (s) => s.replace("expected 1 row, inserted %", "expected 1 row, whatever %"), /guard's message/],
  ["a row count that disagrees with its message", (s) => s.replace(/IF n <> (\d+) THEN RAISE EXCEPTION 'rows for/, "IF n <> 999 THEN RAISE EXCEPTION 'rows for"), /row-count guard/],
  ["a closing read that names other rows", (s) => s.replace(/t\.name IN \(([^)]*)\);/, "t.name IN ('a', 'b', 'zzz');"), /closing read/],
  ["an md5 that is not one", (s) => s.replace(/md5\(t\.description\) = '[0-9a-f]{32}'/, "md5(t.description) = 'not-an-md5'"), /not an md5/],
  ["a schema that is not a JSON object", (s) => s.replace(/input_schema_json = '[^']*'::jsonb/, "input_schema_json = '[1]'::jsonb"), /not a JSON object/],
  ["no header", (s) => s.slice(s.indexOf("BEGIN;")), /does not open/],
  ["a tool name with a quote in it", (s) => s.replace("t.name = 'a'", "t.name = 'a''; x'"), /not a tool name/],
  ["a NUL character", (s) => s.replace("changed", "chan\u0000ged"), /NUL/],
];

for (const [label, edit, why] of nearMisses) {
  test(`refuses ${label}`, () => {
    const text = edit(base);
    assert.notEqual(text, base, "the edit changed nothing, so this case proves nothing");
    assert.throws(() => checkRegistryFile(text), (err) => err instanceof Refusal && why.test(err.message));
  });
}

test(`refuses more than ${MAX_ROW_STATEMENTS} row statements`, () => {
  const many = Array.from({ length: MAX_ROW_STATEMENTS + 1 }, (_, i) => tool(`t${i}`));
  const { forward } = gen(file(tool("keep")), file(tool("keep"), ...many));
  assert.throws(() => checkRegistryFile(forward), (err) => err instanceof Refusal && /more than/.test(err.message));
  const ok = gen(file(tool("keep")), file(tool("keep"), ...many.slice(0, MAX_ROW_STATEMENTS))).forward;
  assert.equal(checkRegistryFile(ok).ops.length, MAX_ROW_STATEMENTS);
});

const more = [
  ["a literal that is never closed", (s) => s.replace("COMMIT;\n", "COMMIT; 'open\n"), /not closed/],
  ["a comment that names another row", (s) => s.replace("  -- b: a new row", "  -- c: a new row"), /comment above/],
  ["a row touched twice", (s) => {
    const block = s.slice(s.indexOf("  -- b: a new row"), s.indexOf("  SELECT count(*)"));
    return s.replace(block, block + block);
  }, /touched twice|closing read/],
  ["a reserved control character", (s) => s.replace("changed", "chan\u0001ged"), /reserves/],
];
for (const [label, edit, why] of more) {
  test(`refuses ${label}`, () => {
    const text = edit(base);
    assert.notEqual(text, base, "the edit changed nothing, so this case proves nothing");
    assert.throws(() => checkRegistryFile(text), (err) => err instanceof Refusal && why.test(err.message));
  });
}

test("the command line refuses a file whose sha256 is not the one asked for, and accepts the right one", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "registry-check-"));
  const path = join(dir, "x.sql");
  writeFileSync(path, base);
  const script = new URL("./registry-file-check.mjs", import.meta.url).pathname;
  const right = spawnSync(process.execPath, [script, path, "--sha256", sha256Of(base)], { encoding: "utf8" });
  assert.equal(right.status, 0, right.stderr);
  assert.match(right.stdout, /adds b/);
  const wrong = spawnSync(process.execPath, [script, path, "--sha256", "0".repeat(64)], { encoding: "utf8" });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /not the 0{64} the run was asked for/);
  const bad = spawnSync(process.execPath, [script, path, "--sha256", "nothex"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});

const delBase = gen(file(tool("a"), tool("b")), file(tool("a"))).forward;
test("refuses a slug that is not a plugin slug, even when the whole file agrees on it", () => {
  const text = base.replaceAll("gws-mcp", "Not A Slug");
  assert.notEqual(text, base);
  assert.throws(() => checkRegistryFile(text), (err) => err instanceof Refusal && /not a plugin slug/.test(err.message));
});
test("refuses a comment above an update that names another row", () => {
  const text = base.replace("  -- a\n", "  -- z\n");
  assert.notEqual(text, base);
  assert.throws(() => checkRegistryFile(text), (err) => err instanceof Refusal && /comment above the update/.test(err.message));
});
test("refuses a comment above a delete that names another row", () => {
  const text = delBase.replace("  -- b: the row goes", "  -- z: the row goes");
  assert.notEqual(text, delBase);
  assert.throws(() => checkRegistryFile(text), (err) => err instanceof Refusal && /comment above the delete/.test(err.message));
});

test("every committed pair is a forward and its exact inverse, on the same rows of the same plugin", () => {
  const dir = new URL("../registry/", import.meta.url).pathname;
  const forwards = readdirSync(dir).filter((f) => f.endsWith(".sql") && !f.endsWith(".rollback.sql"));
  assert.ok(forwards.length >= 2);
  const inverse = { adds: "removes", removes: "adds", changes: "changes" };
  for (const f of forwards) {
    const back = f.replace(/\.sql$/, ".rollback.sql");
    const fwd = checkRegistryFile(readFileSync(join(dir, f), "utf8"));
    const rev = checkRegistryFile(readFileSync(join(dir, back), "utf8"));
    assert.equal(rev.slug, fwd.slug, f);
    const expected = fwd.ops.map((o) => `${inverse[o.op]} ${o.name}`).sort();
    assert.deepEqual(rev.ops.map((o) => `${o.op} ${o.name}`).sort(), expected, f);
    // The forward ends at the count the rollback starts from, and back.
    const delta = (r) => r.ops.filter((o) => o.op === "adds").length - r.ops.filter((o) => o.op === "removes").length;
    assert.equal(fwd.expectedRows - delta(fwd), rev.expectedRows, f);
    assert.equal(rev.expectedRows - delta(rev), fwd.expectedRows, f);
  }
});

/* A NEW plugin (SCRUM-366): the forward file inserts the plugin's mcp_servers
 * row before its tools, the rollback deletes it after them. The check accepts
 * exactly those two statements in exactly those places. */
const ROW = serverRow("notion-like", { name: "Notion-like", description: nasty, oauth: { scopes: [], clientIdEnv: "$X" } }, { license: "MIT" }, "datatorag/mcp-gateway");
const NEW = changeFiles("notion-like", A, B, diffTools(null, file(tool("search"), tool("read_page", { description: nasty }))), ROW);

test("passes a new plugin's pair: the server row first forward, last back", () => {
  const fwd = checkRegistryFile(NEW.forward);
  assert.equal(fwd.server, "insert");
  assert.equal(fwd.expectedRows, 2);
  assert.deepEqual(fwd.ops.map((o) => `${o.op} ${o.name}`), ["adds read_page", "adds search"]);
  const back = checkRegistryFile(NEW.rollback);
  assert.equal(back.server, "delete");
  assert.equal(back.expectedRows, 0);
  assert.deepEqual(back.ops.map((o) => `${o.op} ${o.name}`), ["removes read_page", "removes search"]);
  // A tool change file has no server statement.
  assert.equal(checkRegistryFile(base).server, null);
  // And a NULL description and license are accepted where a string would be.
  const bare = serverRow("notion-like", { name: "X" }, {}, "datatorag/mcp-gateway");
  const bareFiles = changeFiles("notion-like", A, B, diffTools(null, file(tool("search"))), bare);
  assert.equal(checkRegistryFile(bareFiles.forward).server, "insert");
  assert.equal(checkRegistryFile(bareFiles.rollback).server, "delete");
});

test("the request a reviewer reads says a server row is added or removed", () => {
  assert.ok(requestLines("registry/x.sql", NEW.forward, checkRegistryFile(NEW.forward)).includes("  adds the mcp_servers row notion-like (status active, port chosen by the statement)"));
  assert.ok(requestLines("registry/x.sql", NEW.rollback, checkRegistryFile(NEW.rollback)).includes("  removes the mcp_servers row notion-like"));
});

const fwdNew = NEW.forward;
const backNew = NEW.rollback;
const serverNearMisses = [
  // The forward insert's own guards.
  ["a server insert without its slug guard", fwdNew, (s) => s.replace(/\n  WHERE NOT EXISTS \(SELECT 1 FROM mcp_servers s WHERE s\.slug = 'notion-like'\);/, ";"), /not one the generator|does not open|changes no row/],
  ["a server insert without its port check", fwdNew, (s) => s.replace(/  SELECT count\(\*\) INTO n FROM mcp_servers s JOIN mcp_servers o[^\n]*\n  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers notion-like: expected 1 row on its port, found %', n; END IF;\n/, ""), /not one the generator|changes no row/],
  ["a server insert with a port of its own choosing", fwdNew, (s) => s.replace(/\(SELECT min\(p\.port\)[^\n]*\)\)\n/, "40000\n"), /not one the generator|changes no row/],
  ["a server insert from another port range", fwdNew, (s) => s.replace("generate_series(40000, 40999)", "generate_series(1, 40999)"), /not one the generator|changes no row/],
  ["a server row that is not active", fwdNew, (s) => s.replace("    'active',\n", "    'disabled',\n"), /status/],
  ["a server row for another plugin than its tools", fwdNew, (s) => s.replace("SELECT 'notion-like', 'Notion-like',", "SELECT 'other-plugin', 'Notion-like',"), /two plugins/],
  ["a server row's slug guard on another plugin", fwdNew, (s) => s.replace("WHERE s.slug = 'notion-like');\n", "WHERE s.slug = 'other-plugin');\n"), /two plugins/],
  ["a source link outside the plugin's directory", fwdNew, (s) => s.replace("/tree/main/plugins/notion-like'", "/tree/main/apps'"), /source link/],
  ["a source link on another host", fwdNew, (s) => s.replace("'https://github.com/datatorag/mcp-gateway/tree", "'https://example.test/datatorag/mcp-gateway/tree"), /source link/],
  ["a manifest that is not a JSON object", fwdNew, (s) => s.replace(/'\{"name":"Notion-like"[^\n]*'::jsonb,\n/, "'[1]'::jsonb,\n"), /manifest/],
  ["a manifest whose name is not the row's", fwdNew, (s) => s.replace('\'{"name":"Notion-like"', '\'{"name":"Other"'), /manifest/],
  ["a server insert after a tool insert", fwdNew, (s) => {
    const server = s.slice(s.indexOf("  -- notion-like: a new plugin"), s.indexOf("  -- read_page: a new row"));
    const tools = s.slice(s.indexOf("  -- read_page: a new row"), s.indexOf("  SELECT count(*) INTO n FROM tools"));
    return s.replace(server + tools, tools + server);
  }, /does not close|not one the generator/],
  ["a server insert beside a change to an existing tool", fwdNew, (s) => s.replace("  -- read_page: a new row", base.slice(base.indexOf("  -- a\n"), base.indexOf("  -- b: a new row")).replaceAll("gws-mcp", "notion-like") + "  -- read_page: a new row"), /only tool inserts/],
  ["a new plugin whose row count is not its inserts", fwdNew, (s) => s.replace("IF n <> 2 THEN RAISE EXCEPTION 'rows for notion-like: expected 2,", "IF n <> 3 THEN RAISE EXCEPTION 'rows for notion-like: expected 3,"), /row count/],
  ["a server guard message that is not the generator's", fwdNew, (s) => s.replace("forward mcp_servers notion-like: expected 1 row, inserted %", "forward mcp_servers notion-like: fine %"), /guard's message/],
  ["a port guard message that is not the generator's", fwdNew, (s) => s.replace("expected 1 row on its port, found %", "expected 1 row, found %"), /guard's message/],
  ["a comment above the server insert that names another plugin", fwdNew, (s) => s.replace("  -- notion-like: a new plugin, its server row", "  -- other: a new plugin, its server row"), /comment above the server/],
  // The rollback delete's own guards.
  ["a server delete without its md5 guard", backNew, (s) => s.replace(/\n    AND md5\(jsonb_build_array\([^\n]*/, ""), /not one the generator|does not close/],
  ["a server delete guarded on fewer columns", backNew, (s) => s.replace("s.manifest_json, s.status)::text", "s.status)::text"), /not one the generator|does not close/],
  ["a server delete without its tools guard", backNew, (s) => s.replace("\n    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.mcp_server_id = s.id)", ""), /not one the generator|does not close/],
  ["a server delete without its env var guard", backNew, (s) => s.replace("\n    AND NOT EXISTS (SELECT 1 FROM mcp_server_env_vars e WHERE e.mcp_server_id = s.id)", ""), /not one the generator|does not close/],
  ["a server delete without its plugin connection guard", backNew, (s) => s.replace("\n    AND NOT EXISTS (SELECT 1 FROM plugin_connections c WHERE c.mcp_server_id = s.id);", ";"), /not one the generator|does not close/],
  ["a server delete whose md5 is not one", backNew, (s) => s.replace(/::text\) = '[0-9a-f]{32}'/, "::text) = 'nope'"), /not an md5/],
  ["a server delete before the tool deletes", backNew, (s) => {
    const tools = s.slice(s.indexOf("  -- read_page: the row goes"), s.indexOf("  -- notion-like: the new plugin's"));
    const server = s.slice(s.indexOf("  -- notion-like: the new plugin's"), s.indexOf("  SELECT count(*) INTO n FROM tools"));
    return s.replace(tools + server, server + tools);
  }, /does not close|not one the generator|changes no row/],
  ["a server delete for another plugin", backNew, (s) => s.replace("  WHERE s.slug = 'notion-like'\n    AND md5(jsonb", "  WHERE s.slug = 'other-plugin'\n    AND md5(jsonb"), /two plugins/],
  ["a rollback that leaves rows behind", backNew, (s) => s.replace("IF n <> 0 THEN RAISE EXCEPTION 'rows for notion-like: expected 0,", "IF n <> 1 THEN RAISE EXCEPTION 'rows for notion-like: expected 1,"), /row count/],
  ["a server delete guard message that is not the generator's", backNew, (s) => s.replace("rollback mcp_servers notion-like: expected 1 row, deleted %", "forward mcp_servers notion-like: expected 1 row, deleted %"), /guard's message/],
  ["a server delete beside a tool insert", backNew, (s) => s.replace("  -- notion-like: the new plugin's", fwdNew.slice(fwdNew.indexOf("  -- search: a new row"), fwdNew.indexOf("  SELECT count(*) INTO n FROM tools")) + "  -- notion-like: the new plugin's"), /only tool deletes|closing read|row count/],
  // A server statement where no tool file says a plugin is new.
  ["a server delete in a forward file of an existing plugin", base, (s) => s.replace("  SELECT count(*) INTO n FROM tools", backNew.slice(backNew.indexOf("  -- notion-like: the new plugin's"), backNew.indexOf("  SELECT count(*) INTO n FROM tools")).replaceAll("notion-like", "gws-mcp") + "  SELECT count(*) INTO n FROM tools"), /only tool deletes|row count/],
];

for (const [label, start, edit, why] of serverNearMisses) {
  test(`refuses ${label}`, () => {
    const text = edit(start);
    assert.notEqual(text, start, "the edit changed nothing, so this case proves nothing");
    assert.throws(() => checkRegistryFile(text), (err) => err instanceof Refusal && why.test(err.message), label);
  });
}

test("a new plugin's pair is a forward and its exact inverse, server row included", () => {
  const fwd = checkRegistryFile(NEW.forward);
  const rev = checkRegistryFile(NEW.rollback);
  assert.deepEqual([fwd.server, rev.server], ["insert", "delete"]);
  assert.deepEqual(rev.ops.map((o) => o.name).sort(), fwd.ops.map((o) => o.name).sort());
});
