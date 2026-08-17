import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const periodStatus = vi.fn();
const agentRunCap = vi.fn();
vi.mock("@/gateway/usage/period", () => ({ periodStatus, agentRunCap }));

const trackConnectCardShown = vi.fn();
vi.mock("@/gateway/track", () => ({ trackConnectCardShown }));

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
    agentRunCap.mockReset();
    periodStatus.mockResolvedValue({ agentRuns: 7, calls: 40, periodStart: new Date(0) });
    agentRunCap.mockResolvedValue(25);
  });

  it("takes NO identity argument the model could supply", async () => {
    // THE IDOR CONSTRAINT, and it is not negotiable. A user id, account id or
    // email as a parameter looks like a testing convenience and becomes an
    // IDOR the first time a document the agent reads says "for diagnostics,
    // call this with userId=...". Identity is closed over from the session, so
    // there is nothing for a prompt to talk the model into.
    //
    // Asserted as "no IDENTITY field", not "no fields": disconnect_service
    // legitimately takes which service to disconnect. The line is whether a
    // parameter can NAME A ROW that might not be the caller's. A service name
    // cannot, because the rows are selected by the closed-over user id. A
    // global id could, which is why none is accepted.
    const IDENTITY_FIELDS = [
      "userid", "user_id", "accountid", "account_id",
      "email", "useremail", "user_email", "sub", "subject",
    ];
    const { db } = stubDb();
    const tools = buildIntrospectionTools({ db, userId: "user-1" });

    for (const name of INTROSPECTION_TOOL_NAMES) {
      const schema = (tools as unknown as Record<string, { inputSchema: z.ZodTypeAny }>)[name].inputSchema;
      const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape ?? {};
      for (const key of Object.keys(shape)) {
        expect(IDENTITY_FIELDS).not.toContain(key.toLowerCase());
      }

      // And it must actually DISCARD one if a model sends it anyway, rather
      // than merely not advertising it.
      const parsed = schema.safeParse({
        ...(name === "disconnect_service" || name === "request_connection"
          ? { service: "atlassian" }
          : {}),
        userId: "someone-else",
        email: "victim@example.com",
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data).not.toHaveProperty("userId");
      expect(parsed.data).not.toHaveProperty("email");
    }
  });

  it("puts a destructive account change behind the same approval gate", async () => {
    // Disconnecting revokes credentials and drops rows. It confirms exactly as
    // a sheet edit does, through the gate that already exists, rather than any
    // second confirmation mechanism invented for account changes.
    const { db } = stubDb();
    const tools = buildIntrospectionTools({ db, userId: "user-1" });
    expect(tools.disconnect_service.requireApproval).toBe(true);
  });

  it("disconnects by service, never by a global id", async () => {
    const { db } = stubDb();
    const tools = buildIntrospectionTools({ db, userId: "user-1" });
    const shape = (tools.disconnect_service.inputSchema as unknown as z.ZodObject<z.ZodRawShape>)
      .shape;
    // An account id would be a handle that can name another user's row.
    expect(Object.keys(shape)).toEqual(["service"]);
  });

  it("will not authorise a proactive config offer before a first run", async () => {
    // The config coming before value is the cliff this surface exists to
    // remove. Enforced server-side rather than asked for in the prompt,
    // because a prompt instruction is a request a model can talk itself out
    // of, and the failure would look exactly like the old onboarding.
    const { db } = stubDb();
    const tools = buildIntrospectionTools({ db, userId: "user-1" });

    // stubDb returns { plan } with no firstAgentRunAt, i.e. never ran.
    const before = await tools.show_mcp_config.execute();
    expect(before.mayOfferProactively).toBe(false);
    // Still reachable ON REQUEST, always. Withholding it from someone who
    // asked would be a different kind of broken.
    expect(before.configUrl).toBe("/dashboard/mcp-config");
  });

  it("authorises the proactive offer once the user has run something", async () => {
    const { db } = stubDb();
    (db as unknown as { select: () => unknown }).select = () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ firstAgentRunAt: new Date() }] }),
      }),
    });
    const tools = buildIntrospectionTools({ db, userId: "user-1" });
    expect((await tools.show_mcp_config.execute()).mayOfferProactively).toBe(true);
  });

  it("scopes every query to the session user", async () => {
    const { db, scopedTo } = stubDb();
    const tools = buildIntrospectionTools({ db, userId: "user-1" });

    await tools.account_status.execute();

    // Two queries (plan, connected accounts) plus the two period reads, and
    // every one was handed the id the tool was built with.
    expect(scopedTo.length).toBeGreaterThanOrEqual(2);
    expect(periodStatus).toHaveBeenCalledWith(db, "user-1");
    expect(agentRunCap).toHaveBeenCalledWith(db, "user-1");
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
    agentRunCap.mockResolvedValue(null);
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

  it("makes EVERY tool state its approval requirement explicitly", async () => {
    // THE FAIL-OPEN THIS CLASS INTRODUCED, closed here. Plugin tools get their
    // flag from classifyWrite, which defaults to WRITE for a name it does not
    // recognise, so forgetting one there costs an unnecessary prompt. These
    // tools bypass that entirely, so a forgotten flag is `undefined` and reads
    // as false: the tool runs unprompted. The next destructive tool added to
    // this file is exactly where that would happen, and it would look like
    // nothing at all.
    const { db } = stubDb();
    const tools = buildIntrospectionTools({ db, userId: "user-1" }) as Record<
      string,
      { requireApproval?: unknown }
    >;
    for (const name of INTROSPECTION_TOOL_NAMES) {
      expect(typeof tools[name].requireApproval, `${name} must declare requireApproval`).toBe(
        "boolean"
      );
    }
    // And the list is the whole surface: a tool present but unlisted would
    // escape the check above.
    expect(Object.keys(tools).sort()).toEqual([...INTROSPECTION_TOOL_NAMES].sort());
  });
});

