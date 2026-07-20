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
} from "./digest";
import { sendSlack } from "../lib/slack";

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
