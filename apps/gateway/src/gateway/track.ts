import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { EVENTS, type ProviderId } from "../lib/analytics.js";
import { getPosthog, shutdownPosthog } from "../lib/posthog-server.js";
import { sendSlack } from "../lib/slack.js";
import { writeUsageEvent } from "./usage/write.js";
import { classifyOutcome, type ClassifyInput } from "./usage/classify.js";

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
      },
    });
  }

  // Activation milestone: only real MCP traffic counts — a playground call
  // from the dashboard doesn't prove the user's agent can reach the gateway.
  if (status === "success" && props.outcome.source === "mcp") {
    await trackFirstToolCall(db, props.userId, props.toolName, props.connectorType);
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
  connectorType: string | null
): Promise<void> {
  try {
    const claimed = await db
      .update(users)
      .set({ firstToolCallAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.firstToolCallAt)))
      .returning({ id: users.id });
    if (claimed.length === 0) return;
    const c = getPosthog();
    if (!c) return;
    c.capture({
      distinctId: userId,
      event: EVENTS.FIRST_TOOL_CALL,
      properties: { tool_name: toolName, connector_type: connectorType },
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
    properties: { email },
  });
}

export function trackLogin(userId: string): void {
  const c = getPosthog();
  if (!c) return;
  c.capture({
    distinctId: userId,
    event: EVENTS.USER_LOGGED_IN,
  });
}

export function trackOAuthCompleted(
  userId: string,
  provider: ProviderId,
  accountEmail: string
): void {
  const c = getPosthog();
  if (!c) return;
  c.capture({
    distinctId: userId,
    event: EVENTS.ACCOUNT_CONNECTED,
    properties: { provider, account_email: accountEmail },
  });
}
