import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

// isInternalEmail (used unmocked via importOriginal below) reads
// INTERNAL_EXCLUDE_EMAILS from env — real getEnv() would exit on missing
// DATABASE_URL in the test environment.
vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ INTERNAL_EXCLUDE_EMAILS: "founder@example.com" }),
}));

vi.mock("../lib/slack", () => ({
  sendSlack: vi.fn().mockResolvedValue(undefined),
}));

import { notifySignup } from "./signup-alert";
import { sendSlack } from "../lib/slack";

// notifySignup issues two selects: the users acquisition read
// (select().from().where().limit()) and the leads match
// (select().from().where().orderBy().limit()). The chains differ in shape, so
// each gets its own terminal mock.
const userLimit = vi.fn();
const leadLimit = vi.fn();
const dbMock = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: userLimit,
        orderBy: () => ({ limit: leadLimit }),
      }),
    }),
  }),
} as unknown as Database;

const NO_ACQUISITION = {
  acquisitionChannel: null,
  acquisitionUtmSource: null,
  acquisitionUtmMedium: null,
  acquisitionUtmCampaign: null,
  acquisitionGclid: null,
  acquisitionReferringDomain: null,
  acquisitionEntryUrl: null,
};

function lastText(): string {
  return vi.mocked(sendSlack).mock.calls[0][1].text;
}

describe("notifySignup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userLimit.mockResolvedValue([NO_ACQUISITION]);
    leadLimit.mockResolvedValue([]);
  });

  it("skips internal accounts without touching the db or Slack", async () => {
    await notifySignup(dbMock, {
      id: "u1",
      email: "founder@example.com",
      name: "Founder",
    });
    expect(userLimit).not.toHaveBeenCalled();
    expect(leadLimit).not.toHaveBeenCalled();
    expect(sendSlack).not.toHaveBeenCalled();
  });

  it("renders the full acquisition snapshot: channel, utm detail, gclid flag, entry path", async () => {
    userLimit.mockResolvedValue([
      {
        acquisitionChannel: "Paid Search",
        acquisitionUtmSource: "google",
        acquisitionUtmMedium: "cpc",
        acquisitionUtmCampaign: "20123456789",
        acquisitionGclid: "EAIaIQ-long-opaque-click-id",
        acquisitionReferringDomain: "www.google.com",
        acquisitionEntryUrl:
          "https://datatorag.com/docs/google-workspace?utm_source=google&gclid=EAIaIQ-long-opaque-click-id",
      },
    ]);
    await notifySignup(dbMock, {
      id: "u1",
      email: "ada@customer.com",
      name: "Ada Lovelace",
      createdAt: new Date("2026-08-14T12:00:00Z"),
    });
    const text = lastText();
    expect(text).toContain("Ada Lovelace <ada@customer.com>");
    expect(text).toContain(
      "Source: Paid Search - google / cpc / campaign 20123456789 (gclid ✓)"
    );
    // Entry PATH only — the query string (and the raw gclid inside it) must
    // not reach the channel.
    expect(text).toContain("Landed: /docs/google-workspace");
    expect(text).not.toContain("EAIaIQ-long-opaque-click-id");
    expect(text).toContain("Lead match: none");
    expect(text).toContain("2026-08-14T12:00:00");
  });

  it("falls back to the referring domain when the channel has no utm detail", async () => {
    userLimit.mockResolvedValue([
      {
        ...NO_ACQUISITION,
        acquisitionChannel: "Organic Search",
        acquisitionReferringDomain: "www.google.com",
        acquisitionEntryUrl: "https://datatorag.com/blog/some-post",
      },
    ]);
    await notifySignup(dbMock, { id: "u1", email: "bob@customer.com", name: null });
    const text = lastText();
    expect(text).toContain("Source: Organic Search - www.google.com");
    expect(text).toContain("Landed: /blog/some-post");
    expect(text).not.toContain("gclid");
  });

  it("says explicitly when no acquisition data was captured — never a blank field", async () => {
    await notifySignup(dbMock, { id: "u1", email: "bob@customer.com", name: null });
    const text = lastText();
    expect(text).toContain("Source: unknown (no acquisition data captured)");
    expect(text).not.toContain("Landed:");
    expect(text).toContain("Lead match: none");
    expect(text).toContain("(no name) <bob@customer.com>");
  });

  it("keeps the lead-match line as a conversion with the lead's own utm set", async () => {
    leadLimit.mockResolvedValue([
      { utmSource: "google", utmMedium: "cpc", utmCampaign: "launch" },
    ]);
    await notifySignup(dbMock, {
      id: "u1",
      email: "ada@customer.com",
      name: "Ada Lovelace",
      createdAt: new Date("2026-07-20T12:00:00Z"),
    });
    const text = lastText();
    expect(text).toContain("Lead match: ✓ converted (google / cpc / launch)");
    expect(text).toContain("2026-07-20T12:00:00");
  });

  it("shows a bare channel when only the channel survived", async () => {
    userLimit.mockResolvedValue([
      { ...NO_ACQUISITION, acquisitionChannel: "Direct" },
    ]);
    await notifySignup(dbMock, { id: "u1", email: "bob@customer.com", name: null });
    expect(lastText()).toContain("Source: Direct");
  });

  it("keeps a non-URL entry value usable rather than dropping the line", async () => {
    userLimit.mockResolvedValue([
      {
        ...NO_ACQUISITION,
        acquisitionChannel: "Direct",
        acquisitionEntryUrl: "not a url",
      },
    ]);
    await notifySignup(dbMock, { id: "u1", email: "bob@customer.com", name: null });
    expect(lastText()).toContain("Landed: not a url");
  });

  it("strips the query string even from an unparseable relative entry value", async () => {
    userLimit.mockResolvedValue([
      {
        ...NO_ACQUISITION,
        acquisitionChannel: "Direct",
        acquisitionEntryUrl: "/docs/gmail?gclid=fabricated-click-id",
      },
    ]);
    await notifySignup(dbMock, { id: "u1", email: "bob@customer.com", name: null });
    const text = lastText();
    expect(text).toContain("Landed: /docs/gmail");
    expect(text).not.toContain("fabricated-click-id");
  });

  it("never throws when the db reads fail", async () => {
    userLimit.mockRejectedValue(new Error("db down"));
    leadLimit.mockRejectedValue(new Error("db down"));
    await expect(
      notifySignup(dbMock, { id: "u1", email: "carol@customer.com", name: "Carol" })
    ).resolves.toBeUndefined();
  });
});
