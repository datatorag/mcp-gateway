import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/slack", () => ({ sendSlack: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/stripe", () => ({ getStripe: vi.fn() }));
const envState = vi.hoisted(() => ({
  STRIPE_API_KEY: "",
  POSTHOG_PERSONAL_API_KEY: "",
  POSTHOG_PROJECT_ID: "",
  INTERNAL_EXCLUDE_EMAILS: "",
  INTERNAL_EXCLUDE_IDS: "",
}));
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => envState }));

import {
  formatDigest,
  runDailyDigest,
  collectStripe,
  collectPosthog,
  posthogInternalFilterSql,
  stripeLines,
  posthogLines,
  neonLines,
  reconcile,
  type NeonData,
} from "./digest";
import { sendSlack } from "../lib/slack";
import { getStripe } from "../lib/stripe";

const fakeDb = {} as never; // collectors are injected in these tests; db is never touched

describe("formatDigest", () => {
  it("renders one section per source with its lines", () => {
    const msg = formatDigest("Tue Jul 15", {
      neon: ["2 new leads", "1 signup"],
      stripe: ["nothing new"],
      posthog: ["120 pageviews"],
    });
    expect(msg.text).toContain("Tue Jul 15");
    const flat = JSON.stringify(msg.blocks);
    expect(flat).toContain("2 new leads");
    expect(flat).toContain("120 pageviews");
  });

  it("renders 'unavailable' for a failed (null) source", () => {
    const msg = formatDigest("Tue Jul 15", { neon: ["1 signup"], stripe: null, posthog: [] });
    const flat = JSON.stringify(msg.blocks);
    expect(flat).toContain("unavailable");
    expect(flat).toContain("nothing new"); // empty array renders as nothing-new
  });
});

describe("runDailyDigest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the digest to the digest channel", async () => {
    await runDailyDigest(fakeDb, {
      collectors: {
        neon: async () => ["1 new lead"],
        stripe: async () => [],
        posthog: async () => ["5 pageviews"],
      },
    });
    expect(sendSlack).toHaveBeenCalledWith("digest", expect.objectContaining({ text: expect.any(String) }));
  });

  it("degrades a throwing source to 'unavailable' and alerts ops, but still posts", async () => {
    await runDailyDigest(fakeDb, {
      collectors: {
        neon: async () => ["1 new lead"],
        stripe: async () => { throw new Error("stripe down"); },
        posthog: async () => [],
      },
    });
    const digestCall = vi.mocked(sendSlack).mock.calls.find(([ch]) => ch === "digest");
    const alertCall = vi.mocked(sendSlack).mock.calls.find(([ch]) => ch === "alerts");
    expect(digestCall).toBeDefined();
    expect(JSON.stringify(digestCall![1])).toContain("unavailable");
    expect(alertCall).toBeDefined();
    expect(alertCall![1].text).toContain("stripe down");
  });

  it("dryRun returns the message without posting", async () => {
    const msg = await runDailyDigest(fakeDb, {
      dryRun: true,
      collectors: { neon: async () => [], stripe: async () => [], posthog: async () => [] },
    });
    expect(msg.blocks).toBeDefined();
    expect(sendSlack).not.toHaveBeenCalled();
  });
});

/* SCRUM-211: the digest labelled a started checkout as a new customer.
 * `customer.created` is emitted by our own checkout route when checkout
 * BEGINS, so that label reported intent as revenue. The lines now say what
 * each event is, in a fixed order, and a started checkout that no
 * subscription followed says so on its own line. */
