import { describe, expect, it } from "vitest";
import { isValidTimezone, localParts, nextRunAt } from "./schedule-time";

/* SCRUM-225: when a schedule runs next, in the user's own zone. Pure, so the
 * DST and weekday arithmetic is pinned without a clock or a database. */

const LA = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);

describe("nextRunAt", () => {
  it("is the next occurrence of the hour today, strictly after the given instant", () => {
    // 2026-09-08 06:30 Pacific (13:30Z). A 07:00 schedule runs today at 14:00Z.
    const next = nextRunAt(
      { cadence: "daily", hour: 7, minute: 0, weekday: null, timezone: LA },
      at("2026-09-08T13:30:00Z")
    );
    expect(next.toISOString()).toBe("2026-09-08T14:00:00.000Z");
  });

  it("rolls to tomorrow once today's hour has passed, and at the exact minute", () => {
    const next = nextRunAt(
      { cadence: "daily", hour: 7, minute: 0, weekday: null, timezone: LA },
      at("2026-09-08T14:00:00Z")
    );
    expect(next.toISOString()).toBe("2026-09-09T14:00:00.000Z");
  });

  it("keeps the local hour across a DST change", () => {
    // Pacific leaves DST on 2026-11-01. 07:00 local is 14:00Z before, 15:00Z after.
    const before = nextRunAt(
      { cadence: "daily", hour: 7, minute: 0, weekday: null, timezone: LA },
      at("2026-10-31T20:00:00Z")
    );
    expect(before.toISOString()).toBe("2026-11-01T15:00:00.000Z");
    expect(localParts(before, LA)).toMatchObject({ hour: 7, minute: 0 });
  });

  it("skips the weekend for a weekdays cadence", () => {
    // 2026-09-11 is a Friday. After Friday's run, the next is Monday the 14th.
    const next = nextRunAt(
      { cadence: "weekdays", hour: 8, minute: 15, weekday: null, timezone: LA },
      at("2026-09-11T16:00:00Z")
    );
    expect(next.toISOString()).toBe("2026-09-14T15:15:00.000Z");
    expect(localParts(next, LA).weekday).toBe(1);
  });

  it("lands on the chosen weekday for a weekly cadence, a week out if today is that day and past", () => {
    // 2026-09-08 is a Tuesday (2). Weekly on Tuesday at 09:00, asked at 10:00 local.
    const next = nextRunAt(
      { cadence: "weekly", hour: 9, minute: 0, weekday: 2, timezone: LA },
      at("2026-09-08T17:00:00Z")
    );
    expect(next.toISOString()).toBe("2026-09-15T16:00:00.000Z");
  });

  it("works in a zone east of UTC where the local date is ahead", () => {
    // 23:30 in Tokyo on the 8th is 14:30Z. A 06:00 schedule runs the 9th at 21:00Z on the 8th.
    const next = nextRunAt(
      { cadence: "daily", hour: 6, minute: 0, weekday: null, timezone: "Asia/Tokyo" },
      at("2026-09-08T14:30:00Z")
    );
    expect(next.toISOString()).toBe("2026-09-08T21:00:00.000Z");
  });
});

describe("isValidTimezone", () => {
  it("accepts IANA names and refuses everything else", () => {
    expect(isValidTimezone(LA)).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
