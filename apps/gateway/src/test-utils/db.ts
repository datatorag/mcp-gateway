import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { users, type Database } from "@datatorag-mcp/db";

let container: StartedPostgreSqlContainer | null = null;
let client: ReturnType<typeof postgres> | null = null;
let db: Database | null = null;

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
