import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/slack.js", () => ({ sendSlack: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/stripe.js", () => ({ getStripe: vi.fn() }));
vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ STRIPE_API_KEY: "", POSTHOG_PERSONAL_API_KEY: "", POSTHOG_PROJECT_ID: "" }),
}));

import { formatDigest, runDailyDigest } from "./digest.js";
import { sendSlack } from "../lib/slack.js";

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
