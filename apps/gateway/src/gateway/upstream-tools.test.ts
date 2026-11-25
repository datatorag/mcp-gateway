/**
 * The tools a vendor's own MCP server lists (SCRUM-511), read from a
 * stand-in vendor: the SDK's own server over real HTTP, which records what
 * reached it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  LISTING_FRESH_MS,
  LISTING_STALE_MS,
  clearUpstreamListings,
  hasUpstreamCallRule,
  listUpstreamTools,
  supersededPlugin,
  upstreamCallMayChangeData,
  upstreamListingKey,
  upstreamUsageName,
  vendorConnectors,
  vendorServed,
} from "./upstream-tools";
import { startFakeVendor, type FakeVendor } from "../test-utils/fake-vendor";

let vendor: FakeVendor;
let served = ["exec"];

beforeAll(async () => {
  vendor = await startFakeVendor(
    (mcp) => {
      for (const name of served) {
        mcp.tool(name, `what ${name} does, in the vendor's words`, { command: z.string() }, async () => ({ content: [{ type: "text", text: "ok" }] }));
      }
    },
    (app) => {
      // Answers, but later than any deadline a test gives it.
      app.post("/mcp-slow", (_req, res) => void setTimeout(() => res.status(200).json({}), 600));
      app.post("/mcp-401", (_req, res) => void res.status(401).json({ error: "invalid_token" }));
    }
  );
});

afterAll(async () => {
  await vendor.close();
});

beforeEach(() => {
  clearUpstreamListings();
  vendor.seen.length = 0;
  served = ["exec"];
});

const KEY = upstreamListingKey("user-1", "posthog", "42");
const list = (opts: { path?: string; now?: number; key?: string; deadlineMs?: number } = {}) =>
  listUpstreamTools({
    key: opts.key ?? KEY,
    url: `${vendor.base}${opts.path ?? "/mcp"}`,
    token: "fixture-user-token",
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
  });
/** Requests that reached the vendor's `/mcp` since the last reset. */
const requests = () => vendor.seen.length;

describe("reading a vendor's tool list", () => {
  it("is the vendor's tools, with its descriptions and schemas, and the token reached it as a bearer and nothing else did", async () => {
    const tools = await list();
    expect(tools?.map((t) => t.name)).toEqual(["exec"]);
    expect(tools?.[0].description).toBe("what exec does, in the vendor's words");
    expect(tools?.[0].inputSchema).toMatchObject({ type: "object", properties: { command: { type: "string" } } });
    for (const headers of vendor.seen) {
      expect(headers.authorization).toBe("Bearer fixture-user-token");
      expect(headers["x-user-token"]).toBeUndefined();
      expect(Object.keys(headers).filter((h) => h.startsWith("x-posthog"))).toEqual([]);
    }
  });

  it("lists whatever the vendor lists: a tool it adds is there without a change of ours", async () => {
    served = ["exec", "another-tool"];
    expect((await list())?.map((t) => t.name)).toEqual(["exec", "another-tool"]);
  });

  it("serves a fresh listing from the cache, with no request to the vendor", async () => {
    await list({ now: 1_000 });
    const after = requests();
    served = ["changed"];
    expect((await list({ now: 1_000 + LISTING_FRESH_MS - 1 }))?.map((t) => t.name)).toEqual(["exec"]);
    expect(requests()).toBe(after);
  });

  it("serves an older listing at once and refreshes it behind, so the next list has the vendor's new tools", async () => {
    await list({ now: 1_000 });
    served = ["exec", "new-tool"];
    const stale = await list({ now: 1_000 + LISTING_FRESH_MS + 1 });
    expect(stale?.map((t) => t.name)).toEqual(["exec"]);
    await expect.poll(async () => (await list({ now: Date.now() }))?.map((t) => t.name)).toEqual(["exec", "new-tool"]);
  });

  it("keeps serving the listing in hand when a refresh fails", async () => {
    await list({ now: 1_000 });
    const stale = await list({ now: 1_000 + LISTING_FRESH_MS + 1, path: "/mcp-401" });
    expect(stale?.map((t) => t.name)).toEqual(["exec"]);
    await new Promise((r) => setTimeout(r, 100));
    expect((await list({ now: 1_000 + LISTING_FRESH_MS + 2, path: "/mcp-401" }))?.map((t) => t.name)).toEqual(["exec"]);
  });

  it("is null with nothing cached when the vendor refuses the token, is too slow, or is not there", async () => {
    expect(await list({ path: "/mcp-401" })).toBeNull();
    expect(await list({ path: "/mcp-slow", deadlineMs: 100 })).toBeNull();
    expect(await listUpstreamTools({ key: KEY, url: "http://127.0.0.1:9/mcp", token: "fixture-user-token" })).toBeNull();
  });

  it("drops a listing older than a day rather than serve it, and reads the vendor again", async () => {
    await list({ now: 1_000 });
    expect(await list({ now: 1_000 + LISTING_STALE_MS + 1, path: "/mcp-401" })).toBeNull();
  });

  it("keeps one listing per connection", async () => {
    await list();
    const before = requests();
    await list({ key: upstreamListingKey("user-2", "posthog", "42") });
    expect(requests()).toBeGreaterThan(before);
    expect(upstreamListingKey("u", "posthog", null)).not.toBe(upstreamListingKey("u", "posthog", "a"));
  });
});

describe("which connectors a vendor serves", () => {
  it("PostHog's tools are PostHog's own server's, under the posthog prefix, and its plugin is superseded", () => {
    expect(vendorConnectors().map((c) => [c.id, c.upstream.slug, c.upstream.url])).toEqual([
      ["posthog", "posthog", "https://mcp.posthog.com/mcp"],
    ]);
    expect(vendorServed("posthog")?.id).toBe("posthog");
    expect(vendorServed("posthog-mcp")).toBeUndefined();
    expect(vendorServed("gws-mcp")).toBeUndefined();
    expect(supersededPlugin("posthog-mcp")).toBe(true);
    expect(supersededPlugin("gws-mcp")).toBe(false);
    expect(supersededPlugin("posthog")).toBe(false);
  });
});

describe("what is recorded of a vendor tool call", () => {
  it("names the kind of call for a tool with a rule, and only the tool for any other", () => {
    expect(upstreamUsageName("posthog__exec", { command: 'call execute-sql {"query":"SELECT secret"}' })).toBe(
      "posthog__exec:call:execute-sql"
    );
    expect(upstreamUsageName("posthog__exec", { command: "search churned customers" })).toBe("posthog__exec:search");
    expect(upstreamUsageName("posthog__another-tool", { command: "anything" })).toBe("posthog__another-tool");
    expect(upstreamUsageName("constructor", {})).toBe("constructor");
  });

  it("says whether a call can change data only for a tool with a rule", () => {
    expect(hasUpstreamCallRule("posthog__exec")).toBe(true);
    expect(hasUpstreamCallRule("posthog__another-tool")).toBe(false);
    expect(hasUpstreamCallRule("toString")).toBe(false);
    expect(upstreamCallMayChangeData("posthog__exec", { command: "info project-get" })).toBe(false);
    expect(upstreamCallMayChangeData("posthog__exec", { command: "call project-get {}" })).toBe(true);
    expect(upstreamCallMayChangeData("posthog__another-tool", {})).toBeUndefined();
  });
});
