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

// Resolves the select().from().where().orderBy().limit() chain to `rows`.
const limit = vi.fn();
const dbMock = {
  select: () => ({
    from: () => ({
      where: () => ({ orderBy: () => ({ limit }) }),
    }),
  }),
} as unknown as Database;

describe("notifySignup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue([]);
  });

  it("skips internal accounts without touching the db or Slack", async () => {
    await notifySignup(dbMock, {
      email: "founder@example.com",
      name: "Founder",
    });
    expect(limit).not.toHaveBeenCalled();
    expect(sendSlack).not.toHaveBeenCalled();
  });

  it("labels a signup with a matching lead as a conversion, with UTM", async () => {
    limit.mockResolvedValue([
      { utmSource: "google", utmMedium: "cpc", utmCampaign: "launch" },
    ]);
    await notifySignup(dbMock, {
      email: "ada@customer.com",
      name: "Ada Lovelace",
      createdAt: new Date("2026-07-20T12:00:00Z"),
    });
    expect(sendSlack).toHaveBeenCalledWith("leads", {
      text: expect.stringContaining("Lead → signup conversion"),
    });
    const { text } = vi.mocked(sendSlack).mock.calls[0][1];
    expect(text).toContain("Ada Lovelace <ada@customer.com>");
    expect(text).toContain("UTM: google / cpc / launch");
    expect(text).toContain("2026-07-20T12:00:00");
  });

  it("labels a signup with no lead row as direct, omitting the UTM line", async () => {
    await notifySignup(dbMock, { email: "bob@customer.com", name: null });
    const { text } = vi.mocked(sendSlack).mock.calls[0][1];
    expect(text).toContain("Direct signup (no matching lead)");
    expect(text).toContain("(no name) <bob@customer.com>");
    expect(text).not.toContain("UTM:");
  });

  it("never throws when the lead lookup fails — still posts as direct-unknown or swallows", async () => {
    limit.mockRejectedValue(new Error("db down"));
    await expect(
      notifySignup(dbMock, { email: "carol@customer.com", name: "Carol" })
    ).resolves.toBeUndefined();
  });
});
