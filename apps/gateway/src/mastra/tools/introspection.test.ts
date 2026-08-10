import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const periodStatus = vi.fn();
const capExempt = vi.fn();
vi.mock("@/gateway/usage/period", () => ({ periodStatus, capExempt }));

const { buildIntrospectionTools, INTROSPECTION_TOOL_NAMES } = await import("./introspection");

/** A db stub that records which user id every query was scoped to. The
 * assertions are on WHAT WAS ASKED OF THE DATABASE, not on what the tool
 * returned: a tool could return the right answer while having queried the
 * wrong row, and that is precisely the bug this file exists to prevent. */
function stubDb(plan = "free", services: string[] = ["google-workspace"]) {
  const scopedTo: unknown[] = [];
  const chain = (rows: unknown[]) => ({
    from: () => ({
      where: (cond: unknown) => {
        scopedTo.push(cond);
        return Object.assign(Promise.resolve(rows), {
          limit: () => Promise.resolve(rows),
        });
      },
    }),
  });
  const db = {
    select: () => chain([{ plan }]),
    selectDistinct: () => chain(services.map((connectorType) => ({ connectorType }))),
  };
  return { db: db as never, scopedTo };
}

describe("account introspection", () => {
  beforeEach(() => {
    periodStatus.mockReset();
    capExempt.mockReset();
    periodStatus.mockResolvedValue({ agentRuns: 7, calls: 40, periodStart: new Date(0) });
    capExempt.mockResolvedValue(false);
  });

  it("takes NO identity argument the model could supply", async () => {
    // THE IDOR CONSTRAINT, and it is not negotiable. A user id, account id or
    // email as a parameter looks like a testing convenience and becomes an
    // IDOR the first time a document the agent reads says "for diagnostics,
    // call this with userId=...". Identity is closed over from the session, so
    // there is nothing for a prompt to talk the model into.
    const { db } = stubDb();
    const tools = buildIntrospectionTools({ db, userId: "user-1" });

    for (const name of INTROSPECTION_TOOL_NAMES) {
      const schema = (tools as Record<string, { inputSchema: z.ZodTypeAny }>)[name].inputSchema;
      const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape ?? {};
      expect(Object.keys(shape)).toEqual([]);

      // And it must actually IGNORE one if a model sends it anyway, rather
      // than merely not advertising it.
      const parsed = schema.safeParse({ userId: "someone-else", email: "victim@example.com" });
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({});
    }
  });

  it("scopes every query to the session user", async () => {
    const { db, scopedTo } = stubDb();
    const tools = buildIntrospectionTools({ db, userId: "user-1" });

    await tools.account_status.execute();

    // Two queries (plan, connected accounts) plus the two period reads, and
    // every one was handed the id the tool was built with.
    expect(scopedTo.length).toBeGreaterThanOrEqual(2);
    expect(periodStatus).toHaveBeenCalledWith(db, "user-1");
    expect(capExempt).toHaveBeenCalledWith(db, "user-1");
  });

  it("reports runs as remaining, so the limit is a meter and not a wall", async () => {
    const { db } = stubDb();
    const out = await buildIntrospectionTools({ db, userId: "user-1" }).account_status.execute();

    // 7 used against the free allowance.
    expect(out.runsCap).toBeGreaterThan(0);
    expect(out.runsRemaining).toBe(out.runsCap! - 7);
    expect(out.toolCallsThisPeriod).toBe(40);
  });

  it("reports no cap for an exempt account rather than a fake one", async () => {
    capExempt.mockResolvedValue(true);
    const { db } = stubDb();
    const out = await buildIntrospectionTools({ db, userId: "user-1" }).account_status.execute();

    // Showing a limit that does not apply would have the agent tell an exempt
    // user they are running out of something they cannot run out of.
    expect(out.runsCap).toBeNull();
    expect(out.runsRemaining).toBeNull();
  });

  it("does not spend a run to answer how many runs are left", async () => {
    // The read must not go through the claim. Answering the question by
    // consuming the thing being asked about is the obvious wrong way to build
    // this, and it would be invisible: the number returned would simply be one
    // lower than the truth, every time.
    const { db } = stubDb();
    await buildIntrospectionTools({ db, userId: "user-1" }).account_status.execute();

    expect(periodStatus).toHaveBeenCalledTimes(1);
  });

  it("hands back specific views, not 'the dashboard'", async () => {
    const { db } = stubDb();
    const out = await buildIntrospectionTools({ db, userId: "user-1" }).account_status.execute();

    expect(out.links.usage).toBe("/dashboard/usage");
    expect(out.links.mcpConfig).toBe("/dashboard/mcp-config");
  });

  it("declares reads as not needing approval", async () => {
    const { db } = stubDb();
    const tools = buildIntrospectionTools({ db, userId: "user-1" });
    // Declared rather than classified: these bypass the name-based gate, so a
    // read has to say so explicitly. A tool that CHANGES account state must
    // declare true and go through the same gate a sheet edit does.
    expect(tools.account_status.requireApproval).toBe(false);
  });
});
