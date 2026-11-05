import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "./schema/users";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://datatoragmcp:localdev@localhost:5432/datatoragmcp";

const client = postgres(DATABASE_URL);
const db = drizzle(client);

async function seed() {
  console.log("Seeding database...");

  // --- User ---
  let [user] = await db
    .insert(users)
    .values({
      email: "test@datatorag.com",
      name: "Test User",
      emailVerified: true,
    })
    .onConflictDoNothing()
    .returning();

  if (!user) {
    const existing = await db.select().from(users).limit(1);
    if (existing.length === 0) {
      console.error("No user found");
      process.exit(1);
    }
    user = existing[0];
    console.log(`Using existing user: ${user.email}`);
  } else {
    console.log(`Created user: ${user.email} (${user.id})`);
  }

  await client.end();
  console.log("\nSeed complete!");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
