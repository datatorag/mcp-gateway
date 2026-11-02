import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BrevoClient } from "./brevo-client.js";
import { createMcpServer } from "./create-server.js";
import { allTools, toolReadOnly } from "./tools/index.js";

async function connected(client?: BrevoClient) {
  const server = createMcpServer(client);
  const c = new Client({ name: "t", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await c.connect(ct);
  return c;
}

describe("the Brevo server", () => {
  it("lists the twenty tools, each once, with its annotations", async () => {
    const { tools } = await (await connected()).listTools();
    expect(tools).toHaveLength(20);
    expect(new Set(tools.map((t) => t.name)).size).toBe(20);
    for (const t of tools) expect(typeof t.annotations?.readOnlyHint).toBe("boolean");
    expect(allTools).toHaveLength(20);
  });

  it("refuses an unknown tool with the unknown_tool meta", async () => {
    const result = await (await connected()).callTool({ name: "nope", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result._meta).toEqual({ "datatorag.com/error": { kind: "unknown_tool" } });
  });

  it("refuses a call with no token in words, as a refused request", async () => {
    const result = await (await connected()).callTool({ name: "account_get", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(/No Brevo access token reached this call/);
    expect(result._meta).toEqual({ "datatorag.com/error": { kind: "refused" } });
  });

  it("hands each tool a client scoped to its own read-only hint", async () => {
    const forTool = vi.spyOn(BrevoClient.prototype, "forTool");
    const c = await connected(new BrevoClient({ accessToken: "tok" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await c.callTool({ name: "account_get", arguments: {} });
    await c.callTool({ name: "contact_update", arguments: { identifier: "a@example.com", attributes: { A: 1 } } });
    expect(forTool.mock.calls.map((x) => x[0])).toEqual([true, false]);
    expect(toolReadOnly.get("campaign_send")).toBe(false);
    vi.unstubAllGlobals();
  });
});
