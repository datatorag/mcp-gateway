/** Reading tool arguments (SCRUM-468). Each reader names the argument in its
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

export function int(args: Args, name: string, min = 1): number {
  const v = args[name];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new Error(`${name} is required and must be a whole number of at least ${min}.`);
  return v;
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

export function optStrings(args: Args, name: string): string[] | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== "string" || x.trim() === "")) {
    throw new Error(`${name} must be a non-empty list of strings.`);
  }
  return (v as string[]).map((x) => x.trim());
}

export function optInts(args: Args, name: string): number[] | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== "number" || !Number.isInteger(x) || x < 1)) {
    throw new Error(`${name} must be a non-empty list of whole numbers.`);
  }
  return v as number[];
}

/** YYYY-MM-DD, the date form Brevo's report endpoints take. */
export function optDate(args: Args, name: string): string | undefined {
  const v = optStr(args, name);
  if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} must be a date as YYYY-MM-DD.`);
  return v;
}

/** An ISO 8601 date and time, which Brevo's filters and schedules take. */
export function optDateTime(args: Args, name: string): string | undefined {
  const v = optStr(args, name);
  if (v !== undefined && Number.isNaN(Date.parse(v))) throw new Error(`${name} must be an ISO 8601 date and time, e.g. 2026-11-02T09:00:00Z.`);
  return v;
}

/** Either `days`, or a `start_date` and `end_date` together, or neither. */
export function dateRange(args: Args, maxDays: number): { days?: number; startDate?: string; endDate?: string } {
  const days = optInt(args, "days", 1, maxDays);
  const startDate = optDate(args, "start_date");
  const endDate = optDate(args, "end_date");
  if (days !== undefined && (startDate || endDate)) throw new Error("Give days, or start_date and end_date, not both.");
  if ((startDate === undefined) !== (endDate === undefined)) throw new Error("start_date and end_date go together.");
  return { days, startDate, endDate };
}
