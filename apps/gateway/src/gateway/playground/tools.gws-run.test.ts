/**
 * SCRUM-419, part 3: the connections page's tool tester calls a plugin tool
 * directly, without the MCP listing, so it refuses gws_run itself for an
 * account that is not on the allowlist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const callPluginToolOnce = vi.fn();
vi.mock("../user-tools", () => ({
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: (...args: unknown[]) => callPluginToolOnce(...args),
}));
vi.mock("../service-token", () => ({
  PLUGIN_SERVICE_MAP: { "gws-mcp": "google-workspace" },
  getServiceToken: vi.fn().mockResolvedValue("tok"),
}));
const resolveUserEmail = vi.fn();
vi.mock("../user-email", () => ({
  resolveUserEmail: (...args: unknown[]) => resolveUserEmail(...args),
}));

import { executeUserTool, ToolCallError } from "./tools";

const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "s", containerPort: 40000, githubRepoUrl: null }]) }) }) }),
} as unknown as Database;
const ARGS = { service: "drive", resource: "files", method: "list" };

describe("executeUserTool and gws_run (SCRUM-419)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "listed@example.com";
    callPluginToolOnce.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });
  afterEach(() => {
    delete process.env.GWS_RUN_ALLOWED_ACCOUNTS;
  });

  it("an allowlisted account reaches the plugin", async () => {
    resolveUserEmail.mockResolvedValue("listed@example.com");
    await executeUserTool(db, "user-1", "gws-mcp__gws_run", ARGS);
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
  });

  it("an account that is not listed gets a 403 with the fixed message, and the plugin is never reached", async () => {
    resolveUserEmail.mockResolvedValue("someone@example.com");
    const err = await executeUserTool(db, "user-1", "gws-mcp__gws_run", ARGS).catch((e) => e);
    expect(err).toBeInstanceOf(ToolCallError);
    expect(err.status).toBe(403);
    expect(err.message).toBe(
      "gws_run is not available on this account; use the gmail_, calendar_, drive_, sheets_, docs_ or tasks_ tools."
    );
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("an empty variable refuses everyone", async () => {
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "";
    resolveUserEmail.mockResolvedValue("listed@example.com");
    await expect(executeUserTool(db, "user-1", "gws-mcp__gws_run", ARGS)).rejects.toMatchObject({ status: 403 });
  });

  it("other tools are untouched for an account that is not listed", async () => {
    resolveUserEmail.mockResolvedValue("someone@example.com");
    await executeUserTool(db, "user-1", "gws-mcp__drive_search", { query: "x" });
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
  });
});
