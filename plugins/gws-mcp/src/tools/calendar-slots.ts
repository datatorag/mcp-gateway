/**
 * The arithmetic behind calendar_suggest_time (SCRUM-428), kept apart from
 * the tool so it can be tested without a client: wall-clock times in a time
 * zone, and free slots inside working hours once busy time is taken out.
 */

/** Minutes the zone is ahead of UTC at `instant`. */
export function tzOffsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

/** The instant a wall-clock time in a zone names. Around a change of
 * offset the answer uses the offset in force at that instant. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - tzOffsetMinutes(guess, timeZone) * 60000;
  const second = guess - tzOffsetMinutes(first, timeZone) * 60000;
  return second;
}

/** The calendar date and weekday (0 Sunday) of an instant in a zone. */
export function zonedDate(instant: number, timeZone: string): { y: number; m: number; d: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday };
}

/** "2026-10-20 14:30" in the zone, for a reader. */
export function localLabel(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

type Interval = [number, number];

/** Busy intervals sorted and joined where they touch or overlap. */
export function mergeBusy(busy: Interval[]): Interval[] {
  const sorted = busy.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

const STEP_MS = 15 * 60000;

export interface SlotOptions {
  windowStart: number;
  windowEnd: number;
  durationMinutes: number;
  dayStartHour: number;
  dayEndHour: number;
  includeWeekends: boolean;
  timeZone: string;
  max: number;
}

/**
 * Candidate start times, earliest first: inside each day's working hours,
 * inside the window, clear of every busy interval for the whole duration.
 * Starts sit on the quarter hour; within one free stretch they are a
 * duration apart, so a long free afternoon offers several distinct slots
 * rather than a start every fifteen minutes.
 */
export function freeSlots(busyIn: Interval[], o: SlotOptions): Interval[] {
  const busy = mergeBusy(busyIn);
  const duration = o.durationMinutes * 60000;
  const slots: Interval[] = [];
  const first = zonedDate(o.windowStart, o.timeZone);
  for (let day = 0; day < 62 && slots.length < o.max; day++) {
    // Noon UTC on the day, stepped a day at a time, read back in the zone:
    // a date walk that does not slip across a change of offset.
    const noon = Date.UTC(first.y, first.m - 1, first.d + day, 12);
    const date = zonedDate(noon, o.timeZone);
    const dayStart = zonedToUtc(date.y, date.m, date.d, o.dayStartHour, 0, o.timeZone);
    if (dayStart >= o.windowEnd) break;
    if (!o.includeWeekends && (date.weekday === 0 || date.weekday === 6)) continue;
    const dayEnd = zonedToUtc(date.y, date.m, date.d, o.dayEndHour, 0, o.timeZone);
    let from = Math.max(dayStart, o.windowStart);
    const to = Math.min(dayEnd, o.windowEnd);
    from = Math.ceil(from / STEP_MS) * STEP_MS;
    let cursor = from;
    while (cursor + duration <= to && slots.length < o.max) {
      const clash = busy.find(([s, e]) => s < cursor + duration && e > cursor);
      if (clash) {
        cursor = Math.ceil(clash[1] / STEP_MS) * STEP_MS;
        continue;
      }
      slots.push([cursor, cursor + duration]);
      cursor += duration;
    }
  }
  return slots;
}