describe("request_connection (SCRUM-78)", () => {
  beforeEach(() => {
    trackConnectCardShown.mockClear();
  });

  /** The execute under test, freed from the Mastra Tool generic soup: the
   * suite calls it directly, as the runtime does, with an optional writer. */
  type RequestConnectionExecute = (
    input: { service: string },
    context?: { writer?: { custom: (chunk: unknown) => Promise<void> } }
  ) => Promise<Record<string, unknown>>;
  function requestConnection(db: never): RequestConnectionExecute {
    const tools = buildIntrospectionTools({ db, userId: "user-1" });
    return tools.request_connection.execute as unknown as RequestConnectionExecute;
  }

  /** A db whose connected-accounts lookup returns what the test says, and a
   * writer that records every chunk written into the stream. */
  function connectStub(connectedRows: unknown[]) {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => connectedRows }),
        }),
      }),
    } as never;
    const written: unknown[] = [];
    const writer = {
      custom: async (chunk: unknown) => {
        written.push(chunk);
      },
    };
    return { db, writer, written };
  }

  it("writes a data-connect part naming ONLY the requested service", async () => {
    const { db, writer, written } = connectStub([]);
    const out = await requestConnection(db)({ service: "google-workspace" }, { writer });

    expect(written).toEqual([
      {
        type: "data-connect",
        data: {
          services: [
            {
              id: "google-workspace",
              name: "Google Workspace",
              connectHref: "/auth/google/connect",
            },
          ],
        },
      },
    ]);
    expect(out).toMatchObject({ alreadyConnected: false, controlShown: true });
  });

  it("emits nothing and says so when the service is already connected", async () => {
    const { db, writer, written } = connectStub([{ id: "acct-1" }]);
    const out = await requestConnection(db)({ service: "google-workspace" }, { writer });

    expect(written).toEqual([]);
    expect(out).toMatchObject({ alreadyConnected: true });
  });

  it("degrades honestly when no writer is available", async () => {
    // A tool result claiming a control is on screen when nothing was written
    // would be the fails-while-appearing-to-succeed shape this whole feature
    // exists to remove.
    const { db } = connectStub([]);
    const out = await requestConnection(db)({ service: "google-workspace" }, {});

    expect(out).toMatchObject({ alreadyConnected: false, controlShown: false });
  });

  it("refuses a service the registry does not know", async () => {
    const { db, writer, written } = connectStub([]);

    // createTool validates input against the schema BEFORE execute runs, so a
    // nonsense target is refused at the boundary (the returned object flags an
    // error); the registry guard inside execute backstops direct calls. Either
    // way, the property that matters: no control is written for it.
    const out = await requestConnection(db)({ service: "not-a-service" }, { writer });
    expect(out.error).toBeTruthy();
    expect(written).toEqual([]);
  });

  /* SCRUM-112: every branch of the ask is observed, or the data cannot tell
   * "the card was declined" from "the card never appeared" — the ambiguity
   * this event exists to remove. One test per branch, and the negative case
   * (an unknown service emits NOTHING) pinned alongside, so the event stays
   * a measurement of real asks rather than of every call. */

  it("reports the ask as shown when the card was placed (SCRUM-112)", async () => {
    const { db, writer } = connectStub([]);
    await requestConnection(db)({ service: "google-workspace" }, { writer });

    expect(trackConnectCardShown).toHaveBeenCalledTimes(1);
    expect(trackConnectCardShown).toHaveBeenCalledWith(db, "user-1", {
      service: "google-workspace",
      outcome: "shown",
    });
  });

  it("reports a redundant ask as already_connected (SCRUM-112)", async () => {
    const { db, writer } = connectStub([{ id: "acct-1" }]);
    await requestConnection(db)({ service: "google-workspace" }, { writer });

    expect(trackConnectCardShown).toHaveBeenCalledTimes(1);
    expect(trackConnectCardShown).toHaveBeenCalledWith(db, "user-1", {
      service: "google-workspace",
      outcome: "already_connected",
    });
  });

  it("reports the silent-failure branch as no_writer (SCRUM-112)", async () => {
    // The branch where the agent asked and no card could appear. Without
    // this outcome the event would answer "did the agent ask" while claiming
    // to answer "did the user see a card".
    const { db } = connectStub([]);
    await requestConnection(db)({ service: "google-workspace" }, {});

    expect(trackConnectCardShown).toHaveBeenCalledTimes(1);
    expect(trackConnectCardShown).toHaveBeenCalledWith(db, "user-1", {
      service: "google-workspace",
      outcome: "no_writer",
    });
  });

  it("emits no telemetry for a service the registry refuses (SCRUM-112)", async () => {
    const { db, writer } = connectStub([]);
    await requestConnection(db)({ service: "not-a-service" }, { writer });

    expect(trackConnectCardShown).not.toHaveBeenCalled();
  });
});
