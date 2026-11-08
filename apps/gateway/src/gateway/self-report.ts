import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { getPosthog } from "@/lib/posthog-server";
import { EVENTS } from "@/lib/analytics";
import { identityProps } from "./user-email";

/**
 * "How did you find DataToRAG?" (SCRUM-480): one question on a new user's
 * signup landing, answered in their own words. The `acquisition_*` columns
 * hold what the browser carried; this is the answer for the cases no browser
 * signal survives (a copied link, an in-app webview, word of mouth).
 *
 * The state is the user's, in two columns: the answer, and where the prompt
 * is (null, "shown", "answered", "skipped"). Each move is one guarded UPDATE,
 * so the prompt shows once and its event fires once, whatever the browser
 * does (a reload, two tabs, a replayed request).
 */

export const SELF_REPORT_MAX_CHARS = 500;

/** A signup landing is the first page after sign-in, seconds after the row
 * was made. The window keeps a typed `?signup=1` on an older account from
 * asking someone who signed up long ago. */
const SIGNUP_LANDING_WINDOW_MS = 60 * 60 * 1000;

/** The answer as stored: text only, trimmed, capped. Markup is removed rather
 * than escaped, because the answer is read as data and never rendered as
 * markup. Null when nothing is left. */
export function cleanSelfReport(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/<[^>]*>/g, " ")
    // An unclosed tag survives the line above; no angle bracket does.
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SELF_REPORT_MAX_CHARS)
    .trim();
  return text === "" ? null : text;
}

/**
 * Whether to ask, decided once: true for exactly one signup landing of a user
 * created within the last hour who has never been asked. The claim is the
 * UPDATE, so two landings at once cannot both win.
 */
export async function claimSelfReportPrompt(db: Database, userId: string, now = new Date()): Promise<boolean> {
  try {
    const claimed = await db
      .update(users)
      .set({ acquisitionSelfReportState: "shown" })
      .where(
        and(
          eq(users.id, userId),
          isNull(users.acquisitionSelfReportState),
          gt(users.createdAt, new Date(now.getTime() - SIGNUP_LANDING_WINDOW_MS))
        )
      )
      .returning({ id: users.id });
    return claimed.length === 1;
  } catch (err) {
    // A question about how they found us must never break the landing.
    console.warn(`[self-report] claim failed for user=${userId}`, err);
    return false;
  }
}

export type SelfReport = { answer: string | null; skipped: boolean };

/**
 * Record the answer, or the skip, for a prompt that was shown and not yet
 * settled, and send the one event beside it. An answer that cleans to
 * nothing is a skip. Returns false when there was nothing to settle.
 */
export async function recordSelfReport(db: Database, userId: string, input: SelfReport): Promise<boolean> {
  const answer = input.skipped ? null : cleanSelfReport(input.answer);
  const skipped = answer === null;
  const [row] = await db
    .update(users)
    .set({ acquisitionSelfReported: answer, acquisitionSelfReportState: skipped ? "skipped" : "answered" })
    .where(and(eq(users.id, userId), eq(users.acquisitionSelfReportState, "shown")))
    .returning({
      email: users.email,
      channel: users.acquisitionChannel,
      utmSource: users.acquisitionUtmSource,
      utmMedium: users.acquisitionUtmMedium,
      utmCampaign: users.acquisitionUtmCampaign,
      gclid: users.acquisitionGclid,
      referringDomain: users.acquisitionReferringDomain,
      entryUrl: users.acquisitionEntryUrl,
    });
  if (!row) return false;
  const c = getPosthog();
  if (c) {
    c.capture({
      distinctId: userId,
      event: EVENTS.ACQUISITION_SELF_REPORTED,
      properties: {
        ...identityProps(row.email),
        answer,
        skipped,
        // The measured answer beside the told one, as stored on the user.
        acquisition_channel: row.channel,
        acquisition_utm_source: row.utmSource,
        acquisition_utm_medium: row.utmMedium,
        acquisition_utm_campaign: row.utmCampaign,
        acquisition_gclid: row.gclid,
        acquisition_referring_domain: row.referringDomain,
        acquisition_entry_url: row.entryUrl,
      },
    });
  }
  return true;
}
