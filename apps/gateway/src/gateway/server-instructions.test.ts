/**
 * SCRUM-466: the initialize instructions. Three lines, the providers that
 * have launched and no others, served on the MCP surface and not the
 * agent's; and the server says its tool list can change.
 */
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("./track", () => ({ trackToolCall: vi.fn(async () => undefined) }));
vi.mock("./mcp-analytics", () => ({ trackMcpToolsListed: vi.fn(async () => undefined) }));

import { serverInstructions } from "./server-instructions";
import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const ALL = ["google-workspace", "atlassian", "notion"];

describe("serverInstructions", () => {
  it("is three lines: the tools, the connection rule, connect first", () => {
    expect(serverInstructions(ALL)).toBe(
      [
        "DataToRAG gives you tools for the user's Google Workspace, Atlassian and Notion.",
        "Each provider's tools need that account connected first; until then they are not listed.",
        "Call `connect` first to see what is connected and to get a link for anything that is not.",
      ].join("\n")
    );
  });

  it("leaves out a provider that has not launched", () => {
    expect(serverInstructions(["google-workspace", "atlassian"]).split("\n")[0]).toBe(
      "DataToRAG gives you tools for the user's Google Workspace and Atlassian."
    );
  });

  it("carries no em-dash or en-dash", () => {
    expect(serverInstructions(ALL)).not.toMatch(/[–—]/);
  });
});

describe("initialize", () => {
  const pool = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

  async function initialized(opts: Parameters<typeof createMcpServer>[3]) {
    const server = createMcpServer("user-1", {} as Database, pool, opts);
    const client = new Client({ name: "c", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    return client;
  }

  it("gives the instructions on the MCP surface and declares that the tool list can change", async () => {
    const client = await initialized({ baseUrl: "https://gw.example", instructions: serverInstructions(ALL) });
    expect(client.getInstructions()).toBe(serverInstructions(ALL));
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(true);
  });

  it("gives none on the agent's surface", async () => {
    const client = await initialized({ surface: "agent", instructions: serverInstructions(ALL) });
    expect(client.getInstructions()).toBeUndefined();
  });
});
