import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

// isInternalEmail (used unmocked via importOriginal below) reads
// INTERNAL_EXCLUDE_EMAILS from env — real getEnv() would exit on missing
// DATABASE_URL in the test environment.
vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ INTERNAL_EXCLUDE_EMAILS: "founder@example.com" }),
}));

const hasKey = vi.fn(() => true);
const upsert = vi.fn();
const sendTpl = vi.fn();
vi.mock("../lib/brevo", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/brevo")>();
  return {
    ...real,
    hasBrevoKey: () => hasKey(),
    upsertBrevoContact: (...args: unknown[]) => upsert(...args),
    sendBrevoTemplate: (...args: unknown[]) => sendTpl(...args),
  };
});
vi.mock("../lib/slack", () => ({
  sendSlack: vi.fn().mockResolvedValue(undefined),
}));

import {
  firstNameOf,
  sendWelcomeEmail,
  runNoActivationFollowup,
  LIFECYCLE_LAUNCH,
} from "./lifecycle";
import { sendSlack } from "../lib/slack";

const selectWhere = vi.fn();
const returning = vi.fn();
const select = vi.fn(() => ({ from: () => ({ where: selectWhere }) }));
const dbMock = {
  select,
  update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
} as unknown as Database;

describe("firstNameOf", () => {
  it("takes the first word, falling back to 'there'", () => {
    expect(firstNameOf("Manuel Yang")).toBe("Manuel");
    expect(firstNameOf("  Ada   Lovelace ")).toBe("Ada");
    expect(firstNameOf(null)).toBe("there");
    expect(firstNameOf("")).toBe("there");
  });
});

describe("sendWelcomeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasKey.mockReturnValue(true);
    upsert.mockResolvedValue(true);
    sendTpl.mockResolvedValue(true);
  });

  it("skips internal accounts entirely", async () => {
    await sendWelcomeEmail({ email: "someone@datatorag.com", name: "Someone" });
    await sendWelcomeEmail({ email: "founder@example.com", name: "Founder" });
    expect(upsert).not.toHaveBeenCalled();
    expect(sendTpl).not.toHaveBeenCalled();
  });

  it("no-ops with a warning when the key is missing", async () => {
    hasKey.mockReturnValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendWelcomeEmail({ email: "new@user.com", name: "New" });
    expect(upsert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("upserts the contact then sends welcome template 2 with FIRSTNAME", async () => {
    await sendWelcomeEmail({
      email: "ada@example.com",
      name: "Ada Lovelace",
      plan: "pro_trial",
      createdAt: new Date("2026-07-18T01:00:00Z"),
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com", firstName: "Ada" })
    );
    expect(sendTpl).toHaveBeenCalledWith(2, "ada@example.com", {
      FIRSTNAME: "Ada",
    });
  });
});

describe("runNoActivationFollowup", () => {
  const NOW = new Date("2026-07-25T16:15:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    hasKey.mockReturnValue(true);
    sendTpl.mockResolvedValue(true);
    selectWhere.mockResolvedValue([]);
    returning.mockResolvedValue([{ id: "u1" }]);
  });

  it("exits before touching the db when the key is missing", async () => {
    hasKey.mockReturnValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res).toEqual({ eligible: 0, sent: 0, failed: 0 });
    expect(select).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("claims then sends template 3, filtering internal users", async () => {
    selectWhere.mockResolvedValue([
      { id: "u1", email: "real@user.com", name: "Real User" },
      { id: "u2", email: "founder@example.com", name: "Founder" },
    ]);
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res).toEqual({ eligible: 1, sent: 1, failed: 0 });
    expect(sendTpl).toHaveBeenCalledTimes(1);
    expect(sendTpl).toHaveBeenCalledWith(3, "real@user.com", {
      FIRSTNAME: "Real",
    });
  });

  it("never double-sends when the claim loses the race", async () => {
    selectWhere.mockResolvedValue([
      { id: "u1", email: "real@user.com", name: "Real" },
    ]);
    returning.mockResolvedValue([]);
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res.sent).toBe(0);
    expect(sendTpl).not.toHaveBeenCalled();
  });

  it("alerts ops when a claimed send fails", async () => {
    selectWhere.mockResolvedValue([
      { id: "u1", email: "real@user.com", name: "Real" },
    ]);
    sendTpl.mockResolvedValue(false);
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res).toEqual({ eligible: 1, sent: 0, failed: 1 });
    expect(sendSlack).toHaveBeenCalledWith(
      "alerts",
      expect.objectContaining({
        text: expect.stringContaining("real@user.com"),
      })
    );
  });

  it("launch cutoff protects the pre-launch campaign cohort", () => {
    expect(LIFECYCLE_LAUNCH.toISOString()).toBe("2026-07-17T22:00:00.000Z");
  });
});
