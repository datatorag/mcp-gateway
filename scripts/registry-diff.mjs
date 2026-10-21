#!/usr/bin/env node
// Generate the registry change file for a plugin between two gateway commits
// (SCRUM-390).
//
//   pnpm registry:diff <slug> --from <sha> --to <sha> [--out <dir>] [--new-plugin]
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
//
// A NEW PLUGIN (SCRUM-366). When the --from commit has no plugins/<slug>
// directory, its build record holds no tool file for the slug and that is
// read as an empty tool set. The forward file then also inserts the plugin's
// mcp_servers row, first, in the same transaction, from the plugin's
// datatorag.json and package.json at --to (serverRow below), and refuses if a
// row with that slug exists. The rollback deletes the tool rows and then that
// row, guarded by the md5 of what the forward wrote. A missing tool file for
// a plugin that DID exist at --from, or a record from before tool files were
// kept, still refuses. --new-plugin forces the same files whatever --from
// holds (a main image carrying the plugin can be running before its rows
// exist); it refuses only a --to with no plugins/<slug>. Forcing is safe
// because the insert raises, and the file writes nothing, if the slug has a
// row.
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

/** Which rows change between two tool files of one plugin. `from` is null for
 * a new plugin (chooseBaseToolFile decides that, never a tool file): every
 * tool is added and the result says newPlugin. */
export function diffTools(from, to) {
  const newPlugin = from === null;
  const [a, b] = [newPlugin ? new Map() : checkFile(from, "--from"), checkFile(to, "--to")];
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
  return { changed, added, removed, fromCount: a.size, toCount: b.size, newPlugin };
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

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * The mcp_servers row of a new plugin, from its datatorag.json and
 * package.json at the --to commit. The values are the ones the manager's own
 * install path wrote (plugin-manager.ts, installAsync), and the ones it needs
 * to start the plugin from the image and route calls to it:
 *   name, description  manifest name; manifest description, else package.json's
 *   manifest_json      the manifest as it is (the legacy connect routes read it)
 *   license_spdx       package.json's license, else NULL
 *   github_repo_*      this repository and the plugin's directory in it. NOT
 *                      decorative: buildPluginServerUrl (user-tools.ts) calls
 *                      localhost:<port> only when github_repo_url is set, and
 *                      otherwise a container hostname that does not exist
 *   status             active: startAll() starts only active rows, and the tool
 *                      listing and the public pages read only active rows
 *   container_port     not here: the statement picks it (see serverInsertBlock)
 * Everything else is the column's default (NULL, or now() for timestamps).
 */
export function serverRow(slug, manifest, pkg, repo = REPO) {
  if (!SLUG.test(slug)) throw new Error("not a plugin slug");
  if (!REPO_NAME.test(repo ?? "")) throw new Error(`not a repository name: ${JSON.stringify(repo)}`);
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`plugins/${slug}/datatorag.json is missing or not a JSON object; a new plugin's server row is made from it`);
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") throw new Error(`plugins/${slug}/datatorag.json has no name`);
  const p = pkg ?? {};
  const description = manifest.description ?? p.description ?? null;
  if (description !== null && typeof description !== "string") throw new Error(`plugins/${slug}: the description is not a string`);
  const license = p.license ?? null;
  if (license !== null && typeof license !== "string") throw new Error(`plugins/${slug}/package.json: the license is not a string`);
  jsonbText(manifest); // refuses what the guard could not render exactly
  const [owner, name] = repo.split("/");
  return {
    slug,
    name: manifest.name,
    description,
    githubRepoUrl: `https://github.com/${owner}/${name}/tree/main/plugins/${slug}`,
    githubRepoOwner: owner,
    githubRepoName: name,
    licenseSpdx: license,
    manifest,
    status: "active",
  };
}

const sqlText = (v) => (v === null ? "NULL" : sqlString(v));
/** The columns the rollback's guard covers, in this order, as Postgres prints
 * jsonb_build_array of them. Everything the forward wrote except the port. */
const serverGuard = (row) =>
  md5(jsonbText([row.name, row.description, row.githubRepoUrl, row.githubRepoOwner, row.githubRepoName, row.licenseSpdx, row.manifest, row.status]));

