/**
 * The runner's own tools/list keeps the annotations (SCRUM-326, reopened).
 *
 * E5 reads readOnlyHint from `ctx.rpc("tools/list")`, which is the runner
 * client's `listTools()`. That mapping kept only name and input schema, so on
 * prod E5 counted 0 of 115 plugin tools annotated while every registry row
 * held the hint and the server served it: the hint was lost in the runner,
 * after the wire. mcp-server.annotations.test.ts covers the server; this
 * covers the runner's path, through createRunnerClient itself.
 */

import { describe, it, expect, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

vi.mock("../track", () => ({
  trackToolCall: vi.fn().mockResolvedValue(undefined),
  trackSkillSearched: vi.fn().mockResolvedValue(undefined),
  trackSkillApplied: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../mcp-analytics", () => ({ trackMcpToolsListed: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../connected-accounts", () => ({ listConnectedAccounts: vi.fn().mockResolvedValue([]) }));
vi.mock("../connected-services", () => ({ listConnectedServiceIds: vi.fn().mockResolvedValue(new Set<string>()) }));
vi.mock("../user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([
    {
      namespacedName: "gws-mcp__gmail_search",
      description: "Search messages.",
      schema: { type: "object", properties: {} },
      requiredService: "google-workspace",
      readOnlyHint: true,
    },
    {
      namespacedName: "gws-mcp__gmail_send",
      description: "Send a message.",
      schema: { type: "object", properties: {} },
      requiredService: "google-workspace",
      readOnlyHint: false,
    },
  ]),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: vi.fn(),
}));
vi.mock("../admin", () => ({ isAdmin: vi.fn().mockResolvedValue(false) }));
vi.mock("../billing/enforce", () => ({ checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }) }));

import { createRunnerClient } from "./execute";
import type { ConnectionPool } from "../pool";

const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue([]) }) }) }),
} as unknown as Database;
const poolMock = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

describe("the runner's tools/list", () => {
  it("hands a case each plugin tool's readOnlyHint, as served", async () => {
    const client = await createRunnerClient(dbMock, poolMock, "user-1", "run-1");
    try {
      const tools = await client.listTools();
      const hint = (name: string) => tools.find((t) => t.name === name)?.annotations?.readOnlyHint;
      expect(hint("gws-mcp__gmail_search")).toBe(true);
      expect(hint("gws-mcp__gmail_send")).toBe(false);
    } finally {
      await client.close();
    }
  });
});
