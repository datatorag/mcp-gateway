import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { EVENTS, type ProviderId } from "../lib/analytics";
import { getPosthog, shutdownPosthog } from "../lib/posthog-server";
import { sendSlack } from "../lib/slack";
import { writeUsageEvent } from "./usage/write";
import { redactErrorMessage } from "./usage/redact";
import { classifyOutcome, type ClassifyInput } from "./usage/classify";
import {
  resolveUserIdentity,
  resolveUserEmail,
  markUserActivated,
  identityProps,
} from "./user-email";

export { shutdownPosthog };

export async function trackToolCall(
  db: Database,
  props: {
    userId: string;
    toolName: string;
    connectorType: string | null;
    accountEmail: string | undefined;
    latencyMs: number;
    responseSizeBytes: number | null;
    errorMessage: string | null;
    outcome: ClassifyInput;
  }
): Promise<void> {
  // Metering + analytics run fire-and-forget off the tool-response path (see the
  // call sites in mcp-server.ts) so the identity lookup and sinks never add
  // latency to the tool call. Because it's not awaited, this must never reject —
  // a floating rejection would surface as an unhandled rejection. Everything is
  // best-effort: on any failure we log and move on.
  try {
    const { status, meter } = classifyOutcome(props.outcome);
    // Redact once, up front, so the SAME scrubbed value reaches every sink —
    // PostHog (a third-party US vendor) and our own Postgres alike. The redactor
    // is idempotent, so writeUsageEvent re-scrubbing below is a harmless no-op.
    const errorMessage = redactErrorMessage(props.errorMessage);
    const c = getPosthog();
    const identity = await resolveUserIdentity(db, props.userId);
    const userEmail = identity?.email ?? null;
    if (c) {
      c.capture({
        distinctId: props.userId,
        event: EVENTS.TOOL_CALL,
        properties: {
          tool_name: props.toolName,
          connector_type: props.connectorType,
          account_email: props.accountEmail ?? null,
          status,
          latency_ms: props.latencyMs,
          response_size_bytes: props.responseSizeBytes,
          error_message: errorMessage,
          metered: meter,
          ...identityProps(userEmail),
        },
      });
    }

    // Activation milestone: only real MCP traffic counts — a playground call
    // from the dashboard doesn't prove the user's agent can reach the gateway.
    // Skipped once the cache knows the user is activated, so the per-call
    // claim UPDATE runs at most once per user per process.
    if (status === "success" && props.outcome.source === "mcp" && !identity?.activated) {
      await trackFirstToolCall(
        db,
        props.userId,
        props.toolName,
        props.connectorType,
        userEmail
      );
    }

    if (!meter) return;

    const result = await writeUsageEvent(db, {
      userId: props.userId,
      toolName: props.toolName,
      connector: props.connectorType,
      accountEmail: props.accountEmail ?? null,
      status,
      latencyMs: props.latencyMs,
      responseSizeBytes: props.responseSizeBytes,
      errorMessage,
    });
    if (!result.ok) {
      console.warn(
        `[usage] write failed (${result.reason}) for user=${props.userId} tool=${props.toolName}`
      );
    }
  } catch (err) {
    console.warn(
      `[track] tool_call tracking failed for user=${props.userId} tool=${props.toolName}`,
      err
    );
  }
}

/**
 * Claim the user's first-successful-tool-call milestone. The UPDATE ... WHERE
 * first_tool_call_at IS NULL is the idempotency guard: exactly one call ever
 * gets a row back, so the first_tool_call event fires once per user even
 * under concurrent tool calls. Never throws — the milestone must not break
 * the tool-call path.
 */
async function trackFirstToolCall(
  db: Database,
  userId: string,
  toolName: string,
  connectorType: string | null,
  userEmail: string | null
): Promise<void> {
  try {
    const claimed = await db
      .update(users)
      .set({ firstToolCallAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.firstToolCallAt)))
      .returning({ id: users.id });
    // The claim ran, so first_tool_call_at is now non-null either way.
    markUserActivated(userId);
    if (claimed.length === 0) return;
    const c = getPosthog();
    if (!c) return;
    c.capture({
      distinctId: userId,
      event: EVENTS.FIRST_TOOL_CALL,
      properties: {
        tool_name: toolName,
        connector_type: connectorType,
        ...identityProps(userEmail),
      },
    });
  } catch (err) {
    console.warn(
      `[track] first_tool_call milestone failed for user=${userId}`,
      err
    );
  }
}