/** The port rule: the lowest port from 40000 (the manager's BASE_PORT) that no
 * mcp_servers row holds, which is the database half of the manager's own
 * nextAvailablePort. Chosen by the statement, so the file needs no database
 * to be written; checked after the insert, so a port another row took in the
 * meantime raises instead of being shared. */
function serverInsertBlock(row) {
  const slug = sqlString(row.slug);
  return [
    `  -- ${row.slug}: a new plugin, its server row`,
    `  INSERT INTO mcp_servers (slug, name, description, github_repo_url, github_repo_owner, github_repo_name, license_spdx, manifest_json, status, container_port)`,
    `  SELECT ${slug}, ${sqlString(row.name)},`,
    `    ${sqlText(row.description)},`,
    `    ${sqlString(row.githubRepoUrl)}, ${sqlString(row.githubRepoOwner)}, ${sqlString(row.githubRepoName)},`,
    `    ${sqlText(row.licenseSpdx)},`,
    `    ${sqlString(JSON.stringify(row.manifest))}::jsonb,`,
    `    ${sqlString(row.status)},`,
    `    (SELECT min(p.port) FROM generate_series(40000, 40999) AS p(port) WHERE NOT EXISTS (SELECT 1 FROM mcp_servers o WHERE o.container_port = p.port))`,
    `  WHERE NOT EXISTS (SELECT 1 FROM mcp_servers s WHERE s.slug = ${slug});`,
    `  GET DIAGNOSTICS n = ROW_COUNT;`,
    `  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers ${row.slug}: expected 1 row, inserted %', n; END IF;`,
    `  SELECT count(*) INTO n FROM mcp_servers s JOIN mcp_servers o ON o.container_port = s.container_port WHERE s.slug = ${slug};`,
    `  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers ${row.slug}: expected 1 row on its port, found %', n; END IF;`,
    ``,
  ];
}

/** Runs after the tool rows are deleted. Three tables point at mcp_servers
 * with ON DELETE CASCADE: tools, mcp_server_env_vars and plugin_connections
 * (a user's row). The delete refuses while any of them holds a row for the
 * server, so the cascade can never remove one. The registry role reads only
 * the mcp_server_id column of the last two (registry/roles). */
