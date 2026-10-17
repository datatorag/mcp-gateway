/**
 * SCRUM-419, part 3: every public read of the tools table leaves gws_run
 * out. Each read's condition is captured and rendered to SQL, so the test
 * holds what the database is asked, not what a comment says.
 */

import { describe, it, expect, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@datatorag-mcp/db";

vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn(async () => "user-1") }));
const captured: { where?: SQL; join?: SQL } = {};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: (_t: unknown, on: SQL) => {
          captured.join = on;
          return { groupBy: () => ({ orderBy: () => Promise.resolve([]) }) };
        },
      }),
    }),
  },
}));

import { publicServerTools, publicToolCount } from "./public-tools";
import { GET as listServers } from "@/app/api/servers/route";

const render = (cond: SQL | undefined) => new PgDialect().sqlToQuery(cond!);

function capturingDb(rows: unknown[]) {
  const where = vi.fn((cond: SQL) => {
    captured.where = cond;
    return Promise.resolve(rows);
  });
  return {
    select: () => ({ from: () => ({ innerJoin: () => ({ where }), where }) }),
  } as unknown as Database;
}

function expectUnlisted(cond: SQL | undefined) {
  const { sql, params } = render(cond);
  expect(sql).toMatch(/"namespaced_name" not in \(/);
  expect(params).toContain("gws-mcp__gws_run");
}

describe("public reads of the tools table (SCRUM-419)", () => {
  it("the home and pricing count leaves gws_run out and keeps the active-server filter", async () => {
    expect(await publicToolCount(capturingDb([{ count: 76 }]))).toBe(76);
    expectUnlisted(captured.where);
    expect(render(captured.where).params).toContain("active");
  });

  it("/tools/<slug> leaves gws_run out of the server's list", async () => {
    await publicServerTools(capturingDb([]), "srv-1");
    expectUnlisted(captured.where);
    expect(render(captured.where).params).toContain("srv-1");
  });

  it("the servers listing leaves gws_run out of each server's count", async () => {
    const res = await listServers(new (await import("next/server")).NextRequest("http://localhost/api/servers"));
    expect(res.status).toBe(200);
    expectUnlisted(captured.join);
  });
});
