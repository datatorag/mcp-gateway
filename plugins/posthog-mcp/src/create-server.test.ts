import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./create-server.js";
import { sessionContext } from "./session-context.js";

async function connected(headers: Record<string, string>) {
  const server = createMcpServer(sessionContext(headers));
  const c = new Client({ name: "t", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await c.connect(ct);
  return c;
}

const good = { "x-user-token": "pha_t", "x-posthog-host": "https://us.posthog.com", "x-posthog-project": "42" };
const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0].text);

afterEach(() => vi.unstubAllGlobals());

describe("the PostHog server", () => {
  it("lists the ten tools, all read-only", async () => {
    const { tools } = await (await connected(good)).listTools();
    expect(tools).toHaveLength(10);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("refuses every call from a session with a host it does not accept, sending nothing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await (await connected({ ...good, "x-posthog-host": "https://evil.example" })).callTool({ name: "posthog_project_get", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/region/);
    expect(result._meta).toEqual({ "datatorag.com/error": { kind: "refused" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an unknown tool and an unknown argument", async () => {
    const c = await connected(good);
    expect((await c.callTool({ name: "nope", arguments: {} }))._meta).toEqual({ "datatorag.com/error": { kind: "unknown_tool" } });
    const r = await c.callTool({ name: "posthog_project_get", arguments: { project_id: 7 } });
    expect(text(r)).toMatch(/Unknown argument: project_id/);
  });

  it("calls the project under the session's host with its token", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 42, name: "Acme" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const r = await (await connected(good)).callTool({ name: "posthog_project_get", arguments: {} });
    expect(JSON.parse(text(r))).toEqual({ id: 42, name: "Acme" });
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("https://us.posthog.com/api/projects/42/");
  });
});