describe("stripeLines (SCRUM-211): each Stripe event labelled as what it is", () => {
  it("labels customer.created as a started checkout, never as a customer", () => {
    const lines = stripeLines({ "customer.created": 1 });
    expect(lines).toEqual(["Checkouts started: 1 (0 became customers)"]);
    expect(lines.join("\n")).not.toMatch(/New customers: 1/);
  });

  it("counts a new customer only from a created subscription", () => {
    const lines = stripeLines({
      "customer.created": 1,
      "customer.subscription.created": 1,
      "payment_intent.succeeded": 1,
    });
    expect(lines).toEqual([
      "Checkouts started: 1 (1 became a customer)",
      "New customers (subscription created): 1",
      "Payments succeeded: 1",
    ]);
  });

  it("keeps a fixed order and drops zero lines, but never drops a failed payment", () => {
    const lines = stripeLines({
      "payment_intent.payment_failed": 2,
      "payment_intent.succeeded": 3,
    });
    expect(lines).toEqual(["Payments succeeded: 3", "Payments FAILED: 2"]);
    expect(stripeLines({})).toEqual([]);
  });
});

describe("collectStripe (SCRUM-211): the event list flows through the labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.STRIPE_API_KEY = "sk_test_x";
  });
  afterEach(() => {
    envState.STRIPE_API_KEY = "";
  });

  it("renders a started checkout that no subscription followed, from the raw event list", async () => {
    vi.mocked(getStripe).mockReturnValue({
      events: {
        list: async () => ({
          data: [
            { type: "customer.created" },
            { type: "customer.updated" },
            { type: "checkout.session.expired" },
          ],
        }),
      },
    } as never);
    const lines = await collectStripe(new Date());
    expect(lines).toEqual(["Checkouts started: 1 (0 became customers)"]);
  });
});

/* SCRUM-211: a PostHog click count printed beside a DB connection count that
 * contradicted it, under a label that made the click sound like the
 * connection. `connector_added` is a CLICK on the dashboard's connect button, captured
 * client-side before OAuth starts; `account_connected` is the server-side
 * event that fires when a connection is actually written. The labels now say
 * so, and the real one becomes a fact the digest can reconcile with the DB. */
describe("posthogLines (SCRUM-211): clicks are clicks, connections are connections", () => {
  it("labels connector_added as a connect click and account_connected as a connection", () => {
    const { lines, facts } = posthogLines([
      ["account_connected", "", 1],
      ["connector_added", "", 2],
      ["user_signed_up", "", 3],
    ]);
    expect(lines).toContain("Connect clicks (dashboard): 2");
    expect(lines).toContain("Accounts connected: 1");
    expect(lines).toContain("Signups: 3");
    expect(lines.join("\n")).not.toContain("Connectors added");
    expect(facts).toEqual({ connections: 1, signups: 3 });
  });

  it("reports absent events as zero facts: no rows is a claim of zero, not silence", () => {
    const { facts } = posthogLines([["$pageview", "", 10]]);
    expect(facts).toEqual({ connections: 0, signups: 0 });
  });

  it("still splits tool_call by surface after the other lines", () => {
    const { lines } = posthogLines([
      ["$pageview", "", 120],
      ["tool_call", "agent", 3],
      ["tool_call", "mcp", 11],
    ]);
    expect(lines[lines.length - 1]).toBe("Tool calls: 14 (3 agent / 11 mcp)");
  });
});

/* SCRUM-212: THE RULE ABOVE ANY FIELD. When two sources describe the same
 * fact and disagree, the digest says so. Two contradictory numbers printed
 * side by side in silence look reconciled, which is worse than either alone. */
