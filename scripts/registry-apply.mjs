#!/usr/bin/env node
// Runs ONE registry change file against the database, for the `apply` job of
// .github/workflows/registry.yml, after the production environment's
// approval (SCRUM-423).
//
//   REGISTRY_DATABASE_URL=... node scripts/registry-apply.mjs <file> <sha256>
//
// What it does, in order, and stops at the first thing that is not right:
//   1. Reads the file, computes its sha256, and compares it with the one the
//      run was dispatched for. The approval was given for that sha256.
//   2. Checks the text again with scripts/registry-file-check.mjs: the same
//      code, at the same commit, as the request job ran.
//   3. Connects as the restricted role, confirms the session reads string
//      literals the way the check did (standard_conforming_strings on),
//      and sends the file's exact bytes as ONE simple query. Not prepared,
//      not split, not through the command-line client, which acts on
//      backslash commands of its own.
//   4. Prints the rows the file's closing read returns, and nothing else
//      from the database except the generator's own guard messages (a new
//      plugin's file has three more, for its mcp_servers row).
//
// NOTHING ABOUT THE CONNECTION IS PRINTED: not the string, not the host, not
// a raw server or network error, which can quote either. A failure prints a
// fixed sentence and the error's SQLSTATE code. The one exception is a guard
// that raised: its message is written by the file (checked to be the
// generator's), so it is shown, because it says which row was not as
// expected and that the whole transaction rolled back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { checkRegistryFile, Refusal, requestLines, sha256Of } from "./registry-file-check.mjs";

/** The driver the gateway already depends on, resolved from the db package
 * so it is the one the lockfile pins. */
function loadDriver() {
  const require = createRequire(new URL("../packages/db/package.json", import.meta.url));
  return require("postgres");
}

/** Raised by the file's own guards (plpgsql RAISE EXCEPTION). */
const RAISED = "P0001";

/** The messages the generator's guards raise, filled in. A tool row's; a new
 * plugin's server row (SCRUM-366): its insert, its port check, its delete;
 * and the row count. */
const GUARD_MESSAGES = [
  /^(forward|rollback) [A-Za-z0-9_.-]+: expected 1 row, (updated|inserted|deleted) \d+$/,
  /^forward mcp_servers [a-z0-9][a-z0-9-]*: expected 1 row, inserted \d+$/,
  /^forward mcp_servers [a-z0-9][a-z0-9-]*: expected 1 row on its port, found \d+$/,
  /^rollback mcp_servers [a-z0-9][a-z0-9-]*: expected 1 row, deleted \d+$/,
  /^rows for [a-z0-9-]+: expected \d+, found \d+$/,
];

/**
 * The whole run, with the database injected so it can be tested without
 * one. `connect(url)` returns a postgres.js-shaped `sql`. Returns an exit
 * code and the lines to print; never throws with anything from the server.
 */
export async function applyRegistryFile({ path, text, sha256, url, connect }) {
  const out = [];
  if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) return { code: 2, out: ["The sha256 must be 64 lowercase hex characters."] };
  if (sha256Of(text) !== sha256) {
    return { code: 1, out: [`Refused: ${path} has sha256 ${sha256Of(text)}, not the ${sha256} that was approved. Nothing was run.`] };
  }
  let result;
  try {
    result = checkRegistryFile(text);
  } catch (err) {
    if (err instanceof Refusal) return { code: 1, out: [`Refused: ${err.message}. Nothing was run.`] };
    throw err;
  }
  out.push(...requestLines(path, text, result));
  if (!url) return { code: 1, out: [...out, "The production environment has no registry connection yet. Nothing was run."] };

  let sql;
  try {
    sql = connect(url);
    const [{ standard_conforming_strings: scs }] = await sql.unsafe("SHOW standard_conforming_strings").simple();
    if (scs !== "on") {
      return { code: 1, out: [...out, "Refused: the session does not read string literals as the check did (standard_conforming_strings is not on). Nothing was run."] };
    }
    const results = await sql.unsafe(text).simple();
    // One result per statement; the closing read is the one with rows.
    const rows = [...results].reverse().find((r) => Array.isArray(r) && r.length > 0) ?? [];
    out.push("", "Applied. The rows as they are now:");
    for (const r of rows) {
      out.push(`  ${r.name}  description_md5=${r.description_md5}  schema_md5=${r.schema_md5}  read_only_hint=${r.read_only_hint}  updated_at=${r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at}`);
    }
    if (rows.length === 0) out.push("  (none: the file removed every row it names)");
    return { code: 0, out };
  } catch (err) {
    const code = typeof err?.code === "string" && /^[0-9A-Z]{5}$/.test(err.code) ? err.code : "none";
    if (code === RAISED && typeof err.message === "string" && GUARD_MESSAGES.some((re) => re.test(err.message))) {
      return { code: 1, out: [...out, `A guard stopped the change and the whole transaction rolled back: ${err.message}`] };
    }
    return { code: 1, out: [...out, `The change did not run to the end and was not committed (SQLSTATE ${code}). The error itself is not printed, because it can quote the connection.`] };
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => {});
  }
}

async function main(argv) {
  const [path, sha256] = argv;
  if (!path) {
    console.error("usage: registry-apply.mjs <file> <sha256>");
    return 2;
  }
  const postgres = loadDriver();
  const { code, out } = await applyRegistryFile({
    path,
    text: readFileSync(path, "utf8"),
    sha256,
    url: process.env.REGISTRY_DATABASE_URL,
    connect: (url) =>
      postgres(url, {
        max: 1,
        prepare: false,
        onnotice: () => {},
        connection: { application_name: "registry-workflow", standard_conforming_strings: "on" },
      }),
  });
  console.log(out.join("\n"));
  return code;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
