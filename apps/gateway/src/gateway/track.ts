import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { EVENTS, type ProviderId } from "../lib/analytics.js";
import { getPosthog, shutdownPosthog } from "../lib/posthog-server.js";
import { sendSlack } from "../lib/slack.js";
import { writeUsageEvent } from "./usage/write.js";
import { classifyOutcome, type ClassifyInput } from "./usage/classify.js";
import {
  resolveUserIdentity,
  resolveUserEmail,
  markUserActivated,
  identityProps,
} from "./user-email.js";

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
  const { status, meter } = classifyOutcome(props.outcome);
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
        error_message: props.errorMessage,
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
    errorMessage: props.errorMessage,
  });
  if (!result.ok) {
    console.warn(
      `[usage] write failed (${result.reason}) for user=${props.userId} tool=${props.toolName}`
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

export function trackSignup(
  userId: string,
  email: string,
  name: string | null
): void {
  void sendSlack("leads", {
    text: `👤 New signup: ${email}${name ? ` (${name})` : ""} — via Google OAuth`,
  });
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
export async function trackPlaygroundMessage(
  db: Database,
  userId: string
): Promise<void> {
  try {
    const c = getPosthog();
    if (!c) return;
    const identity = await resolveUserIdentity(db, userId);
    c.capture({
      distinctId: userId,
      event: EVENTS.PLAYGROUND_MESSAGE_SENT,
      properties: { ...identityProps(identity?.email ?? null) },
    });
  } catch (err) {
    console.warn(`[track] playground_message_sent failed for user=${userId}`, err);
  }
}

export async function trackPlaygroundToolCall(
  db: Database,
  userId: string,
  tool: string
): Promise<void> {
  try {
    const c = getPosthog();
    if (!c) return;
    const identity = await resolveUserIdentity(db, userId);
    c.capture({
      distinctId: userId,
      event: EVENTS.PLAYGROUND_TOOL_CALL,
      properties: { tool_name: tool, ...identityProps(identity?.email ?? null) },
    });
  } catch (err) {
    console.warn(`[track] playground_tool_call failed for user=${userId}`, err);
  }
}

export async function trackPlaygroundCapHit(
  db: Database,
  userId: string
): Promise<void> {
  try {
    const c = getPosthog();
    if (!c) return;
    const identity = await resolveUserIdentity(db, userId);
    c.capture({
      distinctId: userId,
      event: EVENTS.PLAYGROUND_CAP_HIT,
      properties: { ...identityProps(identity?.email ?? null) },
    });
  } catch (err) {
    console.warn(`[track] playground_cap_hit failed for user=${userId}`, err);
  }
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
