import { desc, eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { leads, users } from "@datatorag-mcp/db";
import { sendSlack } from "../lib/slack";
import { isInternalEmail } from "../lib/brevo";

/**
 * Real-time #leads post on every new signup (SCRUM-26) — not just lead-form
 * submissions. Fires from the signup path alongside the Brevo welcome flow.
 * Fire-and-forget: never throws, and skips internal accounts using the same
 * INTERNAL_EXCLUDE_EMAILS list as the lifecycle skip, so founder dogfooding
 * never reads as customer activity (the SCRUM-6 lesson).
 *
 * Provenance comes from the acquisition_* columns on the users row (SCRUM-85)
 * — read back from the row rather than passed in, so the alert reports what
 * was actually stored: a failed persist surfaces as the explicit "unknown"
 * line instead of silently echoing data the row never got. The lead-form
 * match ("Lead match") is kept as a secondary line; it answers a narrower
 * question (did this email submit /demo) and must not read as the only
 * provenance we have.
 */
export async function notifySignup(
  db: Database,
  user: { id: string; email: string; name: string | null; createdAt?: Date }
): Promise<void> {
  try {
    if (isInternalEmail(user.email)) {
      console.log(`[signup-alert] skipping internal ${user.email}`);
      return;
    }

    const [acquisition] = await db
      .select({
        acquisitionChannel: users.acquisitionChannel,
        acquisitionUtmSource: users.acquisitionUtmSource,
        acquisitionUtmMedium: users.acquisitionUtmMedium,
        acquisitionUtmCampaign: users.acquisitionUtmCampaign,
        acquisitionGclid: users.acquisitionGclid,
        acquisitionReferringDomain: users.acquisitionReferringDomain,
        acquisitionEntryUrl: users.acquisitionEntryUrl,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

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

    const signedUpAt = (user.createdAt ?? new Date()).toISOString();
    const entryPath = entryPathLine(acquisition?.acquisitionEntryUrl ?? null);

    await sendSlack("leads", {
      text:
        `🟣 New signup: ${user.name ?? "(no name)"} <${user.email}>` +
        `\n${acquisitionSourceLine(acquisition)}` +
        (entryPath ? `\nLanded: ${entryPath}` : "") +
        `\n${leadMatchLine(lead)}` +
        `\nSigned up: ${signedUpAt}`,
    });
  } catch (err) {
    console.warn(`[signup-alert] failed for ${user.email}`, err);
  }
}

export type AcquisitionRow =
  | {
      acquisitionChannel: string | null;
      acquisitionUtmSource: string | null;
      acquisitionUtmMedium: string | null;
      acquisitionUtmCampaign: string | null;
      acquisitionGclid: string | null;
      acquisitionReferringDomain: string | null;
    }
  | undefined;

/**
 * One scannable line. An absent snapshot is stated explicitly — a blank reads
 * as "nothing to report", the explicit string reads as "capture did not work",
 * and the latter is the signal that lets us notice attribution regressions
 * from the channel itself.
 *
 * Shared with the new-customer alert and the daily digest (SCRUM-212), so
 * "where did this person come from" reads the same on every Slack surface.
 * The words below are the acquisition summary without the "Source: " prefix.
 */
export function acquisitionSummary(a: AcquisitionRow): string {
  if (!a?.acquisitionChannel) return "unknown (no acquisition data captured)";
  const detail = [
    a.acquisitionUtmSource,
    a.acquisitionUtmMedium,
    a.acquisitionUtmCampaign ? `campaign ${a.acquisitionUtmCampaign}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  // Organic channels carry no utm set; the referring domain is the detail.
  const shown = detail || a.acquisitionReferringDomain || "";
  // Presence only — the raw gclid is long, unreadable, and nothing a human
  // acts on in Slack.
  const gclid = a.acquisitionGclid ? " (gclid ✓)" : "";
  return `${a.acquisitionChannel}${shown ? ` - ${shown}` : ""}${gclid}`;
}

export function acquisitionSourceLine(a: AcquisitionRow): string {
  return `Source: ${acquisitionSummary(a)}`;
}

/** Entry PATH only: the query string is where all the length is and none of
 *  the meaning (and it can carry the raw gclid). */
function entryPathLine(entryUrl: string | null): string | null {
  if (!entryUrl) return null;
  try {
    return new URL(entryUrl).pathname;
  } catch {
    // Client-supplied value that isn't an absolute URL: still drop everything
    // from the first "?" so the no-query-string (and no-gclid) rule holds.
    return entryUrl.split("?")[0];
  }
}

function leadMatchLine(
  lead:
    | { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null }
    | undefined
): string {
  if (!lead) return "Lead match: none";
  const utm = [lead.utmSource, lead.utmMedium, lead.utmCampaign]
    .filter(Boolean)
    .join(" / ");
  return `Lead match: ✓ converted${utm ? ` (${utm})` : ""}`;
}
