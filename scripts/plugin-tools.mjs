#!/usr/bin/env node
// Ask a running plugin for the tools it SERVES and print them as one JSON
// document (SCRUM-390). The served list, not the source array: a plugin can
// withhold a tool it defines.
//
//   node scripts/plugin-tools.mjs <mcp url>            # prints the tool file
//   node scripts/plugin-tools.mjs --compare <a> <b>    # exit 1 unless equal
//
// The tool file is what a registry row is made from, and nothing else:
//   { "tools": [ { name, description, inputSchema, readOnlyHint } ] }
// sorted by name, so two files from the same plugin compare byte for byte.
// `readOnlyHint` is true, false, or null when the plugin did not say.
//
// It speaks plain MCP over Streamable HTTP with fetch, so it needs no install
// and runs on a CI runner as it is. The token it sends is a dummy: listing
// tools never calls a provider.
import { readFileSync } from "node:fs";

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "x-user-token": "tool-listing-dummy",
};

/** A JSON-RPC answer arrives as JSON or as one SSE `data:` line. */
async function answerOf(res) {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    if (data.length === 0) throw new Error("an event stream with no data line");
    return JSON.parse(data[data.length - 1]);
  }
  return JSON.parse(text);
}

export function toToolFile(tools) {
  const rows = tools.map((t) => ({
    name: t.name,
    description: t.description ?? null,
    inputSchema: t.inputSchema ?? null,
    readOnlyHint: typeof t.annotations?.readOnlyHint === "boolean" ? t.annotations.readOnlyHint : null,
  }));
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const names = new Set(rows.map((r) => r.name));
  if (names.size !== rows.length) throw new Error("the plugin served the same tool name twice");
  return { tools: rows };
}

export async function listServedTools(url) {
  let id = 0;
  const session = {};
  const call = async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...HEADERS, ...session },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) session["mcp-session-id"] = sid;
    const answer = await answerOf(res);
    if (answer.error) throw new Error(`${method}: ${JSON.stringify(answer.error).slice(0, 200)}`);
    return answer.result;
  };
  const init = await call("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "plugin-tools", version: "1" },
  });
  if (init?.protocolVersion) session["mcp-protocol-version"] = init.protocolVersion;
  await fetch(url, {
    method: "POST",
    headers: { ...HEADERS, ...session },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(20_000),
  }).then((r) => r.arrayBuffer());

  const tools = [];
  let cursor;
  let pages = 0;
  do {
    // A plugin that always answers with another cursor must not hold the job.
    if (++pages > 50) throw new Error("tools/list did not end after 50 pages");
    const page = await call("tools/list", cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  if (tools.length === 0) throw new Error("the plugin served no tools");
  return toToolFile(tools);
}

/** What differs between two tool files, tool by tool. Empty means equal. */
export function compareToolFiles(a, b) {
  const out = [];
  const byName = (f) => new Map(f.tools.map((t) => [t.name, t]));
  const [ma, mb] = [byName(a), byName(b)];
  for (const name of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
    const [ta, tb] = [ma.get(name), mb.get(name)];
    if (!ta) out.push(`${name}: only in the second`);
    else if (!tb) out.push(`${name}: only in the first`);
    else {
      for (const field of ["description", "inputSchema", "readOnlyHint"]) {
        if (JSON.stringify(ta[field]) !== JSON.stringify(tb[field])) out.push(`${name}: ${field} differs`);
      }
    }
  }
  return out;
}

async function main(argv) {
  if (argv[0] === "--compare") {
    const [a, b] = [argv[1], argv[2]].map((p) => JSON.parse(readFileSync(p, "utf8")));
    const diff = compareToolFiles(a, b);
    for (const line of diff) console.log(line);
    console.log(
      diff.length === 0
        ? `equal: ${a.tools.length} tools, name, description, schema and read-only hint`
        : `${diff.length} difference(s) across ${a.tools.length} and ${b.tools.length} tools`
    );
    process.exit(diff.length === 0 ? 0 : 1);
  }
  if (!argv[0]) {
    console.error("usage: plugin-tools.mjs <mcp url> | --compare <file> <file>");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(await listServedTools(argv[0]), null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`plugin-tools: ${err.message}`);
    process.exit(1);
  });
}
