// Env-gated end-to-end harness for the MCP front door (`/mcp`).
//
// This suite talks to a REAL running gateway over Streamable HTTP — it is not
// a unit test and does not stub the DB, auth, or backend plugins. It only
// runs when MCP_E2E_URL is set (see e2e/README.md for the full env contract
// and how to bootstrap a local token). With no env set, every test here is
// skipped and the file exits 0 — `pnpm vitest run` (the unit suite) never
// picks this file up at all because it lives outside vitest.config.ts's
// `include: ["src/**/*.test.ts"]` glob.
//
// Reality check performed before writing this file:
// - Auth is `Authorization: Bearer <oauth_access_tokens.token>` — confirmed
//   in apps/gateway/server.ts's `validateBearer` and by a live curl probe.
// - Tool names are namespaced as `${serverSlug}__${toolName}` via
//   NAMESPACE_SEPARATOR = "__" (apps/gateway/src/gateway/plugin-manager.ts),
//   split on first occurrence in mcp-server.ts's CallTool handler.
// - `echo` (arg: `message`, required) and `list_connected_accounts` are
//   always appended to the tool list unconditionally — they are NOT
//   namespaced and NOT gated by connected services.
// - Namespaced tools (e.g. `gws-mcp__gmail_search`) ARE gated by "lazy tool
//   loading": ListTools filters them out unless the calling user has a
//   connected account for that plugin's required service
//   (PLUGIN_SERVICE_MAP in service-token.ts). A fresh local dev DB has
//   neither the gws-mcp nor atlassian-mcp plugin installed, and even where a
//   plugin IS installed, an unconnected test user sees zero of its
//   namespaced tools. Hard-coding "at least 50 gws-mcp__ tools" (the brief's
//   starting assumption) is therefore environment- and account-shape
//   dependent, not a property of the gateway itself — Tier 1 below checks
//   the invariant that actually holds in every environment: the two
//   built-ins are always present, and any namespaced tool that IS present
//   follows the `slug__toolName` shape.

import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.env.MCP_E2E_URL;
const TOKEN = process.env.MCP_E2E_TOKEN;
const LIVE = process.env.MCP_E2E_LIVE === "1";
const ACCOUNT = process.env.MCP_E2E_ACCOUNT;

describe.runIf(!!URL_)("mcp e2e (gateway front door)", () => {
  async function connect(): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(`${URL_}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "mcp-e2e", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
  }

  it("initializes and lists the built-in tool registry", async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);

      // Always present, unconditionally, regardless of installed plugins or
      // which services this user has connected (mcp-server.ts's ListTools
      // handler appends these after the connected-service filter runs).
      expect(names).toContain("echo");
      expect(names).toContain("list_connected_accounts");

      // Any namespaced tool present must follow the load-bearing
      // `serverSlug__toolName` separator (NAMESPACE_SEPARATOR in
      // plugin-manager.ts) — this doesn't assert *which* plugins are
      // installed, since that's environment-specific.
      for (const name of names) {
        if (name === "echo" || name === "list_connected_accounts") continue;
        expect(name).toMatch(/^[^_]+(?:_[^_]+)*__.+$/);
      }
    } finally {
      await client.close();
    }
  });

  it("echo round-trips", async () => {
    const client = await connect();
    try {
      const res = await client.callTool({ name: "echo", arguments: { message: "e2e-ping" } });
      expect(JSON.stringify(res.content)).toContain("e2e-ping");
    } finally {
      await client.close();
    }
  });

  // Tier 2 refuses to run at all unless BOTH MCP_E2E_LIVE=1 and
  // MCP_E2E_ACCOUNT are set — MCP_E2E_LIVE alone is not enough. This is a
  // deliberate safety gate: it must never fall back to some default/founder
  // account. See README.md for the "DataToRAG-owned accounts only" rule.
  describe.runIf(LIVE && !!ACCOUNT)("tier 2: read-only live calls", () => {
    it("gws-mcp__gmail_search executes against the connected account", async () => {
      const client = await connect();
      try {
        const res = await client.callTool({
          name: "gws-mcp__gmail_search",
          arguments: { query: "newer_than:7d", account: ACCOUNT },
        });
        expect(res.isError ?? false).toBe(false);
      } finally {
        await client.close();
      }
    });
  });
});