describe("reconcile (SCRUM-212): two sources, one fact, a visible marker when they differ", () => {
  it("names the fact and both numbers when the DB and PostHog disagree", () => {
    const lines = reconcile({
      neon: { connections: 0, signups: 2 },
      posthog: { connections: 2, signups: 2 },
    });
    expect(lines).toEqual(["New service connections: DB says 0, PostHog says 2"]);
  });

  it("is silent when they agree, and when a source is missing", () => {
    expect(reconcile({ neon: { connections: 1, signups: 2 }, posthog: { connections: 1, signups: 2 } })).toEqual([]);
    expect(reconcile({ neon: { connections: 1, signups: 2 }, posthog: null })).toEqual([]);
    expect(reconcile({ neon: null, posthog: { connections: 1, signups: 2 } })).toEqual([]);
  });

  it("checks every shared fact, not just the first", () => {
    const lines = reconcile({
      neon: { connections: 0, signups: 1 },
      posthog: { connections: 2, signups: 3 },
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("Signups: DB says 1, PostHog says 3");
  });
});

describe("formatDigest (SCRUM-212): the disagreement block", () => {
  it("renders a conspicuous block when sources disagree, and none when they do not", () => {
    const withMarker = formatDigest(
      "Mon Jan 1",
      { neon: ["New service connections: 0"], stripe: [], posthog: ["Accounts connected: 2"] },
      ["New service connections: DB says 0, PostHog says 2"]
    );
    const flat = JSON.stringify(withMarker.blocks);
    expect(flat).toContain("Sources disagree");
    expect(flat).toContain("DB says 0, PostHog says 2");
    const without = formatDigest("Mon Jan 1", { neon: [], stripe: [], posthog: [] }, []);
    expect(JSON.stringify(without.blocks)).not.toContain("Sources disagree");
  });
});

/* SCRUM-212: detail that makes a number actionable, without becoming a
 * dashboard. Signups are named with their source; the paying customers are a
 * named line that is conspicuous at zero; the connection count carries its
 * denominator. */
describe("neonLines (SCRUM-212): the DB section names what it counts", () => {
  const base: NeonData = {
    leads: [],
    signups: [],
    usage: { calls: 0, activeUsers: 0 },
    payingCustomers: [],
    newConnections: 0,
    funnel: { connected: 1, signups: 6, days: 14 },
  };

  it("names each signup with where they came from, paid and organic apart", () => {
    const { lines, facts } = neonLines({
      ...base,
      signups: [
        {
          name: "Paid Person",
          email: "paid@example.com",
          acquisitionChannel: "paid_search",
          acquisitionUtmSource: "google",
          acquisitionUtmMedium: "cpc",
          acquisitionUtmCampaign: null,
          acquisitionGclid: "x",
          acquisitionReferringDomain: null,
        },
        {
          name: null,
          email: "organic@example.com",
          acquisitionChannel: "organic",
          acquisitionUtmSource: null,
          acquisitionUtmMedium: null,
          acquisitionUtmCampaign: null,
          acquisitionGclid: null,
          acquisitionReferringDomain: "news.example.com",
        },
      ],
    });
    expect(lines).toContain("Signups: 2");
    expect(lines).toContain("• Paid Person <paid@example.com>: paid_search - google / cpc (gclid ✓)");
    expect(lines).toContain("• (no name) <organic@example.com>: organic - news.example.com");
    expect(facts.signups).toBe(2);
  });

  it("makes the paying customers a named line, conspicuous at zero calls", () => {
    const quiet = neonLines({
      ...base,
      usage: { calls: 25, activeUsers: 1 },
      payingCustomers: [{ email: "pro@example.com", calls: 0 }],
    });
    expect(quiet.lines).toContain("Tool calls: 25 (1 active user)");
    expect(quiet.lines).toContain("⚠️ Paying customers active: 0 of 1");
    expect(quiet.lines).toContain("• pro@example.com: 0 calls");

    const active = neonLines({
      ...base,
      payingCustomers: [{ email: "pro@example.com", calls: 17 }],
    });
    expect(active.lines).toContain("Paying customers active: 1 of 1");
    expect(active.lines).toContain("• pro@example.com: 17 calls");
    expect(active.lines.join("\n")).not.toContain("⚠️");
  });

  it("says when there are no paying customers at all", () => {
    expect(neonLines(base).lines).toContain("Paying customers: none");
  });

  it("carries the funnel denominator beside the connection count", () => {
    const { lines, facts } = neonLines({ ...base, newConnections: 0 });
    expect(lines).toContain("New service connections: 0");
    expect(lines).toContain("Connected: 1 of 6 signups in the last 14 days");
    expect(facts.connections).toBe(0);
  });
});

describe("collectStripe / collectPosthog — not configured", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collectStripe resolves to '_not configured — skipped_' without throwing, and makes no network/alert noise", async () => {
    await expect(collectStripe(new Date())).resolves.toEqual(["_not configured — skipped_"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSlack).not.toHaveBeenCalledWith("alerts", expect.anything());
  });

  it("collectPosthog resolves to '_not configured — skipped_' without throwing, and makes no network/alert noise", async () => {
    await expect(collectPosthog(new Date())).resolves.toEqual(["_not configured — skipped_"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendSlack).not.toHaveBeenCalledWith("alerts", expect.anything());
  });
});

describe("collectPosthog — line formatting", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    envState.POSTHOG_PERSONAL_API_KEY = "phx_test";
    envState.POSTHOG_PROJECT_ID = "123";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    envState.POSTHOG_PERSONAL_API_KEY = "";
    envState.POSTHOG_PROJECT_ID = "";
  });

  it("splits the tool_call line by surface, appending the aggregate after the other events", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          ["$pageview", "", 120],
          ["agent_run", "", 3],
          ["tool_call", "agent", 3],
          ["tool_call", "mcp", 11],
        ],
      }),
    });
    const result = await collectPosthog(new Date());
    // SCRUM-212: the collector now returns lines plus the facts it can vouch
    // for, so the digest can reconcile them against the DB.
    const lines = Array.isArray(result) ? result : result.lines;
    expect(lines).toContain("Pageviews: 120");
    expect(lines).toContain("Agent runs: 3");
    // Total first, then per-surface counts in the query's ORDER BY surface order.
    expect(lines[lines.length - 1]).toBe("Tool calls: 14 (3 agent / 11 mcp)");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // Absent surface must read as mcp — rows predating the attribute carry none.
    expect(body.query.query).toContain("coalesce(nullif(JSONExtractString(properties, 'surface'), ''), 'mcp')");
    expect(body.query.query).toContain("GROUP BY event, surface");
  });

  it("honors the since parameter in the HogQL time filter", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    await collectPosthog(new Date("2026-08-03T09:15:00Z"));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.query.query).toContain("toDateTime('2026-08-03 09:15:00')");
    expect(body.query.query).not.toContain("INTERVAL 1 DAY");
  });
});

