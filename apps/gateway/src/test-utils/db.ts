import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { users, type Database } from "@datatorag-mcp/db";

let container: StartedPostgreSqlContainer | null = null;
let client: ReturnType<typeof postgres> | null = null;
let db: Database | null = null;

// Cheap synchronous check for a reachable Docker daemon, so testcontainers
// suites can gate themselves (describe.skipIf(!isDockerAvailable())) instead
// of hard-failing when Docker isn't running — mirrors the env-gating
// convention used by apps/gateway/e2e/mcp.e2e.test.ts for the e2e harness.
export function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function getTestDb(): Promise<Database> {
  if (db) return db;

  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("datatoragmcp_test")
    .withUsername("datatoragmcp")
    .withPassword("test")
    .start();

  client = postgres(container.getConnectionUri());
  db = drizzle(client) as Database;

  const migrationsFolder = path.resolve(
    __dirname,
    "../../../../packages/db/drizzle"
  );
  await migrate(db, { migrationsFolder });

  return db;
}

export async function stopTestDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
  if (container) {
    await container.stop();
    container = null;
  }
  db = null;
}

export async function insertTestUser(testDb: Database): Promise<string> {
  const id = randomUUID();
  await testDb.insert(users).values({
    id,
    email: `test-${id}@example.com`,
    emailVerified: true,
  });
  return id;
}
