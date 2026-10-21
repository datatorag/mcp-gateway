/**
 * SCRUM-366: the gateway ships Notion's connect flow before the registry
 * holds Notion's tools. Until the `notion-mcp` server row exists and is
 * active, nothing may offer a Notion connect and the route refuses. Google
 * and Atlassian are offered with no check at all.
 */
import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@datatorag-mcp/db";
import { isServiceLaunched, launchedServiceIds } from "./service-launch";

const render = (cond: SQL | undefined) => new PgDialect().sqlToQuery(cond!);

/** A db whose mcp_servers read answers `rows` (as the database would after
 * applying the condition) and records the condition it was asked. */
function serversDb(rows: Array<{ slug: string }>) {
  const asked: SQL[] = [];
  const db = {
    select: vi.fn(() => ({
      from: () => ({
        where: (cond: SQL) => {
          asked.push(cond);
          return Promise.resolve(rows);
        },
      }),
    })),
  };
  return { db: db as unknown as Database, asked, select: db.select };
}

describe("launchedServiceIds", () => {
  it("leaves Notion out while no notion-mcp row is active, and keeps Google and Atlassian", async () => {
    const { db } = serversDb([]);
    const ids = await launchedServiceIds(db);
    expect(ids.has("notion")).toBe(false);
    expect(ids.has("google-workspace")).toBe(true);
    expect(ids.has("atlassian")).toBe(true);
  });

  it("asks only for an ACTIVE notion-mcp row", async () => {
    const { db, asked } = serversDb([]);
    await launchedServiceIds(db);
    expect(asked).toHaveLength(1);
    const { sql, params } = render(asked[0]);
    expect(sql).toMatch(/"status" = \$\d/);
    expect(params).toContain("active");
    expect(params).toContain("notion-mcp");
  });

  it("includes Notion once the active row exists", async () => {
    const { db } = serversDb([{ slug: "notion-mcp" }]);
    const ids = await launchedServiceIds(db);
    expect([...ids].sort()).toEqual(["atlassian", "google-workspace", "notion"]);
  });

  it("fails closed when the registry read throws: the gated service stays hidden, the others stay offered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = {
      select: () => ({
        from: () => ({ where: () => Promise.reject(new Error("connection reset")) }),
      }),
    } as unknown as Database;
    const ids = await launchedServiceIds(db);
    expect([...ids].sort()).toEqual(["atlassian", "google-workspace"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[service-launch]"), "Error");
    warn.mockRestore();
  });
});

describe("isServiceLaunched", () => {
  it("answers Google and Atlassian true without touching the database", async () => {
    const { db, select } = serversDb([]);
    expect(await isServiceLaunched(db, "google-workspace")).toBe(true);
    expect(await isServiceLaunched(db, "atlassian")).toBe(true);
    expect(select).not.toHaveBeenCalled();
  });

  it("answers Notion from the registry row", async () => {
    expect(await isServiceLaunched(serversDb([]).db, "notion")).toBe(false);
    expect(await isServiceLaunched(serversDb([{ slug: "notion-mcp" }]).db, "notion")).toBe(true);
  });

  it("answers an id that is not a connectable service false", async () => {
    const { db, select } = serversDb([{ slug: "notion-mcp" }]);
    expect(await isServiceLaunched(db, "dropbox")).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });
});
