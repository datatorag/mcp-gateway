/**
 * SCRUM-419, part 3: the tool tester's list of a service's tools shows
 * gws_run only to an allowlisted account, as the MCP listing does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn(async () => "user-1") }));
const ROWS = ["drive_search", "gws_run", "gmail_search"].map((name) => ({
  name,
  namespacedName: `gws-mcp__${name}`,
  description: name,
  inputSchemaJson: {},
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve(ROWS) }) }) }),
    }),
  },
}));
const resolveUserEmail = vi.fn();
vi.mock("@/gateway/user-email", () => ({
  resolveUserEmail: (...args: unknown[]) => resolveUserEmail(...args),
}));

import { GET } from "./route";

async function listed(): Promise<string[]> {
  const res = await GET(new NextRequest("http://localhost/api/playground/tools?service=google-workspace"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tools: { namespacedName: string }[] };
  return body.tools.map((t) => t.namespacedName);
}

describe("GET /api/playground/tools and gws_run (SCRUM-419)", () => {
  beforeEach(() => {
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "listed@example.com";
  });
  afterEach(() => {
    delete process.env.GWS_RUN_ALLOWED_ACCOUNTS;
  });

  it("lists it for an allowlisted account", async () => {
    resolveUserEmail.mockResolvedValue("listed@example.com");
    expect(await listed()).toContain("gws-mcp__gws_run");
  });

  it("leaves it out for any other account, and keeps the rest", async () => {
    resolveUserEmail.mockResolvedValue("someone@example.com");
    expect(await listed()).toEqual(["gws-mcp__drive_search", "gws-mcp__gmail_search"]);
  });

  it("leaves it out for everyone when the variable is empty", async () => {
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "";
    resolveUserEmail.mockResolvedValue("listed@example.com");
    expect(await listed()).not.toContain("gws-mcp__gws_run");
  });
});
