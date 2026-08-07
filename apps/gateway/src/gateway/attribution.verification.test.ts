import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { getTestDb, isDockerAvailable, stopTestDb } from "../test-utils/db";
import { persistAcquisition } from "./attribution";
import { parseAttribution } from "../lib/attribution";

/**
 * The acceptance check, run for real: a single query has to answer "which
 * channel and campaign produced this signed-up user" with no hand-stitching.
 *
 * This runs against a real Postgres with the real migrations applied, so it
 * proves the columns exist, the signup path fills them, and the query returns
 * an answer — not a stub's idea of one. Docker-gated like every other
 * testcontainers suite here.
 */
describe.skipIf(!isDockerAvailable())("acquisition attribution, end to end", () => {
  let db: Database;

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  async function signUpWith(query: Record<string, string>): Promise<string> {
    const id = randomUUID();
    await db
      .insert(users)
      .values({ id, email: `${id}@example.com`, emailVerified: true });
    // Exactly what the signup callback does with what the browser handed it.
    await persistAcquisition(db, id, parseAttribution(query));
    return id;
  }

  it("answers the acquisition question for a user who signed up after the change", async () => {
    const paidUserId = await signUpWith({
      a_sid: "0198abc-session",
      a_did: "0198abc-person",
      a_utm_source: "google",
      a_utm_medium: "cpc",
      a_utm_campaign: "brand-us",
      a_gclid: "Cj0KCQiA",
      a_ref_domain: "www.google.com",
      a_entry_url: "https://datatorag.com/?gclid=Cj0KCQiA",
    });

    // THE query. One statement, no joins, no session-retention dependency.
    const rows = await db.execute(sql`
      SELECT email,
             acquisition_channel,
             acquisition_utm_source,
             acquisition_utm_campaign,
             acquisition_gclid,
             acquisition_referring_domain,
             acquisition_session_id
        FROM users
       WHERE id = ${paidUserId}
    `);

    expect(rows[0]).toMatchObject({
      acquisition_channel: "Paid Search",
      acquisition_utm_source: "google",
      acquisition_utm_campaign: "brand-us",
      acquisition_gclid: "Cj0KCQiA",
      acquisition_referring_domain: "www.google.com",
      acquisition_session_id: "0198abc-session",
    });
  });

  it("keeps the session id joinable to the browsing session that produced the signup", async () => {
    const userId = await signUpWith({
      a_sid: "0198def-session",
      a_ref_domain: "news.ycombinator.com",
    });

    const rows = await db.execute(sql`
      SELECT acquisition_session_id, acquisition_channel
        FROM users
       WHERE id = ${userId}
    `);

    expect(rows[0]).toMatchObject({
      acquisition_session_id: "0198def-session",
      acquisition_channel: "Organic Social",
    });
  });

  it("leaves the columns null rather than guessing when the browser sent nothing", async () => {
    const userId = await signUpWith({});

    const rows = await db.execute(sql`
      SELECT acquisition_channel, acquisition_session_id
        FROM users
       WHERE id = ${userId}
    `);

    expect(rows[0]).toMatchObject({
      acquisition_channel: null,
      acquisition_session_id: null,
    });
  });

  it("groups signups by channel and campaign across the whole table", async () => {
    await signUpWith({ a_gclid: "g-1", a_utm_campaign: "brand-us" });
    await signUpWith({ a_gclid: "g-2", a_utm_campaign: "brand-us" });

    const rows = await db.execute(sql`
      SELECT acquisition_channel, acquisition_utm_campaign, COUNT(*)::int AS signups
        FROM users
       WHERE acquisition_utm_campaign = 'brand-us'
       GROUP BY 1, 2
    `);

    expect(rows).toContainEqual(
      expect.objectContaining({
        acquisition_channel: "Paid Search",
        acquisition_utm_campaign: "brand-us",
        signups: 3,
      })
    );
  });
});
