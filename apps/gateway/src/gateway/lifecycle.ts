import { and, eq, isNull, lte, gte } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { sendSlack } from "../lib/slack";
import {
  BREVO_TEMPLATE_WELCOME,
  BREVO_TEMPLATE_NO_ACTIVATION,
  hasBrevoKey,
  isInternalEmail,
  sendBrevoTemplate,
  upsertBrevoContact,
} from "../lib/brevo";

/**
 * Lifecycle emails only apply to users created after this feature shipped —
 * everyone who existed before got the manual 2026-07-17 welcome campaign,
 * and must not receive back-to-back emails from the automated flow.
 */
export const LIFECYCLE_LAUNCH = new Date("2026-07-17T22:00:00Z");

const FOLLOWUP_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

export function firstNameOf(name: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first || "there";
}

/**
 * Welcome flow on signup: upsert the Brevo contact into the Product Users
 * list, then send the welcome template. Fire-and-forget from the signup
 * path — never throws, no-ops for internal accounts or a missing API key.
 */
export async function sendWelcomeEmail(user: {
  email: string;
  name: string | null;
  createdAt?: Date;
  plan?: string;
}): Promise<void> {
  try {
    if (isInternalEmail(user.email)) {
      console.log(`[lifecycle] skipping welcome for internal ${user.email}`);
      return;
    }
    if (!hasBrevoKey()) {
      console.warn(
        `[lifecycle] BREVO_API_KEY not set — welcome email NOT sent to ${user.email}`
      );
      return;
    }
    const firstName = firstNameOf(user.name);
    await upsertBrevoContact({
      email: user.email,
      firstName,
      signupDate: user.createdAt ?? new Date(),
      plan: user.plan,
    });
    const sent = await sendBrevoTemplate(BREVO_TEMPLATE_WELCOME, user.email, {
      FIRSTNAME: firstName,
    });
    if (sent) console.log(`[lifecycle] welcome email sent to ${user.email}`);
  } catch (err) {
    console.warn(`[lifecycle] welcome flow failed for ${user.email}`, err);
  }
}

export type FollowupResult = {
  eligible: number;
  sent: number;
  failed: number;
};

/**
 * Daily no-activation follow-up: users 3+ days old with no successful tool
 * call get the nudge template once. The atomic claim (UPDATE ... WHERE
 * no_activation_followup_sent_at IS NULL) runs BEFORE the send, so a crash
 * or concurrent run can drop an email but can never double-send one; send
 * failures alert #ops-alerts with the claimed email for manual recovery.
 */
export async function runNoActivationFollowup(
  db: Database,
  opts?: { now?: Date }
): Promise<FollowupResult> {
  const result: FollowupResult = { eligible: 0, sent: 0, failed: 0 };
  if (!hasBrevoKey()) {
    // Exit before claiming anything: claiming without sending would burn a
    // user's one follow-up. Users stay eligible until the key lands in SSM.
    console.warn("[lifecycle] BREVO_API_KEY not set — follow-up run skipped");
    return result;
  }
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - FOLLOWUP_DELAY_MS);

  const candidates = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(
      and(
        lte(users.createdAt, cutoff),
        gte(users.createdAt, LIFECYCLE_LAUNCH),
        isNull(users.firstToolCallAt),
        isNull(users.noActivationFollowupSentAt)
      )
    );

  const external = candidates.filter((u) => !isInternalEmail(u.email));
  result.eligible = external.length;

  for (const user of external) {
    const claimed = await db
      .update(users)
      .set({ noActivationFollowupSentAt: now })
      .where(
        and(eq(users.id, user.id), isNull(users.noActivationFollowupSentAt))
      )
      .returning({ id: users.id });
    if (claimed.length === 0) continue; // raced with another run

    const ok = await sendBrevoTemplate(BREVO_TEMPLATE_NO_ACTIVATION, user.email, {
      FIRSTNAME: firstNameOf(user.name),
    });
    if (ok) {
      result.sent++;
    } else {
      result.failed++;
      await sendSlack("alerts", {
        text: `🟠 No-activation follow-up claimed but FAILED to send to ${user.email} — send manually or clear no_activation_followup_sent_at to retry`,
      });
    }
  }

  if (result.eligible > 0) {
    console.log(
      `[lifecycle] follow-up run: ${result.sent}/${result.eligible} sent, ${result.failed} failed`
    );
  }
  return result;
}
