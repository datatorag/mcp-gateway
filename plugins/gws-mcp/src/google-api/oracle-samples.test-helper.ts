import type { METHOD_TABLE } from "./method-table.js";

type Entry = (typeof METHOD_TABLE)[string]["methods"][string];

/** Parameters that exercise every rule at once: a path value with a slash, a
 * space and reserved characters; every repeated parameter as a two-element
 * array; every required query parameter; one scalar of each JSON type; and an
 * array on a parameter the API does NOT mark repeated. */
export function sampleParams(entry: Entry): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const name of entry.pathParams) params[name] = `${name}/a b!:é-._~*()@+,;=$`;
  for (const name of entry.repeated) if (!entry.pathParams.includes(name)) params[name] = ["one 1", "two&2"];
  for (const name of entry.requiredQuery) if (!(name in params)) params[name] = "req=uired";
  params.zzOracleFlag = true;
  params.zzOracleCount = 7;
  params.zzOracleText = "a&b=c d";
  params.aaOracleList = ["x", "y"];
  return params;
}

/** The parameters of the media-upload check: plain path values only. */
export function uploadParams(entry: Entry): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const name of entry.pathParams) params[name] = `${name}-1`;
  return params;
}

/** Two real-shaped calls: a repeated parameter, and a body passed through. */
export const ORACLE_CASES: Record<
  string,
  { service: string; resource: string; method: string; params: Record<string, unknown>; body?: unknown }
> = {
  repeatedParameter: {
    service: "sheets",
    resource: "spreadsheets.values",
    method: "batchGet",
    params: { spreadsheetId: "S1", ranges: ["Tab 1!A1:B2", "Totals!A1"], majorDimension: "ROWS" },
  },
  bodyPassesThrough: {
    service: "gmail",
    resource: "users.messages",
    method: "send",
    params: { userId: "me" },
    body: { raw: "SGk", threadId: "t1" },
  },
};
