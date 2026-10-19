/**
 * SCRUM-419, part 3: the shared listing (MCP tools/list, the agent, the
 * playground's suggestions) drops gws_run for every account not on the
 * allowlist, and keeps every other tool.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const resolveUserEmail = vi.fn();
vi.mock("./user-email", () => ({
  resolveUserEmail: (...args: unknown[]) => resolveUserEmail(...args),
}));
vi.mock("./connected-services", () => ({
  listConnectedServiceIds: vi.fn().mockResolvedValue(new Set(["google-workspace"])),
}));

import { listUserToolRows } from "./user-tools";

const row = (name: string) => ({
  namespacedName: `gws-mcp__${name}`,
  description: name,
  inputSchemaJson: { type: "object", properties: {} },
  readOnlyHint: null,
  serverSlug: "gws-mcp",
});
const ROWS = [row("gmail_search"), row("gws_run"), row("drive_search")];
const db = {
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(ROWS) }) }) }),
} as unknown as Database;

const names = async () => (await listUserToolRows(db, "user-1")).map((r) => r.namespacedName);

describe("listUserToolRows and gws_run (SCRUM-419)", () => {
  beforeEach(() => {
    resolveUserEmail.mockReset();
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "listed@example.com";
  });
  afterEach(() => {
    delete process.env.GWS_RUN_ALLOWED_ACCOUNTS;
  });

  it("an allowlisted account sees gws_run with every other tool", async () => {
    resolveUserEmail.mockResolvedValue("listed@example.com");
    expect(await names()).toEqual(["gws-mcp__gmail_search", "gws-mcp__gws_run", "gws-mcp__drive_search"]);
  });

  it("an account that is not listed sees every tool but gws_run", async () => {
    resolveUserEmail.mockResolvedValue("someone@example.com");
    expect(await names()).toEqual(["gws-mcp__gmail_search", "gws-mcp__drive_search"]);
  });

  it("an empty variable hides it from everyone, listed email or not", async () => {
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "";
    resolveUserEmail.mockResolvedValue("listed@example.com");
    expect(await names()).not.toContain("gws-mcp__gws_run");
  });

  it("a failed email lookup hides it", async () => {
    resolveUserEmail.mockResolvedValue(null);
    expect(await names()).toEqual(["gws-mcp__gmail_search", "gws-mcp__drive_search"]);
  });
});
