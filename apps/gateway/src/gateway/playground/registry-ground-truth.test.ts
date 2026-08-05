import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpServers, tools as toolsTable } from "@datatorag-mcp/db";
import { getDb } from "@/lib/db";

/**
 * The one assertion in this repository that touches ground truth.
 *
 * Everything else compares two records we maintain: the snapshot against the
 * registry, the registry against our own classification. Those are both
 * DERIVED from the plugin, and a consistency check between two derived
 * artifacts cannot detect drift from the source they both derive from. They
 * agree with each other while both being wrong, and nothing goes red.
 *
 * That is not hypothetical. Seven tools shipped in the plugin, were never
 * re-discovered into the registry, and stayed invisible to every user — while
 * the snapshot-versus-registry check passed the whole time, because the
 * snapshot was missing exactly the same seven. Two stale records in perfect
 * agreement. The registry also kept advertising two tools the plugin had
 * withheld, for the same reason and in the same silence.
 *
 * So this asks the plugin itself. `listTools()` over the same transport
 * `discoverTools` uses is the only thing here that is not our own bookkeeping.
 *
 * WHY IT IS ENV-GATED, and why that is a real limitation rather than a
 * detail: it needs a running plugin process, which exists in the deployed
 * container and not on a laptop. Set PLUGIN_MCP_URLS to run it, e.g.
 * `PLUGIN_MCP_URLS='gws-mcp=http://localhost:40000/mcp'`. Skipped otherwise.
 *
 * Skipped is not passed. A check that has never run is not evidence, and this
 * repository has no CI, so nothing runs it unless a person does. Until that
 * changes, treat this as a tool to reach for during a plugin rollout rather
 * than as a net that catches anything on its own.
 */

/** `slug=url,slug=url` — one entry per plugin whose endpoint is reachable. */
function pluginEndpoints(): Array<[string, string]> {
  const raw = process.env.PLUGIN_MCP_URLS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf("=");
      // Reject rather than salvage. Without this, `slug=` is missing and the
      // entry silently becomes a lookup for a server that does not exist,
      // which then fails as "every tool is undiscovered" — a frightening
      // diff that is really a typo in an env var.
      if (index === -1) {
        throw new Error(
          `PLUGIN_MCP_URLS entry is missing "=": ${JSON.stringify(pair)}`
        );
      }
      return [pair.slice(0, index).trim(), pair.slice(index + 1).trim()] as [
        string,
        string,
      ];
    })
    .filter(([slug, url]) => slug && url);
}

async function liveToolNames(url: string): Promise<string[]> {
  const client = new Client(
    { name: "registry-ground-truth", version: "0.1.0" },
    { capabilities: {} }
  );
  const transport = new StreamableHTTPClientTransport(new URL(url));
  try {
    await client.connect(transport);
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name).sort();
  } finally {
    await client.close().catch(() => {});
  }
}

const endpoints = pluginEndpoints();

describe.runIf(endpoints.length > 0 && !!process.env.DATABASE_URL)(
  "registry vs the plugin itself",
  () => {
    it.each(endpoints)(
      "%s: the registry lists exactly what the plugin serves",
      async (slug, url) => {
        const rows = await getDb()
          .select({ name: toolsTable.name })
          .from(toolsTable)
          .innerJoin(mcpServers, eq(toolsTable.mcpServerId, mcpServers.id))
          .where(
            and(eq(mcpServers.slug, slug), eq(toolsTable.enabled, true))
          );

        const registered = new Set(rows.map((row) => row.name));
        const live = new Set(await liveToolNames(url));

        // Named separately so the failure says which way the drift runs.
        // `undiscovered` is a tool the plugin ships that no user can see,
        // because tool visibility reads the registry. `phantom` is a tool we
        // advertise that no longer exists, which fails only after someone has
        // relied on it.
        const undiscovered = [...live].filter((n) => !registered.has(n)).sort();
        const phantom = [...registered].filter((n) => !live.has(n)).sort();

        expect({ undiscovered, phantom }).toEqual({
          undiscovered: [],
          phantom: [],
        });
      },
      30_000
    );
  }
);
