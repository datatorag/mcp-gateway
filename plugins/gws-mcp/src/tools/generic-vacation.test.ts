import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../create-server.js";
import { GwsClient } from "../gws-client.js";

/* SCRUM-457: changing the Gmail vacation responder needs a scope the gateway
 * does not request, so gws_run refuses updateVacation before any request.
 * Reading it works under the scope held, so getVacation still goes to Google,
 * as does every other users.settings method. Through the MCP server
 * against a stubbed fetch, so "no request" is a count of fetch calls. */

const TOKEN = "fixture-bearer-not-a-real-token";

async function gwsRun(args: Record<string, unknown>) {
  const server = createMcpServer(new GwsClient({ accessToken: TOKEN }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return (await mcp.callTool({ name: "gws_run", arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gws_run and the Gmail vacation responder (SCRUM-457)", () => {
  it("updateVacation is refused with the reason, and nothing is sent", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const res = await gwsRun({
      service: "gmail",
      resource: "users.settings",
      method: "updateVacation",
      params: { userId: "me" },
      json_body: { enableAutoReply: true },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(
      "Changing the Gmail vacation responder is not supported: it needs a Google scope DataToRAG does not request."
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("getVacation still goes to Google: reading works under the scope held", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ enableAutoReply: false }), { status: 200 }));
    const res = await gwsRun({ service: "gmail", resource: "users.settings", method: "getVacation", params: { userId: "me" } });
    expect(res.isError).toBeFalsy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("/gmail/v1/users/me/settings/vacation");
  });

  it("another users.settings method still goes to Google", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ language: { displayLanguage: "en" } }), { status: 200 }));
    const res = await gwsRun({ service: "gmail", resource: "users.settings", method: "getLanguage", params: { userId: "me" } });
    expect(res.isError).toBeFalsy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("/gmail/v1/users/me/settings/language");
  });
});