function serverDeleteBlock(row) {
  return [
    `  -- ${row.slug}: the new plugin's server row goes`,
    `  DELETE FROM mcp_servers s`,
    `  WHERE s.slug = ${sqlString(row.slug)}`,
    `    AND md5(jsonb_build_array(s.name, s.description, s.github_repo_url, s.github_repo_owner, s.github_repo_name, s.license_spdx, s.manifest_json, s.status)::text) = '${serverGuard(row)}'`,
    `    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.mcp_server_id = s.id)`,
    `    AND NOT EXISTS (SELECT 1 FROM mcp_server_env_vars e WHERE e.mcp_server_id = s.id)`,
    `    AND NOT EXISTS (SELECT 1 FROM plugin_connections c WHERE c.mcp_server_id = s.id);`,
    `  GET DIAGNOSTICS n = ROW_COUNT;`,
    `  IF n <> 1 THEN RAISE EXCEPTION 'rollback mcp_servers ${row.slug}: expected 1 row, deleted %', n; END IF;`,
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

/** forward.sql and rollback.sql for a diff, or null when nothing changes.
 * `server` is the serverRow of a new plugin, and is given exactly when the
 * diff is a new plugin's. */
export function changeFiles(slug, fromSha, toSha, diff, server = null, { forced = false } = {}) {
  if (!SLUG.test(slug)) throw new Error("not a plugin slug");
  // Both go into the file's header lines.
  for (const sha of [fromSha, toSha]) if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("a commit must be a full 40-character sha");
  const { changed, added, removed, fromCount, toCount, newPlugin = false } = diff;
  if (newPlugin && server === null) throw new Error("a new plugin needs its server row");
  if (!newPlugin && server !== null) throw new Error("a server row is written only for a new plugin");
  if (server !== null && server.slug !== slug) throw new Error(`the server row is for ${server.slug}, not ${slug}`);
  if (forced && !newPlugin) throw new Error("--new-plugin needs a new plugin's diff");
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
  const newForward = newPlugin
    ? [
        forced
          ? `A NEW plugin, by --new-plugin: the tool file kept for ${fromSha} is not read, whatever it holds.`
          : `A NEW plugin: ${slug} is not a directory under plugins/ at ${fromSha}.`,
        `Its mcp_servers row is inserted first, from plugins/${slug}/datatorag.json and package.json at ${toSha}:`,
        `  name, description, the manifest as manifest_json, the license, a source link in this repository,`,
        `  status active, and container_port the lowest port from 40000 that no mcp_servers row holds,`,
        `  chosen by the statement itself. It raises if a row for ${slug} already exists.`,
      ]
    : [];
  const newRollback = newPlugin
    ? [
        `A NEW plugin: the rollback deletes its tool rows and then its mcp_servers row, which is`,
        `guarded by the md5 of every column the forward file wrote except the port it chose, and`,
        `refuses while any tool, env var or plugin connection row still points at it, so the`,
        `foreign keys' cascade can never remove one.`,
      ]
    : [];
  const forward = wrap(
    [
      `Registry change for ${slug}. PROPOSAL: NOT RUN.`,
      `Generated from the tool files CI kept for gateway ${fromSha} (what is running) and ${toSha}.`,
      ...newForward,
      ...summary,
      ...guardNote,
    ],
    [
      ...(newPlugin ? serverInsertBlock(server) : []),
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
      forced
        ? `Returns the registry to no row for ${slug}, from what ${toSha} served.`
        : `Returns the rows to what gateway ${fromSha} served, from what ${toSha} served.`,
      ...newRollback,
      ...summary.map((l) => l.replace(/^(\s*)changes /, "$1restores ").replace(/^(\s*)adds /, "$1deletes ").replace(/^(\s*)removes /, "$1re-inserts ")),
      `A re-inserted row is a NEW row: its id, enabled flag and counters are the table's defaults,`,
      `not what the deleted row had.`,
      ...guardNote,
    ],
    [
      ...changed.flatMap((c) => updateBlock(slug, c.name, c.to, c.from, "rollback")),
      ...added.flatMap((t) => deleteBlock(slug, t, "rollback")),
      ...removed.flatMap((t) => insertBlock(slug, t, "rollback")),
      ...(newPlugin ? serverDeleteBlock(server) : []),
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
 * `records` is [{ runPath, event, repo, headOnMain, line, toolText,
 * keptToolFiles }], where toolText is null when that record holds no tool
 * file for the plugin and keptToolFiles says whether it holds any tool file
 * at all (a record from before they were kept holds none).
 */
function believedTexts(records, wantedLine, slug, sha) {
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
  const canonical = texts.map((t) => (t === null ? null : JSON.stringify(JSON.parse(t))));
  if (new Set(canonical).size !== 1) {
    throw new Error(`two build records on main hold different tool files for ${slug} at ${sha}. Not usable until a person has looked.`);
  }
  return { believed, text: texts[0] };
}

const beforeToolFiles = (slug, sha) =>
  `the build record of ${sha} holds no tool file for ${slug}. It was built before tool files were kept, or ${slug} is not a plugin in that commit.`;

/** The --to commit's tool file. It must exist. */
export function chooseToolFile(records, wantedLine, slug, sha) {
  const { text } = believedTexts(records, wantedLine, slug, sha);
  if (text === null) throw new Error(beforeToolFiles(slug, sha));
  return JSON.parse(text);
}

/**
 * The --from commit's tool file, or null for a NEW plugin. A record with no
 * tool file for the slug is a new plugin only when every believed record kept
 * tool files at all AND plugins/<slug> did not exist at that commit
 * (`pluginDirAtBase`, from git, never from the record). Otherwise it refuses:
 * a record from before tool files were kept says nothing about the plugin,
 * and a plugin that existed with no tool file is a broken record, not an
 * empty one.
 */
export function chooseBaseToolFile(records, wantedLine, slug, sha, pluginDirAtBase) {
  const { believed, text } = believedTexts(records, wantedLine, slug, sha);
  if (text !== null) return JSON.parse(text);
  if (believed.some((r) => r.keptToolFiles !== true)) throw new Error(beforeToolFiles(slug, sha));
  if (pluginDirAtBase !== false) {
    throw new Error(`${slug} existed at ${sha} but its build record holds no tool file for it. Not read as a new plugin.`);
  }
  return null;
}

const sha40 = (sha) => {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("a commit must be a full 40-character sha");
};

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
 * The build records CI kept beside the image it published for <sha>, each with
 * its tool file for <slug>. scripts/published-digest.sh first decides whether
 * a trustworthy record of the image exists and names its digest;
 * chooseToolFile and chooseBaseToolFile then apply the same rule to the
 * records themselves.
 */
function fetchRecords(slug, sha) {
  sha40(sha);
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
      keptToolFiles: false,
    };
    // Only a record that could be believed is downloaded at all.
    if (record.runPath === BUILD_WORKFLOW && record.repo === REPO && record.headOnMain && ["push", "workflow_dispatch"].includes(record.event)) {
      const dir = mkdtempSync(join(tmpdir(), "registry-diff-"));
      try {
        const zip = join(dir, "a.zip");
        writeFileSync(zip, execFileSync("gh", ["api", `repos/${REPO}/actions/artifacts/${art.id}/zip`], { maxBuffer: 256 * 1024 * 1024 }));
        record.line = execFileSync("unzip", ["-p", zip, "image.txt"], { encoding: "utf8" }).trim();
        const names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n");
        record.keptToolFiles = names.some((n) => /^tools-[a-z0-9][a-z0-9-]*\.json$/.test(n.trim()));
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
  return { records, wanted };
}

/** Whether plugins/<slug> exists at <sha>. The commit itself must be here: an
 * unfetched commit must never read as "no such directory", which would make
 * every plugin look new. */
function commitHere(sha) {
  sha40(sha);
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
  } catch {
    throw new Error(`${sha} is not a commit in this checkout. Fetch it first.`);
  }
}

function pluginDirAt(sha, slug) {
  commitHere(sha);
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}:plugins/${slug}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A JSON file at a commit, or null when the commit has no such file. */
function jsonAt(sha, path) {
  sha40(sha);
  let text;
  try {
    text = execFileSync("git", ["show", `${sha}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  return JSON.parse(text);
}

function fetchToolFile(slug, sha) {
  const { records, wanted } = fetchRecords(slug, sha);
  return chooseToolFile(records, wanted, slug, sha);
}

/**
 * The base tool set: null for a new plugin. Forced by --new-plugin, which
 * reads nothing of --from and refuses only a --to with no plugins/<slug>;
 * otherwise the automatic rule over --from's build records. The two reads are
 * passed in so this decision is tested without git or GitHub.
 */
export function baseToolFile({ forced, slug, from, to, pluginDirAt: dirAt, fetchBase }) {
  if (!forced) return fetchBase(slug, from);
  if (dirAt(to, slug) !== true) throw new Error(`--new-plugin: ${to} has no plugins/${slug}, so there is no plugin to add`);
  return null;
}

function fetchBaseToolFile(slug, sha) {
  const { records, wanted } = fetchRecords(slug, sha);
  return chooseBaseToolFile(records, wanted, slug, sha, pluginDirAt(sha, slug));
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
  const forced = argv.includes("--new-plugin");
  if (!slug || !SLUG.test(slug) || !from || !to) {
    console.error("usage: registry-diff.mjs <slug> --from <sha> --to <sha> [--out <dir>] [--new-plugin]");
    process.exit(2);
  }
  if (forced) commitHere(from); // only a header line under --new-plugin, but a real commit
  const base = baseToolFile({ forced, slug, from, to, pluginDirAt, fetchBase: fetchBaseToolFile });
  const diff = diffTools(base, fetchToolFile(slug, to));
  const server = diff.newPlugin
    ? serverRow(slug, jsonAt(to, `plugins/${slug}/datatorag.json`), jsonAt(to, `plugins/${slug}/package.json`))
    : null;
  const files = changeFiles(slug, from, to, diff, server, { forced });
  if (!files) {
    console.log(`${slug}: no registry row changes between ${from} and ${to} (${diff.toCount} tools). No file written.`);
    return;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "forward.sql"), files.forward);
  writeFileSync(join(out, "rollback.sql"), files.rollback);
  if (diff.newPlugin) console.log(`${slug}: a NEW plugin${forced ? " (--new-plugin)" : ""}. The forward file inserts its mcp_servers row first.`);
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
