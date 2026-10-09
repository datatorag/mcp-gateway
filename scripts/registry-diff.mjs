#!/usr/bin/env node
// Generate the registry change file for a plugin between two gateway commits
// (SCRUM-390).
//
//   pnpm registry:diff <slug> --from <sha> --to <sha> [--out <dir>]
//   node scripts/registry-diff.mjs --self-test
//
// <sha> is a full gateway commit on main. --from is the gateway that is
// running. The two tool files (what each image's plugin SERVED when CI built
// it) are fetched from the build records of those commits and from nowhere
// else. It writes forward.sql and rollback.sql into <dir> (default: the
// current directory), both headed NOT RUN.
//
// IT NEVER OPENS A DATABASE CONNECTION, and nothing here runs the files. A
// person runs them, in the order docs/architecture's SCRUM-390 spec gives.
//
// What a file is: one guarded statement per row that changes. The guard is the
// md5 of the row's description and of input_schema_json::text AS POSTGRES
// RENDERS IT, taken from the --from tool file. If the live row is not what the
// file was generated from, the statement touches nothing, its block raises,
// and the transaction rolls back. So the one hard part is jsonbText below: it
// must reproduce Postgres's jsonb output exactly, or every guard misses and
// the file safely does nothing. The self-test holds it to known md5s.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.env.GITHUB_REPOSITORY ?? "datatorag/mcp-gateway";
const BUILD_WORKFLOW = ".github/workflows/build.yml";

export const md5 = (text) => createHash("md5").update(text, "utf8").digest("hex");

const utf8 = (s) => Buffer.from(s, "utf8");

/**
 * A JSON value as Postgres prints a jsonb: object keys unique, ordered by
 * byte length and then bytewise; `": "` after a key and `", "` between
 * members; strings escaped as JSON.stringify escapes them (the same short
 * escapes, \u00XX for other control characters, everything else as it is).
 */
