import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CONNECTOR_REGISTRY, type ConnectorRecord, type UpstreamServer } from "./connectors/registry";
import { execMayChangeData, execUsageDetail } from "./connectors/posthog/exec-command";

/**
 * The tools a vendor's own MCP server lists (SCRUM-511): read from the
 * vendor with the user's token, cached, and never written to our registry.
 * What the vendor lists is what the user is listed, under the connector's
 * prefix; a tool the vendor adds or drops shows up here without a change of
 * ours.
 */

export interface UpstreamTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A connector whose tools the vendor's own server serves. */
export type VendorConnector = ConnectorRecord & { upstream: UpstreamServer };

const VENDORS = (CONNECTOR_REGISTRY as readonly ConnectorRecord[]).filter((c): c is VendorConnector => c.upstream !== undefined);

/** The connector whose vendor tools are named `<slug>__<tool>`, or undefined
 * when `slug` is a plugin's. */
export function vendorServed(slug: string): VendorConnector | undefined {
  return VENDORS.find((c) => c.upstream.slug === slug);
}

/** Every connector a vendor serves. */
export function vendorConnectors(): readonly VendorConnector[] {
  return VENDORS;
}

/** Whether a plugin's registry rows are superseded: the vendor serves that
 * connector now, so nothing of the plugin's is listed or started. */
export function supersededPlugin(pluginSlug: string): boolean {
  return VENDORS.some((c) => c.pluginSlug === pluginSlug);
}

// What is known about one call beyond its name, per vendor tool. A vendor
// tool with no entry here is recorded by its name alone and is always
// treated as able to change data.
const CALL_RULES: Record<string, { usageDetail(args: Record<string, unknown>): string; mayChangeData(args: Record<string, unknown>): boolean }> = {
  posthog__exec: { usageDetail: execUsageDetail, mayChangeData: execMayChangeData },
};

/** Whether a vendor tool has a rule that reads one call's arguments. */
export function hasUpstreamCallRule(namespacedName: string): boolean {
  return Object.hasOwn(CALL_RULES, namespacedName);
}

/** The name a usage event carries for a vendor tool call: the tool's name,
 * and for a tool with a rule, what kind of call it was. Never an argument's
 * value. */
export function upstreamUsageName(namespacedName: string, args: Record<string, unknown>): string {
  const rule = Object.hasOwn(CALL_RULES, namespacedName) ? CALL_RULES[namespacedName] : undefined;
  return rule ? `${namespacedName}:${rule.usageDetail(args)}` : namespacedName;
}

/** Whether this call to a vendor tool can change data, for a client of ours
 * that asks its user before a write. Undefined for a tool with no rule: the
 * caller's own default applies. */
export function upstreamCallMayChangeData(namespacedName: string, args: Record<string, unknown>): boolean | undefined {
  const rule = Object.hasOwn(CALL_RULES, namespacedName) ? CALL_RULES[namespacedName] : undefined;
  return rule?.mayChangeData(args);
}

/** A listing is served as is for this long. */
export const LISTING_FRESH_MS = 15 * 60_000;
/** After that it is still served, while a refresh runs, for this long. */
export const LISTING_STALE_MS = 24 * 60 * 60_000;
/** A read of the vendor's list never holds our own list longer than this. */
export const LISTING_DEADLINE_MS = 3_000;
/** A vendor's tool name: what MCP allows, kept short. */
const LISTED_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_LISTED_TOOLS = 2_000;

type Entry = { tools: UpstreamTool[]; fetchedAt: number; refreshing?: Promise<void> };
const cache = new Map<string, Entry>();

/** For tests. */
export function clearUpstreamListings(): void {
  cache.clear();
}

/** One `tools/list` on the vendor's server with the user's token as a
 * bearer and nothing else. Throws on any failure; the caller decides what
 * that means. Nothing is logged here: an error from the transport can carry
 * a header. */
async function readListing(url: string, token: string, deadlineMs: number): Promise<UpstreamTool[]> {
  const signal = AbortSignal.timeout(deadlineMs);
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "datatorag-mcp", version: "0.1.0" }, { capabilities: {} });
  try {
    await client.connect(transport, { signal });
    const listed: UpstreamTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { signal });
      for (const t of page.tools) {
        if (!LISTED_NAME.test(t.name) || t.inputSchema === null || typeof t.inputSchema !== "object") continue;
        listed.push({ name: t.name, description: typeof t.description === "string" ? t.description : "", inputSchema: t.inputSchema });
        if (listed.length >= MAX_LISTED_TOOLS) return listed;
      }
      cursor = page.nextCursor;
    } while (cursor);
    return listed;
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * The vendor's tools for one connection, from the cache when it has them.
 *
 * - Fresh: served as is.
 * - Older, up to a day: served as is, and a refresh starts in the
 *   background; if it fails, the listing keeps being served.
 * - Nothing cached, or older than a day: read now, within the deadline.
 *   Null when that fails: the caller lists nothing for this connector.
 *
 * `key` names the connection (a user's account for the service). The token
 * is used for the read and kept nowhere.
 */
export async function listUpstreamTools(opts: {
  key: string;
  url: string;
  token: string;
  now?: number;
  deadlineMs?: number;
}): Promise<UpstreamTool[] | null> {
  const now = opts.now ?? Date.now();
  const deadline = opts.deadlineMs ?? LISTING_DEADLINE_MS;
  const entry = cache.get(opts.key);
  const age = entry ? now - entry.fetchedAt : Infinity;
  if (entry && age < LISTING_FRESH_MS) return entry.tools;
  if (entry && age < LISTING_STALE_MS) {
    entry.refreshing ??= readListing(opts.url, opts.token, deadline)
      .then((tools) => {
        cache.set(opts.key, { tools, fetchedAt: Date.now() });
      })
      .catch(() => {
        // The listing in hand keeps being served; the next list tries again.
        entry.refreshing = undefined;
      });
    return entry.tools;
  }
  try {
    const tools = await readListing(opts.url, opts.token, deadline);
    cache.set(opts.key, { tools, fetchedAt: now });
    return tools;
  } catch {
    cache.delete(opts.key);
    return null;
  }
}

/** The cache key for a user's account on a service. */
export function upstreamListingKey(userId: string, service: string, accountEmail: string | null): string {
  return `${userId}\n${service}\n${accountEmail ?? ""}`;
}