describe("internal-traffic exclusion", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    envState.POSTHOG_PERSONAL_API_KEY = "";
    envState.POSTHOG_PROJECT_ID = "";
    envState.INTERNAL_EXCLUDE_EMAILS = "";
    envState.INTERNAL_EXCLUDE_IDS = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    envState.POSTHOG_PERSONAL_API_KEY = "";
    envState.POSTHOG_PROJECT_ID = "";
    envState.INTERNAL_EXCLUDE_EMAILS = "";
    envState.INTERNAL_EXCLUDE_IDS = "";
  });

  it("always excludes the company domain even with no env lists", () => {
    expect(posthogInternalFilterSql()).toBe(
      "AND coalesce(person.properties.email, '') NOT ILIKE '%@datatorag.com'"
    );
  });

  it("adds trimmed, lowercased email and case-preserved distinct_id exclusions from env", () => {
    envState.INTERNAL_EXCLUDE_EMAILS = " Founder@Example.com ,test2@example.com,";
    // distinct_id comparison is case-sensitive in HogQL — case must survive.
    envState.INTERNAL_EXCLUDE_IDS = "Abc-123";
    const filter = posthogInternalFilterSql();
    expect(filter).toContain(
      "lower(coalesce(person.properties.email, '')) NOT IN ('founder@example.com', 'test2@example.com')"
    );
    expect(filter).toContain("AND distinct_id NOT IN ('Abc-123')");
  });

  it("collectPosthog embeds the exclusion filter in the HogQL it sends", async () => {
    envState.POSTHOG_PERSONAL_API_KEY = "phx_test";
    envState.POSTHOG_PROJECT_ID = "123";
    envState.INTERNAL_EXCLUDE_IDS = "abc-123";
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    await collectPosthog(new Date());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.query.query).toContain("NOT ILIKE '%@datatorag.com'");
    expect(body.query.query).toContain("distinct_id NOT IN ('abc-123')");
    // The filter must sit between WHERE and GROUP BY, not dangle at the end.
    expect(body.query.query).toMatch(/NOT ILIKE '%@datatorag\.com'.*GROUP BY event/);
  });
});