export function jsonbText(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (value.includes("\u0000")) throw new Error("jsonb cannot hold a NUL character");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    // Integers print as they are. Postgres keeps a decimal's written form
    // (1.50 stays 1.50), which a parsed number has lost, so anything else is
    // refused rather than guessed.
    if (!Number.isSafeInteger(value)) throw new Error(`a number jsonbText cannot render exactly: ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => {
      const [ba, bb] = [utf8(a), utf8(b)];
      return ba.length - bb.length || Buffer.compare(ba, bb);
    });
    return `{${keys.map((k) => `${JSON.stringify(k)}: ${jsonbText(value[k])}`).join(", ")}}`;
  }
  throw new Error(`not a JSON value: ${typeof value}`);
}

/** A SQL string literal. Only the quote doubles, which is right under
 * standard_conforming_strings; every file sets that itself, so a session that
 * has it off cannot turn a backslash into an escape. */
export function sqlString(text) {
  if (text.includes("\u0000")) throw new Error("a SQL string cannot hold a NUL character");
  return `'${text.replaceAll("'", "''")}'`;
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TOOL = /^[A-Za-z0-9_.-]+$/;

function checkFile(file, label) {
  if (!file || !Array.isArray(file.tools) || file.tools.length === 0) {
    throw new Error(`${label}: not a tool file, or it lists no tools`);
  }
  const seen = new Set();
  for (const t of file.tools) {
    if (typeof t.name !== "string" || !TOOL.test(t.name)) throw new Error(`${label}: a tool name that is not a plain name`);
    if (seen.has(t.name)) throw new Error(`${label}: ${t.name} is listed twice`);
    seen.add(t.name);
    if (typeof t.description !== "string") throw new Error(`${label}: ${t.name} has no description`);
    if (t.inputSchema === null || typeof t.inputSchema !== "object") throw new Error(`${label}: ${t.name} has no input schema`);
    if (![true, false, null].includes(t.readOnlyHint)) throw new Error(`${label}: ${t.name} has a read-only hint that is not true, false or null`);
  }
  return new Map(file.tools.map((t) => [t.name, t]));
}

const hashes = (t) => ({ description: md5(t.description), schema: md5(jsonbText(t.inputSchema)) });

/** Which rows change between two tool files of one plugin. */
export function diffTools(from, to) {
  const [a, b] = [checkFile(from, "--from"), checkFile(to, "--to")];
  const changed = [];
  const added = [];
  const removed = [];
  for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const [ta, tb] = [a.get(name), b.get(name)];
    if (!ta) added.push(tb);
    else if (!tb) removed.push(ta);
    else {
      const fields = [];
      if (ta.description !== tb.description) fields.push("description");
      if (jsonbText(ta.inputSchema) !== jsonbText(tb.inputSchema)) fields.push("input_schema_json");
      if (ta.readOnlyHint !== tb.readOnlyHint) fields.push("read_only_hint");
      if (fields.length > 0) changed.push({ name, from: ta, to: tb, fields });
    }
  }
  return { changed, added, removed, fromCount: a.size, toCount: b.size };
}

const sqlBool = (v) => (v === null ? "NULL" : v ? "true" : "false");
const schemaLiteral = (t) => `${sqlString(JSON.stringify(t.inputSchema))}::jsonb`;

function updateBlock(slug, name, was, becomes, label) {
  const g = hashes(was);
  return [
    `  -- ${name}`,
    `  UPDATE tools t SET description = ${sqlString(becomes.description)}, input_schema_json = ${schemaLiteral(becomes)}, read_only_hint = ${sqlBool(becomes.readOnlyHint)}, updated_at = now()`,
    `  FROM mcp_servers s`,
    `  WHERE s.id = t.mcp_server_id AND s.slug = ${sqlString(slug)} AND t.name = ${sqlString(name)}`,
    `    AND md5(t.description) = '${g.description}'`,
    `    AND md5(t.input_schema_json::text) = '${g.schema}'`,
    `    AND t.read_only_hint IS NOT DISTINCT FROM ${sqlBool(was.readOnlyHint)}`,
    `  ;`,
    `  GET DIAGNOSTICS n = ROW_COUNT;`,
    `  IF n <> 1 THEN RAISE EXCEPTION '${label} ${name}: expected 1 row, updated %', n; END IF;`,
    ``,
  ];
}

function insertBlock(slug, tool, label) {
  const namespaced = `${slug}__${tool.name}`;
  return [
    `  -- ${tool.name}: a new row`,
    `  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)`,
    `  SELECT s.id, ${sqlString(tool.name)}, ${sqlString(namespaced)},`,
    `    ${sqlString(tool.description)},`,
    `    ${schemaLiteral(tool)},`,
    `    ${sqlBool(tool.readOnlyHint)}`,
    `  FROM mcp_servers s`,
    `  WHERE s.slug = ${sqlString(slug)}`,
    `    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = ${sqlString(namespaced)});`,
    `  GET DIAGNOSTICS n = ROW_COUNT;`,
    `  IF n <> 1 THEN RAISE EXCEPTION '${label} ${tool.name}: expected 1 row, inserted %', n; END IF;`,
    ``,
  ];
}

function deleteBlock(slug, tool, label) {
  const g = hashes(tool);
  return [
    `  -- ${tool.name}: the row goes`,
    `  DELETE FROM tools t USING mcp_servers s`,
    `  WHERE s.id = t.mcp_server_id AND s.slug = ${sqlString(slug)} AND t.name = ${sqlString(tool.name)}`,
    `    AND md5(t.description) = '${g.description}'`,
    `    AND md5(t.input_schema_json::text) = '${g.schema}';`,
    `  GET DIAGNOSTICS n = ROW_COUNT;`,
    `  IF n <> 1 THEN RAISE EXCEPTION '${label} ${tool.name}: expected 1 row, deleted %', n; END IF;`,
    ``,
  ];
}

/** The tag that quotes the DO block. The block's body holds text from a tool
 * file, and a dollar-quoted body ends at the first copy of its own tag. A bare
 * `$$` would let a description that contains `$$` end the block and put the
 * rest of itself outside every guard, so the tag is a name and a body that
 * contains it is refused outright. */
const BLOCK_TAG = "$registry_change$";

function wrap(header, blocks, slug, names, expectedCount) {
  const list = names.map(sqlString).join(", ");
  const body = [
    `DECLARE n int;`,
    `BEGIN`,
    ...blocks,
    `  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = ${sqlString(slug)};`,
    `  IF n <> ${expectedCount} THEN RAISE EXCEPTION 'rows for ${slug}: expected ${expectedCount}, found %', n; END IF;`,
    `END`,
  ];
  if (body.some((line) => line.includes(BLOCK_TAG))) {
    throw new Error(`a tool's text contains ${BLOCK_TAG}, which would end the statement block early. No file written.`);
  }
  return [
    ...header.map((l) => `-- ${l}`),
    ``,
    `BEGIN;`,
    `SET LOCAL standard_conforming_strings = on;`,
    `DO ${BLOCK_TAG}`,
    ...body,
    `${BLOCK_TAG};`,
    `SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at`,
    `FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id`,
    `WHERE s.slug = ${sqlString(slug)} AND t.name IN (${list || "''"});`,
    `COMMIT;`,
    ``,
  ].join("\n");
}

/** forward.sql and rollback.sql for a diff, or null when nothing changes. */
export function changeFiles(slug, fromSha, toSha, diff) {
  if (!SLUG.test(slug)) throw new Error("not a plugin slug");
  // Both go into the file's header lines.
  for (const sha of [fromSha, toSha]) if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("a commit must be a full 40-character sha");
  const { changed, added, removed, fromCount, toCount } = diff;
  if (changed.length + added.length + removed.length === 0) return null;
  const names = [...changed.map((c) => c.name), ...added.map((t) => t.name), ...removed.map((t) => t.name)].sort();
  const summary = [
    `${changed.length} row(s) change, ${added.length} added, ${removed.length} removed.`,
    `Rows for ${slug}: ${fromCount} before, ${toCount} after.`,
    ...changed.map((c) => `  changes ${c.name}: ${c.fields.join(", ")}`),
    ...added.map((t) => `  adds ${t.name}`),
    ...removed.map((t) => `  removes ${t.name}`),
  ];
  const guardNote = [
    `Each statement is guarded by the md5 of the row's description and of input_schema_json::text`,
    `as the other commit's plugin served them. If the live row differs, the statement touches`,
    `nothing, the block raises and the transaction rolls back.`,
    `One transaction. Run by a person, on a confirmation that names the database. See the`,
    `SCRUM-390 spec for the order against the deploy.`,
  ];
  const forward = wrap(
    [
      `Registry change for ${slug}. PROPOSAL: NOT RUN.`,
      `Generated from the tool files CI kept for gateway ${fromSha} (what is running) and ${toSha}.`,
      ...summary,
      ...guardNote,
    ],
    [
      ...changed.flatMap((c) => updateBlock(slug, c.name, c.from, c.to, "forward")),
      ...added.flatMap((t) => insertBlock(slug, t, "forward")),
      ...removed.flatMap((t) => deleteBlock(slug, t, "forward")),
    ],
    slug,
    names,
    toCount
  );
  const rollback = wrap(
    [
      `ROLLBACK of the registry change for ${slug}. PROPOSAL: NOT RUN.`,
      `Returns the rows to what gateway ${fromSha} served, from what ${toSha} served.`,
      ...summary.map((l) => l.replace(/^(\s*)changes /, "$1restores ").replace(/^(\s*)adds /, "$1deletes ").replace(/^(\s*)removes /, "$1re-inserts ")),
      `A re-inserted row is a NEW row: its id, enabled flag and counters are the table's defaults,`,
      `not what the deleted row had.`,
      ...guardNote,
    ],
    [
      ...changed.flatMap((c) => updateBlock(slug, c.name, c.to, c.from, "rollback")),
      ...added.flatMap((t) => deleteBlock(slug, t, "rollback")),
      ...removed.flatMap((t) => insertBlock(slug, t, "rollback")),
    ],
    slug,
    names,
    fromCount
  );
  return { forward, rollback };
}

// ---- Fetching a tool file from a build record --------------------------

const gh = (args, opts = {}) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });

