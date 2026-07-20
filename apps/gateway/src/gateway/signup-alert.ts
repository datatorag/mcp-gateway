import { desc, eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { leads } from "@datatorag-mcp/db";
import { sendSlack } from "../lib/slack";
import { isInternalEmail } from "../lib/brevo";

/**
 * Real-time #leads post on every new signup (SCRUM-26) — not just lead-form
 * submissions. Fires from the signup path alongside the Brevo welcome flow.
 * Fire-and-forget: never throws, and skips internal accounts using the same
 * INTERNAL_EXCLUDE_EMAILS list as the lifecycle skip, so founder dogfooding
 * never reads as customer activity (the SCRUM-6 lesson).
 *
 * The message says whether the signup matches an existing leads row ("lead
 * converted" vs "direct signup") and carries the lead's UTM attribution when
 * present, in the same format as the lead-form post in api/leads/route.ts.
 */
export async function notifySignup(
  db: Database,
  user: { email: string; name: string | null; createdAt?: Date }
): Promise<void> {
  try {
    if (isInternalEmail(user.email)) {
      console.log(`[signup-alert] skipping internal ${user.email}`);
      return;
    }

    // Newest matching lead wins if the same email submitted the form twice.
    const [lead] = await db
      .select({
        utmSource: leads.utmSource,
        utmMedium: leads.utmMedium,
        utmCampaign: leads.utmCampaign,
      })
      .from(leads)
      .where(eq(leads.email, user.email))
      .orderBy(desc(leads.createdAt))
      .limit(1);

    const utmBits = [lead?.utmSource, lead?.utmMedium, lead?.utmCampaign]
      .filter(Boolean)
      .join(" / ");
    const signedUpAt = (user.createdAt ?? new Date()).toISOString();

    await sendSlack("leads", {
      text:
        `🟣 New signup: ${user.name ?? "(no name)"} <${user.email}>` +
        `\n${lead ? "Lead → signup conversion ✓" : "Direct signup (no matching lead)"}` +
        (utmBits ? `\nUTM: ${utmBits}` : "") +
        `\nSigned up: ${signedUpAt}`,
    });
  } catch (err) {
    console.warn(`[signup-alert] failed for ${user.email}`, err);
  }
}
