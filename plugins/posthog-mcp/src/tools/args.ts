/** Reading tool arguments (SCRUM-471). Each reader names the argument in its
 * refusal, so a model can correct the call; a refusal is thrown as a plain
 * Error, which the error meta reads as "refused", a user error. */

type Args = Record<string, unknown>;

export function str(args: Args, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${name} is required and must be a non-empty string.`);
  return v.trim();
}

export function optStr(args: Args, name: string): string | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${name} must be a non-empty string when given.`);
  return v.trim();
}

export function optInt(args: Args, name: string, min: number, max: number): number | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return v;
}

export function optBool(args: Args, name: string): boolean | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new Error(`${name} must be true or false.`);
  return v;
}

export function optEnum<T extends string>(args: Args, name: string, values: readonly T[]): T | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || !values.includes(v as T)) throw new Error(`${name} must be one of: ${values.join(", ")}.`);
  return v as T;
}

/** A relative date PostHog reads (`-7d`, `-24h`, `-2w`, `-3m`, `-1y`), a date
 * (YYYY-MM-DD), or an ISO date and time. */
const RELATIVE = /^-\d{1,4}[hdwmy]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDateValue(v: string): boolean {
  return RELATIVE.test(v) || DATE.test(v) || (/^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)));
}

export const DATE_DESCRIPTION = "A date (2026-11-01), an ISO date and time, or relative to now: -7d, -24h, -2w, -3m, -1y.";

/** A required date. An open end means "now" and a weekly number drifts, so
 * the end of a range is required too, wherever a range is. */
export function date(args: Args, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || !isDateValue(v.trim())) throw new Error(`${name} is required. ${DATE_DESCRIPTION}`);
  return v.trim();
}

export function optDate(args: Args, name: string): string | undefined {
  if (args[name] === undefined || args[name] === null) return undefined;
  return date(args, name);
}

/** A date argument as an absolute ISO time, for a query that compares
 * timestamps itself. Relative values count back from `now`. */
export function absoluteTime(value: string, now: Date): string {
  const m = /^-(\d+)([hdwmy])$/.exec(value);
  if (!m) return DATE.test(value) ? `${value}T00:00:00Z` : new Date(value).toISOString();
  const n = Number(m[1]);
  const t = new Date(now);
  if (m[2] === "h") t.setUTCHours(t.getUTCHours() - n);
  if (m[2] === "d") t.setUTCDate(t.getUTCDate() - n);
  if (m[2] === "w") t.setUTCDate(t.getUTCDate() - 7 * n);
  if (m[2] === "m") t.setUTCMonth(t.getUTCMonth() - n);
  if (m[2] === "y") t.setUTCFullYear(t.getUTCFullYear() - n);
  return t.toISOString();
}

/** Equality filters on event properties: `[{key, value}]`, at most `max`. */
export function optEqualities(args: Args, name: string, max: number): Array<{ key: string; value: string | number | boolean }> | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  const bad = () => new Error(`${name} must be a list of at most ${max} {key, value}, value a string, number or true/false.`);
  if (!Array.isArray(v) || v.length === 0 || v.length > max) throw bad();
  return v.map((f) => {
    if (!f || typeof f !== "object") throw bad();
    const { key, value } = f as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || key.trim() === "") throw bad();
    if (!["string", "number", "boolean"].includes(typeof value)) throw bad();
    return { key: key.trim(), value: value as string | number | boolean };
  });
}
