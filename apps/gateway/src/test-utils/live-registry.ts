import { createDb, type Database } from "@datatorag-mcp/db";

// The suites that compare a reviewed record against the live registry
// (tool-classification, case-arguments) run only when this is set, and read
// through it rather than DATABASE_URL. A non-empty DATABASE_URL was the old
// gate, and it meant nothing: the .env.example placeholder is non-empty, so
// a checkout without a database ran these suites and failed on connect,
// while blanking it broke every suite that reads getEnv(). Setting this is
// the explicit claim that it points at a real registry database. Once set,
// an unreachable database FAILS the suite rather than skipping it, because a
// guard that goes quiet when its ground is missing is not a guard.
export const LIVE_REGISTRY_DATABASE_URL = process.env.LIVE_REGISTRY_DATABASE_URL ?? "";

// Carried in the suite titles, so a skipped run names what it is waiting on.
export const NEEDS_LIVE_REGISTRY = "(needs LIVE_REGISTRY_DATABASE_URL)";

let db: Database | null = null;

export function liveRegistryDb(): Database {
  if (!LIVE_REGISTRY_DATABASE_URL) {
    throw new Error("LIVE_REGISTRY_DATABASE_URL is not set; gate the suite on it");
  }
  db ??= createDb(LIVE_REGISTRY_DATABASE_URL);
  return db;
}
