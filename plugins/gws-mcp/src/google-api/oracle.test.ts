import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METHOD_TABLE } from "./method-table.js";
import { buildRequest } from "./request.js";

/* THE MIGRATION PROOF (SCRUM-289).
 *
 * The pinned gws CLI reads the same Discovery documents this table was
 * generated from and, under --dry-run, reports the request it would have
 * sent. For every method, the verb, URL, query pairs and JSON body the new
 * client builds must equal the CLI's. It runs over the WHOLE table, and then
 * proves that every (service, resource, method) tuple src/tools calls is in
 * that set, by reading the source rather than a hand-kept list: a call site
 * added later is covered without anyone remembering to list it.
 *
 * The CLI is a development dependency for exactly this test. It is not
 * skipped when the binary is missing: a skipped oracle reads as a passed one. */

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

function binary(): string {
  const dir =
    process.platform === "darwin"
      ? process.arch === "arm64" ? "gws-aarch64-apple-darwin" : "gws-x86_64-apple-darwin"
      : "gws-x86_64-unknown-linux-gnu";
  const p = path.join(root, "bin", dir, "gws");
  if (!existsSync(p)) {
    throw new Error(`The oracle needs the pinned gws CLI at ${p}. Run: npm run download-binaries`);
  }
  return p;
}

interface DryRun {
  method: string;
  url: string;
  query_params: Array<[string, string]>;
  body: unknown;
  is_multipart_upload: boolean;
}

// The CLI refuses an --upload path outside its working directory.
const cwd = realpathSync(mkdtempSync(path.join(os.tmpdir(), "gws-oracle-")));
writeFileSync(path.join(cwd, "m.eml"), "Subject: x\r\n\r\nhi\r\n");

async function cliDryRun(
  service: string,
  key: string,
  params: Record<string, unknown>,
  body: unknown,
  upload: boolean
): Promise<DryRun> {
  const parts = key.split(".");
  const args = [service, ...parts, "--params", JSON.stringify(params), "--dry-run"];
  if (body !== undefined) args.push("--json", JSON.stringify(body));
  if (upload) args.push("--upload", path.join(cwd, "m.eml"), "--upload-content-type", "message/rfc822");
  const { stdout } = await exec(binary(), args, {
    cwd,
    env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: "oracle-dummy" },
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout) as DryRun;
}

/** Parameters that exercise every rule at once: a path value with a slash, a
 * space and reserved characters; every repeated parameter as a two-element
 * array; every required query parameter; one scalar of each JSON type; and an
 * array on a parameter the API does NOT mark repeated. */
function sampleParams(entry: (typeof METHOD_TABLE)[string]["methods"][string]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const name of entry.pathParams) params[name] = `${name}/a b!:é-._~*()@+,;=$`;
  for (const name of entry.repeated) if (!entry.pathParams.includes(name)) params[name] = ["one 1", "two&2"];
  for (const name of entry.requiredQuery) if (!(name in params)) params[name] = "req=uired";
  params.zzOracleFlag = true;
  params.zzOracleCount = 7;
  params.zzOracleText = "a&b=c d";
  params.aaOracleList = ["x", "y"];
  return params;
}

const ALL = Object.entries(METHOD_TABLE).flatMap(([service, svc]) =>
  Object.entries(svc.methods).map(([key, entry]) => ({ service, key, entry }))
);

function toolTuples(): string[] {
  // Every directory whose code calls the client: the tools, and the
  // attachment resolver and byte sources they use (SCRUM-279).
  const dirs = ["tools", "attachments"].map((d) => path.join(root, "src", d));
  const found = new Set<string>();
  let callSites = 0;
  let literalSites = 0;
  for (const [dir, file] of dirs.flatMap((d) => readdirSync(d).map((f) => [d, f] as const))) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file.includes("test-helper")) continue;
    const source = readFileSync(path.join(dir, file), "utf8");
    callSites += (source.match(/\.(?:api|upload|download)\(/g) ?? []).length;
    // upload and download are the media primitives on the same client; a
    // tool that calls one names a tuple exactly as api() does.
    for (const m of source.matchAll(/\.(?:api|upload|download)\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/g)) {
      literalSites++;
      found.add(`${m[1]} ${m[2]}.${m[3]}`);
    }
  }
  // The client itself addresses a few methods by name for the media paths
  // (the attachment read, the Drive upload). They count too.
  const clientSource = readFileSync(path.join(root, "src", "gws-client.ts"), "utf8");
  for (const m of clientSource.matchAll(
    /this\.(?:download|upload)\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/g
  )) {
    found.add(`${m[1]} ${m[2]}.${m[3]}`);
  }
  // Exactly one call site is allowed to be dynamic: gws_run, which forwards
  // the caller's own names. A second one would be a tuple this test cannot
  // see, so it fails here rather than passing quietly.
  expect(callSites - literalSites).toBe(1);
  return [...found].sort();
}

