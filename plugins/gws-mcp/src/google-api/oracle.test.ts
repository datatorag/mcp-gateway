import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METHOD_TABLE } from "./method-table.js";
import { buildRequest } from "./request.js";
import { ORACLE_CASES, sampleParams, uploadParams } from "./oracle-samples.test-helper.js";

/* THE MIGRATION PROOF (SCRUM-289), NOW FROM A RECORDING (SCRUM-390).
 *
 * The gws CLI reads the same Discovery documents the method table was
 * generated from and, under --dry-run, reports the request it would have
 * sent. For every method, the verb, URL, query pairs and JSON body this
 * client builds must equal the CLI's. It runs over the WHOLE table, and then
 * proves that every (service, resource, method) tuple src/tools calls is in
 * that set, by reading the source rather than a hand-kept list: a call site
 * added later is covered without anyone remembering to list it.
 *
 * The CLI is gone from this repository. What it answered is kept in
 * oracle.fixtures.json: for each method, the parameters it was asked with
 * and the request it reported, recorded from the version the file names.
 * So nothing is downloaded and nothing is started.
 *
 * WHAT A RECORDING CANNOT DO. It cannot answer for a method or a parameter
 * it was never asked about. So the two sets are held equal, in both
 * directions, and the parameters are held equal too: a method added to the
 * table, or a method whose path, repeated or required parameters changed,
 * fails here by name instead of passing unchecked. The fix is then a new
 * recorded request for that method, taken from the API's Discovery document
 * and reviewed as what it is: the expected answer, written by a person.
 * The recorder that made this file is in the history of this test. */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

interface Recorded {
  method: string;
  url: string;
  query: Array<[string, string]>;
  body: unknown;
}
interface Fixtures {
  recordedFrom: string;
  methods: Record<
    string,
    {
      params: Record<string, unknown>;
      hasBody?: boolean;
      request: Recorded;
      upload?: { params: Record<string, unknown>; method: string; url: string };
    }
  >;
  cases: Record<string, { params: Record<string, unknown>; body: unknown; request: Recorded }>;
}

const FIXTURES = JSON.parse(readFileSync(path.join(here, "oracle.fixtures.json"), "utf8")) as Fixtures;

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

describe("oracle: this client builds the request the gws CLI was recorded building", () => {
  it("has a recorded request for exactly the methods in the table", () => {
    const table = ALL.map((m) => `${m.service} ${m.key}`).sort();
    const recorded = Object.keys(FIXTURES.methods).sort();
    expect(table.filter((k) => !(k in FIXTURES.methods))).toEqual([]);
    expect(recorded.filter((k) => !table.includes(k))).toEqual([]);
    expect(recorded.length).toBeGreaterThan(200);
    expect(FIXTURES.recordedFrom).toMatch(/^gws \d+\.\d+\.\d+$/);
  });

  it("for every method in the table, with and without a body", () => {
    const stale: string[] = [];
    const mismatches: string[] = [];
    let checked = 0;
    for (const { service, key, entry } of ALL) {
      const recorded = FIXTURES.methods[`${service} ${key}`];
      if (!recorded) continue; // named by the test above
      const dot = key.lastIndexOf(".");
      const params = sampleParams(entry);
      // The recording answers for these parameters and no others.
      if (JSON.stringify(params) !== JSON.stringify(recorded.params) || !!entry.hasBody !== !!recorded.hasBody) {
        stale.push(`${service} ${key}`);
        continue;
      }
      const body = entry.hasBody ? {} : undefined;
      const ours = buildRequest(service, key.slice(0, dot), key.slice(dot + 1), { params, jsonBody: body });
      const r = recorded.request;
      const a = JSON.stringify([r.method, r.url, r.query, r.body ?? null]);
      const b = JSON.stringify([ours.method, ours.url, ours.queryParams, ours.body ?? null]);
      if (a !== b) mismatches.push(`${service} ${key}\n  cli : ${a}\n  ours: ${b}`);
      checked++;
    }
    expect(stale).toEqual([]);
    expect(mismatches).toEqual([]);
    expect(checked).toBe(ALL.length);
    expect(checked).toBeGreaterThan(200);
  });

  it("for every method that accepts media, the upload URL matches too", () => {
    const withMedia = ALL.filter((m) => m.entry.mediaUpload?.simple);
    expect(withMedia.length).toBeGreaterThan(5);
    const recordedWithMedia = Object.entries(FIXTURES.methods)
      .filter(([, m]) => m.upload)
      .map(([k]) => k)
      .sort();
    expect(recordedWithMedia).toEqual(withMedia.map((m) => `${m.service} ${m.key}`).sort());
    const mismatches: string[] = [];
    for (const { service, key, entry } of withMedia) {
      const recorded = FIXTURES.methods[`${service} ${key}`]?.upload;
      const dot = key.lastIndexOf(".");
      const params = uploadParams(entry);
      const ours = buildRequest(service, key.slice(0, dot), key.slice(dot + 1), { params, upload: true });
      if (
        !recorded ||
        JSON.stringify(params) !== JSON.stringify(recorded.params) ||
        recorded.url !== ours.url ||
        recorded.method !== ours.method
      ) {
        mismatches.push(`${service} ${key}: cli ${recorded?.method} ${recorded?.url} / ours ${ours.method} ${ours.url}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("covers every (service, resource, method) tuple src/tools calls", () => {
    const tuples = toolTuples();
    const table = new Set(ALL.map((m) => `${m.service} ${m.key}`));
    expect(tuples.filter((t) => !table.has(t))).toEqual([]);
    // A floor, so an enumeration that silently finds nothing cannot pass.
    expect(tuples.length).toBeGreaterThanOrEqual(56);
  });

  it("a repeated parameter survives as a repeated key, real bodies pass through untouched", () => {
    const batchGet = ORACLE_CASES.repeatedParameter;
    const recorded = FIXTURES.cases.repeatedParameter;
    expect(recorded.params).toEqual(batchGet.params);
    const ours = buildRequest(batchGet.service, batchGet.resource, batchGet.method, { params: batchGet.params });
    expect(ours.queryParams).toEqual(recorded.request.query);
    expect(ours.queryParams.filter(([k]) => k === "ranges")).toEqual([
      ["ranges", "Tab 1!A1:B2"],
      ["ranges", "Totals!A1"],
    ]);

    const send = ORACLE_CASES.bodyPassesThrough;
    const recordedSend = FIXTURES.cases.bodyPassesThrough;
    expect(recordedSend.params).toEqual(send.params);
    expect(recordedSend.body).toEqual(send.body);
    const oursSend = buildRequest(send.service, send.resource, send.method, {
      params: send.params,
      jsonBody: send.body,
    });
    expect(oursSend.body).toEqual(recordedSend.request.body);
    expect(oursSend.url).toBe(recordedSend.request.url);
  });
});
