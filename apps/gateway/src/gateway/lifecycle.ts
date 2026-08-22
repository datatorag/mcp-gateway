import { and, eq, isNull, lte, gte, inArray } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users, serviceConnections } from "@datatorag-mcp/db";
import { sendSlack } from "../lib/slack";
import { scopeDelta } from "./scope-grant";
import {
  BREVO_TEMPLATE_WELCOME,
  BREVO_TEMPLATE_FOLLOWUP_CONNECT,
  BREVO_TEMPLATE_FOLLOWUP_PERMISSIONS,
  BREVO_TEMPLATE_FOLLOWUP_TRY_THIS,
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

/** Why a user has not activated, as far as their connections can say. */
export type FollowupState = "no-connection" | "missing-permissions" | "connected";

export type FollowupBranch = {
  state: FollowupState;
  templateId: number;
  /** Display names of the services no connection covers — the parameter the
   * permissions template renders. Empty in the other two states. */
  missingServices: string[];
};

/** The connection columns the branch reads. */
type ConnectionRow = { service: string; scopes: string | null };

/**
 * Which of the three follow-ups a user should get.
 *
 * Whether a grant is enough is NOT decided here: `scopeDelta` is the one
 * place that compares a stored grant against what the product needs
 * (SCRUM-136), and this composes its answers. A service counts as missing
 * only when EVERY connection is missing it — a user can hold more than one
 * connection for a service, and a second account that granted Drive means
 * Drive is not what is stopping them.
 */
export function followupBranch(
  connections: ReadonlyArray<ConnectionRow>
): FollowupBranch {
  if (connections.length === 0) {
    return {
      state: "no-connection",
      templateId: BREVO_TEMPLATE_FOLLOWUP_CONNECT,
      missingServices: [],
    };
  }
  const deltas = connections.map((c) => scopeDelta(c.service, c.scopes));
  const missingServices = deltas[0].missing
    .filter((m) => deltas.every((d) => d.missing.some((x) => x.scope === m.scope)))
    .map((m) => m.displayName);

  if (missingServices.length === 0) {
    return {
      state: "connected",
      templateId: BREVO_TEMPLATE_FOLLOWUP_TRY_THIS,
      missingServices: [],
    };
  }
  return {
    state: "missing-permissions",
    templateId: BREVO_TEMPLATE_FOLLOWUP_PERMISSIONS,
    missingServices,
  };
}

/**
 * Display names as they read mid-sentence: "Gmail", "Gmail and Drive",
 * "Gmail, Drive and Calendar". The template owns every other word; this is
 * only the list, because Brevo params are flat strings and a template cannot
 * join one itself.
 */
export function listInProse(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Connection rows for the run's candidates, grouped by user. One read for
 * the whole run rather than one per user. */
async function connectionsByUser(
  db: Database,
  userIds: string[]
): Promise<Map<string, ConnectionRow[]>> {
  const byUser = new Map<string, ConnectionRow[]>();
  if (userIds.length === 0) return byUser;
  const rows = await db
    .select({
      userId: serviceConnections.userId,
      service: serviceConnections.service,
      scopes: serviceConnections.scopes,
    })
    .from(serviceConnections)
    .where(inArray(serviceConnections.userId, userIds));
  for (const row of rows) {
    const list = byUser.get(row.userId);
    if (list) list.push(row);
    else byUser.set(row.userId, [row]);
  }
  return byUser;
}

/**
 * Daily no-activation follow-up: users 3+ days old with no successful tool
 * call get ONE of three templates once, chosen by `followupBranch` from their
 * connection state. The atomic claim (UPDATE ... WHERE
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

  // Read connection state up front — it decides WHICH email, never WHETHER
  // one is claimed, so it stays out of the claim/send sequence below.
  const connections = await connectionsByUser(
    db,
    external.map((u) => u.id)
  );
  const byState: Record<FollowupState, number> = {
    "no-connection": 0,
    "missing-permissions": 0,
    connected: 0,
  };

  for (const user of external) {
    const claimed = await db
      .update(users)
      .set({ noActivationFollowupSentAt: now })
      .where(
        and(eq(users.id, user.id), isNull(users.noActivationFollowupSentAt))
      )
      .returning({ id: users.id });
    if (claimed.length === 0) continue; // raced with another run

    // Claimed first, deliberately: one claim per user means one email per
    // user, whatever the branch below decides. Picking the template earlier
    // would read better and would reopen the double-send this ordering
    // exists to prevent.
    const branch = followupBranch(connections.get(user.id) ?? []);
    byState[branch.state]++;
    const params: Record<string, string> = {
      FIRSTNAME: firstNameOf(user.name),
    };
    if (branch.state === "missing-permissions") {
      params.MISSING_SERVICES = listInProse(branch.missingServices);
    }

    const ok = await sendBrevoTemplate(branch.templateId, user.email, params);
    if (ok) {
      result.sent++;
    } else {
      result.failed++;
      await sendSlack("alerts", {
        text: `🟠 No-activation follow-up (${branch.state}) claimed but FAILED to send to ${user.email} — send manually or clear no_activation_followup_sent_at to retry`,
      });
    }
  }

  if (result.eligible > 0) {
    console.log(
      `[lifecycle] follow-up run: ${result.sent}/${result.eligible} sent, ${result.failed} failed ` +
        `(no-connection ${byState["no-connection"]}, missing-permissions ${byState["missing-permissions"]}, connected ${byState.connected})`
    );
  }
  return result;
}