describe("oracle: the new client builds the request the pinned CLI builds", () => {
  it("for every method in the table, with and without a body", async () => {
    const mismatches: string[] = [];
    let checked = 0;
    const queue = [...ALL];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { service, key, entry } = item;
        const dot = key.lastIndexOf(".");
        const params = sampleParams(entry);
        const body = entry.hasBody ? {} : undefined;
        const cli = await cliDryRun(service, key, params, body, false);
        const ours = buildRequest(service, key.slice(0, dot), key.slice(dot + 1), { params, jsonBody: body });
        const a = JSON.stringify([cli.method, cli.url, cli.query_params, cli.body ?? null]);
        const b = JSON.stringify([ours.method, ours.url, ours.queryParams, ours.body ?? null]);
        if (a !== b) mismatches.push(`${service} ${key}\n  cli : ${a}\n  ours: ${b}`);
        checked++;
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    expect(mismatches).toEqual([]);
    expect(checked).toBe(ALL.length);
    expect(checked).toBeGreaterThan(200);
  }, 300_000);

  it("for every method that accepts media, the upload URL matches too", async () => {
    const withMedia = ALL.filter((m) => m.entry.mediaUpload?.simple);
    expect(withMedia.length).toBeGreaterThan(5);
    const mismatches: string[] = [];
    for (const { service, key, entry } of withMedia) {
      const dot = key.lastIndexOf(".");
      const params: Record<string, unknown> = {};
      for (const name of entry.pathParams) params[name] = `${name}-1`;
      const cli = await cliDryRun(service, key, params, entry.hasBody ? {} : undefined, true);
      const ours = buildRequest(service, key.slice(0, dot), key.slice(dot + 1), { params, upload: true });
      if (cli.url !== ours.url || cli.method !== ours.method || cli.is_multipart_upload !== true) {
        mismatches.push(`${service} ${key}: cli ${cli.method} ${cli.url} / ours ${ours.method} ${ours.url}`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 120_000);

  it("covers every (service, resource, method) tuple src/tools calls", () => {
    const tuples = toolTuples();
    const table = new Set(ALL.map((m) => `${m.service} ${m.key}`));
    expect(tuples.filter((t) => !table.has(t))).toEqual([]);
    // A floor, so an enumeration that silently finds nothing cannot pass.
    expect(tuples.length).toBeGreaterThanOrEqual(56);
  });

  it("a repeated parameter survives as a repeated key, real bodies pass through untouched", async () => {
    const params = { spreadsheetId: "S1", ranges: ["Tab 1!A1:B2", "Totals!A1"], majorDimension: "ROWS" };
    const cli = await cliDryRun("sheets", "spreadsheets.values.batchGet", params, undefined, false);
    const ours = buildRequest("sheets", "spreadsheets.values", "batchGet", { params });
    expect(ours.queryParams).toEqual(cli.query_params);
    expect(ours.queryParams.filter(([k]) => k === "ranges")).toEqual([
      ["ranges", "Tab 1!A1:B2"],
      ["ranges", "Totals!A1"],
    ]);

    const body = { raw: "SGk", threadId: "t1" };
    const cliSend = await cliDryRun("gmail", "users.messages.send", { userId: "me" }, body, false);
    const oursSend = buildRequest("gmail", "users.messages", "send", { params: { userId: "me" }, jsonBody: body });
    expect(oursSend.body).toEqual(cliSend.body);
    expect(oursSend.url).toBe(cliSend.url);
  }, 60_000);
});

process.on("exit", () => rmSync(cwd, { recursive: true, force: true }));
