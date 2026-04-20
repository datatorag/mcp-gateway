import { PostHog } from "posthog-node";
import { getEnv } from "@datatorag-mcp/config";
import type { Database } from "@datatorag-mcp/db";
import { EVENTS, type ProviderId } from "../lib/analytics.js";
import { writeUsageEvent } from "./usage/write.js";
import { classifyOutcome, type ClassifyInput } from "./usage/classify.js";

const POSTHOG_HOST = "https://us.i.posthog.com";

let client: PostHog | null = null;

function getClient(): PostHog | null {
  const apiKey = getEnv().POSTHOG_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new PostHog(apiKey, {
      host: POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10_000,
    });
  }
  return client;
}

export async function shutdownPosthog(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}

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
  const c = getClient();
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

export function trackSignup(
  userId: string,
  email: string,
  name: string | null
): void {
  const c = getClient();
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
  const c = getClient();
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
  const c = getClient();
  if (!c) return;
  c.capture({
    distinctId: userId,
    event: EVENTS.ACCOUNT_CONNECTED,
    properties: { provider, account_email: accountEmail },
  });
}
