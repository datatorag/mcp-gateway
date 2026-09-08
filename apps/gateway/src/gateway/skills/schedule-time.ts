import type { ScheduleCadence } from "@datatorag-mcp/db";

/**
 * When a schedule runs next, in the user's own zone (SCRUM-225).
 *
 * Pure date arithmetic over `Intl`, no library: the only questions are "what
 * local date and time is this instant in that zone" and "what instant is
 * this local time in that zone", and both are answered with the formatter
 * the runtime already ships. The zone lives on the schedule row, captured
 * from the browser at save, so the hour the user picked is the hour they
 * get across a DST change.
 */

export type ScheduleTiming = {
  cadence: ScheduleCadence;
  /** 0-23, local to `timezone`. */
  hour: number;
  /** 0-59, local to `timezone`. */
  minute: number;
  /** 0 (Sunday) to 6, `weekly` only. */
  weekday: number | null;
  /** IANA zone name. */
  timezone: string;
};

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 (Sunday) to 6. */
  weekday: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, f);
  }
  return f;
}

export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    formatter(timezone);
    return true;
  } catch {
    return false;
  }
}

/** The local wall-clock parts of `date` in `timezone`. */
export function localParts(date: Date, timezone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timezone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? "Sun"),
  };
}

/** The zone's offset from UTC at `date`, in minutes (east positive). */
function offsetMinutes(date: Date, timezone: string): number {
  const p = localParts(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, date.getUTCSeconds());
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** The instant at which a local wall-clock time occurs in `timezone`. Two
 * passes, because the offset can differ between the guess and the answer
 * on a DST boundary; the second pass settles it for every real zone. */
function instantOf(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string
): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let t = guess - offsetMinutes(new Date(guess), timezone) * 60_000;
  t = guess - offsetMinutes(new Date(t), timezone) * 60_000;
  return new Date(t);
}

function cadenceAccepts(cadence: ScheduleCadence, weekday: number, chosen: number | null): boolean {
  if (cadence === "daily") return true;
  if (cadence === "weekdays") return weekday >= 1 && weekday <= 5;
  return weekday === (chosen ?? 1);
}

/**
 * The first occurrence of the schedule strictly after `from`.
 *
 * Walks local calendar days from the local date of `from`, up to eight, so a
 * weekly schedule asked on its own day after the hour lands a week out and a
 * weekdays schedule asked on Friday evening lands on Monday.
 */
export function nextRunAt(timing: ScheduleTiming, from: Date): Date {
  const start = localParts(from, timing.timezone);
  for (let offset = 0; offset < 8; offset++) {
    // Advance the local date by whole days through UTC noon, which is never on
    // a DST edge in any zone, then read the local parts back.
    const dayCursor = new Date(Date.UTC(start.year, start.month - 1, start.day + offset, 12));
    const local = localParts(dayCursor, "UTC");
    const candidate = instantOf(
      { year: local.year, month: local.month, day: local.day, hour: timing.hour, minute: timing.minute },
      timing.timezone
    );
    if (candidate.getTime() <= from.getTime()) continue;
    const weekday = localParts(candidate, timing.timezone).weekday;
    if (cadenceAccepts(timing.cadence, weekday, timing.weekday)) return candidate;
  }
  /* c8 ignore next 2 -- eight days always contain a match for every cadence */
  throw new Error("nextRunAt: no occurrence within eight days");
}
