/**
 * SCRUM-480: "How did you find DataToRAG?" is asked once, on a new user's
 * signup landing, and its answer (or skip) is stored on the user with one
 * event beside it. Real Postgres via testcontainers: "once" is two guarded
 * UPDATEs, and only the database can say whether a second one wins.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
vi.mock("@/lib/posthog-server", () => ({ getPosthog: () => ({ capture }) }));

import { eq } from "drizzle-orm";
import { users, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { SELF_REPORT_MAX_CHARS, claimSelfReportPrompt, cleanSelfReport, recordSelfReport } from "./self-report";

describe("cleanSelfReport", () => {
  it("keeps the words, trims, drops markup and control characters", () => {
    expect(cleanSelfReport("  a Reddit thread in r/ClaudeAI  ")).toBe("a Reddit thread in r/ClaudeAI");
    expect(cleanSelfReport("<b>YouTube</b> <script>x()</script>video")).toBe("YouTube x() video");
    expect(cleanSelfReport("line one\nline\u0007 two")).toBe("line one line two");
    expect(cleanSelfReport("a friend <img src=x onerror=alert(1)")).toBe("a friend img src=x onerror=alert(1)");
  });

  it("caps at 500 characters", () => {
    expect(cleanSelfReport("x".repeat(900))).toHaveLength(SELF_REPORT_MAX_CHARS);
    expect(SELF_REPORT_MAX_CHARS).toBe(500);
  });

  it("an answer that cleans to nothing is no answer", () => {
    expect(cleanSelfReport("   ")).toBeNull();
    expect(cleanSelfReport("<br/>")).toBeNull();
    expect(cleanSelfReport(42)).toBeNull();
  });
});

describe.skipIf(!isDockerAvailable())("the prompt's state on the user (SCRUM-480)", () => {
  let db: Database;

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    capture.mockClear();
  });

  async function stored(userId: string) {
    const [row] = await db
      .select({ answer: users.acquisitionSelfReported, state: users.acquisitionSelfReportState })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  }

  it("a new user is asked once: the second claim, a reload or a second tab, loses", async () => {
    const userId = await insertTestUser(db);
    expect(await claimSelfReportPrompt(db, userId)).toBe(true);
    expect(await claimSelfReportPrompt(db, userId)).toBe(false);
    expect(await stored(userId)).toEqual({ answer: null, state: "shown" });
  });

  it("an account older than the signup landing is never asked", async () => {
    const userId = await insertTestUser(db);
    await db.update(users).set({ createdAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(users.id, userId));
    expect(await claimSelfReportPrompt(db, userId)).toBe(false);
    expect(await stored(userId)).toEqual({ answer: null, state: null });
  });

  it("an answer is stored cleaned, with one event carrying it and the measured acquisition", async () => {
    const userId = await insertTestUser(db);
    await db
      .update(users)
      .set({ acquisitionChannel: "Paid Search", acquisitionGclid: "Cj0KPAID", acquisitionReferringDomain: "www.google.com" })
      .where(eq(users.id, userId));
    await claimSelfReportPrompt(db, userId);

    expect(await recordSelfReport(db, userId, { answer: "  a <i>podcast</i> ", skipped: false })).toBe(true);
    expect(await stored(userId)).toEqual({ answer: "a podcast", state: "answered" });
    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0][0]).toMatchObject({
      distinctId: userId,
      event: "acquisition_self_reported",
      properties: {
        answer: "a podcast",
        skipped: false,
        acquisition_channel: "Paid Search",
        acquisition_gclid: "Cj0KPAID",
        acquisition_referring_domain: "www.google.com",
        acquisition_utm_source: null,
      },
    });

    // Settled: a replayed post changes nothing and sends nothing.
    expect(await recordSelfReport(db, userId, { answer: "something else", skipped: false })).toBe(false);
    expect(await stored(userId)).toEqual({ answer: "a podcast", state: "answered" });
    expect(capture).toHaveBeenCalledOnce();
  });

  it("Skip records skipped, stores no answer, and sends one event saying so", async () => {
    const userId = await insertTestUser(db);
    await claimSelfReportPrompt(db, userId);
    expect(await recordSelfReport(db, userId, { answer: "ignored", skipped: true })).toBe(true);
    expect(await stored(userId)).toEqual({ answer: null, state: "skipped" });
    expect(capture.mock.calls[0][0].properties).toMatchObject({ answer: null, skipped: true });
  });

  it("nothing is recorded for a prompt that was never shown", async () => {
    const userId = await insertTestUser(db);
    expect(await recordSelfReport(db, userId, { answer: "hello", skipped: false })).toBe(false);
    expect(await stored(userId)).toEqual({ answer: null, state: null });
    expect(capture).not.toHaveBeenCalled();
  });
});