// The #leads Slack post for signups lives in signup-alert.ts (notifySignup),
// which adds lead-match + attribution and skips internal accounts — this
// function is PostHog-only (SCRUM-26 moved the Slack line out).
export function trackSignup(
  userId: string,
  email: string,
  name: string | null
): void {
  const c = getPosthog();
  if (!c) return;
  c.identify({
    distinctId: userId,
    properties: { email, name: name ?? undefined },
  });
  c.capture({
    distinctId: userId,
    event: EVENTS.USER_SIGNED_UP,
    properties: { email, ...identityProps(email) },
  });
}

export function trackLogin(userId: string, email: string): void {
  const c = getPosthog();
  if (!c) return;
  c.capture({
    distinctId: userId,
    event: EVENTS.USER_LOGGED_IN,
    properties: identityProps(email),
  });
}

/**
 * Playground chat analytics — separate from trackToolCall/usage_events
 * (playground calls stay unmetered; see usage/classify.ts). Never throws:
 * a PostHog capture failure must not break the streaming chat response.
 */
async function capturePlaygroundEvent(
  db: Database,
  userId: string,
  event: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  try {
    const c = getPosthog();
    if (!c) return;
    const identity = await resolveUserIdentity(db, userId);
    c.capture({
      distinctId: userId,
      event,
      properties: { ...properties, ...identityProps(identity?.email ?? null) },
    });
  } catch (err) {
    console.warn(`[track] ${event} failed for user=${userId}`, err);
  }
}

export async function trackPlaygroundMessage(
  db: Database,
  userId: string
): Promise<void> {
  return capturePlaygroundEvent(db, userId, EVENTS.PLAYGROUND_MESSAGE_SENT);
}

export async function trackPlaygroundToolCall(
  db: Database,
  userId: string,
  tool: string
): Promise<void> {
  return capturePlaygroundEvent(db, userId, EVENTS.PLAYGROUND_TOOL_CALL, {
    tool_name: tool,
  });
}

export async function trackPlaygroundCapHit(
  db: Database,
  userId: string
): Promise<void> {
  return capturePlaygroundEvent(db, userId, EVENTS.PLAYGROUND_CAP_HIT);
}

/** Write-confirmation gate: "shown" when a turn pauses for approval,
 * "approved"/"denied" on the user's decision. `writeCount` = pending writes. */
export async function trackPlaygroundConfirm(
  db: Database,
  userId: string,
  kind: "shown" | "approved" | "denied",
  writeCount: number
): Promise<void> {
  return capturePlaygroundEvent(db, userId, EVENTS.PLAYGROUND_CONFIRM, {
    kind,
    write_count: writeCount,
  });
}

/**
 * Playground thumbs up/down feedback — PostHog capture for analytics plus a
 * Slack ping to #feedback so a human sees it right away. The Slack post is
 * fire-and-forget (never awaited) so a slow/unreachable Slack API never
 * delays the response; the PostHog capture is best-effort and never throws.
 */
export async function trackPlaygroundFeedback(
  db: Database,
  userId: string,
  rating: "up" | "down",
  comment?: string,
  prompt?: string
): Promise<void> {
  const identity = await resolveUserIdentity(db, userId);
  const email = identity?.email ?? null;

  try {
    const c = getPosthog();
    if (c) {
      c.capture({
        distinctId: userId,
        event: EVENTS.PLAYGROUND_FEEDBACK,
        properties: {
          rating,
          comment: comment ?? null,
          prompt: prompt ?? null,
          ...identityProps(email),
        },
      });
    }
  } catch (err) {
    console.warn(`[track] playground_feedback capture failed for user=${userId}`, err);
  }

  const emoji = rating === "up" ? "👍" : "👎";
  const commentText = comment && comment.length > 0 ? comment : "(no comment)";
  const promptSuffix = prompt ? ` — prompt: ${prompt.slice(0, 200)}` : "";
  void sendSlack("feedback", {
    text: `${emoji} Playground feedback from ${email ?? "unknown"}: ${commentText}${promptSuffix}`,
  });
}

export async function trackOAuthCompleted(
  db: Database,
  userId: string,
  provider: ProviderId,
  accountEmail: string
): Promise<void> {
  const c = getPosthog();
  if (!c) return;
  const email = await resolveUserEmail(db, userId);
  c.capture({
    distinctId: userId,
    event: EVENTS.ACCOUNT_CONNECTED,
    properties: {
      provider,
      account_email: accountEmail,
      ...identityProps(email),
    },
  });
}
