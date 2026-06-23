import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export function createDb(connectionString: string) {
  // prepare:false is required for Neon's pooled (PgBouncer) endpoint —
  // postgres.js's default named prepared statements don't survive
  // transaction-level connection pooling. Harmless on a direct connection.
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

export * from "./schema/index";