/**
 * Which build records may be believed, and what to do when they disagree.
 * The rule scripts/published-digest.sh applies to a digest, applied to a tool
 * file: the run must be build.yml, from this repository, started by a push or
 * a dispatch, AND AT A COMMIT ON MAIN. Without the last one, anyone who can
 * push a branch can edit the workflow there and upload a record under any
 * name. Records that pass must then all hold the same tool file.
 *
 * `records` is [{ runPath, event, repo, headOnMain, line, toolText }], where
 * toolText is null when that record holds no tool file for the plugin.
 */
export function chooseToolFile(records, wantedLine, slug, sha) {
  const believed = records.filter(
    (r) =>
      r.runPath === BUILD_WORKFLOW &&
      r.repo === REPO &&
      ["push", "workflow_dispatch"].includes(r.event) &&
      r.headOnMain === true &&
      r.line === wantedLine
  );
  if (believed.length === 0) throw new Error(`no build record on main for ${sha} names the image the registry holds for it`);
  const texts = believed.map((r) => r.toolText);
  if (texts.some((t) => t === null)) {
    throw new Error(`the build record of ${sha} holds no tool file for ${slug}. It was built before tool files were kept, or ${slug} is not a plugin in that commit.`);
  }
  const canonical = texts.map((t) => JSON.stringify(JSON.parse(t)));
  if (new Set(canonical).size !== 1) {
    throw new Error(`two build records on main hold different tool files for ${slug} at ${sha}. Not usable until a person has looked.`);
  }
  return JSON.parse(texts[0]);
}

const onMain = (sha) => {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) return false;
  try {
    // In full: a tag or a branch named origin/main must not decide.
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "refs/remotes/origin/main"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/**
 * The tool file CI kept for <slug> beside the image it published for <sha>.
 * scripts/published-digest.sh first decides whether a trustworthy record of
 * the image exists and names its digest; chooseToolFile then applies the same
 * rule to the records themselves.
 */
function fetchToolFile(slug, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("a commit must be a full 40-character sha");
  const here = new URL(".", import.meta.url).pathname;
  const digest = execFileSync("bash", [join(here, "published-digest.sh"), "gateway", sha], { encoding: "utf8" }).trim();
  const wanted = `gateway ${sha} ${digest}`;
  const listing = JSON.parse(gh(["api", `repos/${REPO}/actions/artifacts?name=image-gateway-${sha}&per_page=100`]));
  const live = listing.artifacts.filter((a) => !a.expired);
  if (live.length >= 100) throw new Error(`too many records named for ${sha} to judge`);
  const records = [];
  for (const art of live) {
    const run = JSON.parse(gh(["api", `repos/${REPO}/actions/runs/${art.workflow_run.id}`]));
    const record = {
      runPath: run.path,
      event: run.event,
      repo: run.head_repository?.full_name,
      headOnMain: onMain(art.workflow_run.head_sha),
      line: null,
      toolText: null,
    };
    // Only a record that could be believed is downloaded at all.
    if (record.runPath === BUILD_WORKFLOW && record.repo === REPO && record.headOnMain && ["push", "workflow_dispatch"].includes(record.event)) {
      const dir = mkdtempSync(join(tmpdir(), "registry-diff-"));
      try {
        const zip = join(dir, "a.zip");
        writeFileSync(zip, execFileSync("gh", ["api", `repos/${REPO}/actions/artifacts/${art.id}/zip`], { maxBuffer: 256 * 1024 * 1024 }));
        record.line = execFileSync("unzip", ["-p", zip, "image.txt"], { encoding: "utf8" }).trim();
        try {
          record.toolText = execFileSync("unzip", ["-p", zip, `tools-${slug}.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        } catch {
          record.toolText = null;
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    records.push(record);
  }
  return chooseToolFile(records, wanted, slug, sha);
}

// ---- Self-test ---------------------------------------------------------

/** Public tool schemas with the md5 Postgres gives their jsonb text. */
export const FIXTURES = JSON.parse(readFileSync(new URL("./registry-diff.fixtures.json", import.meta.url), "utf8"));

export function selfTest() {
  const failures = [];
  const expect = (what, got, want) => {
    if (got !== want) failures.push(`${what}: got ${got}, wanted ${want}`);
  };
  // The rendering rules, one at a time.
  expect("key order is by length, then bytes", jsonbText({ bb: 1, a: 2, ab: 3, B: 4 }), '{"B": 4, "a": 2, "ab": 3, "bb": 1}');
  expect("nesting and separators", jsonbText({ a: [1, "x", { c: null }], b: {} }), '{"a": [1, "x", {"c": null}], "b": {}}');
  expect("empty array", jsonbText([]), "[]");
  expect("escapes", jsonbText('a"b\\c\n\t\u0001é'), '"a\\"b\\\\c\\n\\t\\u0001é"');
  expect("a multi-byte key sorts by its byte length", jsonbText({ "é": 1, zz: 2, z: 3 }), '{"z": 3, "zz": 2, "é": 1}');
  expect("a quote doubles in SQL", sqlString("it's"), "'it''s'");
  // The ground truth: real schemas against the md5 a live Postgres reported.
  for (const f of FIXTURES) {
    expect(`${f.name} description md5`, md5(f.description), f.descriptionMd5);
    expect(`${f.name} schema md5`, md5(jsonbText(f.inputSchema)), f.schemaMd5);
  }
  if (FIXTURES.length < 5) failures.push("too few fixtures to mean anything");
  // The known-bad form: a renderer that prints compact JSON must NOT match.
  const compact = FIXTURES.filter((f) => md5(JSON.stringify(f.inputSchema)) === f.schemaMd5);
  if (compact.length === FIXTURES.length) failures.push("every fixture matches compact JSON too, so the fixtures prove nothing");
  return failures;
}

// ---- Command line ------------------------------------------------------

function main(argv) {
  if (argv[0] === "--self-test") {
    const failures = selfTest();
    for (const f of failures) console.error(`registry-diff self-test FAILED: ${f}`);
    if (failures.length > 0) process.exit(2);
    console.log(`registry-diff self-test ok: the jsonb rendering matches ${FIXTURES.length} known md5s.`);
    return;
  }
  const slug = argv[0];
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const [from, to, out] = [opt("--from"), opt("--to"), opt("--out") ?? "."];
  if (!slug || !SLUG.test(slug) || !from || !to) {
    console.error("usage: registry-diff.mjs <slug> --from <sha> --to <sha> [--out <dir>]");
    process.exit(2);
  }
  const diff = diffTools(fetchToolFile(slug, from), fetchToolFile(slug, to));
  const files = changeFiles(slug, from, to, diff);
  if (!files) {
    console.log(`${slug}: no registry row changes between ${from} and ${to} (${diff.toCount} tools). No file written.`);
    return;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "forward.sql"), files.forward);
  writeFileSync(join(out, "rollback.sql"), files.rollback);
  console.log(`${slug}: ${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed.`);
  console.log(`Wrote ${join(out, "forward.sql")} and ${join(out, "rollback.sql")}. NOT RUN. This command opened no database connection.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`registry-diff: ${err.message}`);
    process.exit(1);
  }
}
