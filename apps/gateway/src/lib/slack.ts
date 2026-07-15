import { getEnv } from "@datatorag-mcp/config";

export type SlackChannel = "leads" | "digest" | "alerts";

export interface SlackMessage {
  text: string; // fallback + notification line
  blocks?: unknown[]; // optional Block Kit
}

const ENV_KEY: Record<SlackChannel, "SLACK_WEBHOOK_LEADS" | "SLACK_WEBHOOK_DIGEST" | "SLACK_WEBHOOK_ALERTS"> = {
  leads: "SLACK_WEBHOOK_LEADS",
  digest: "SLACK_WEBHOOK_DIGEST",
  alerts: "SLACK_WEBHOOK_ALERTS",
};

/**
 * Post a message to a Slack incoming webhook. Fire-and-forget safe:
 * never throws, no-ops when the channel's webhook env var is unset.
 * Call as `void sendSlack(...)` in request paths.
 */
export async function sendSlack(channel: SlackChannel, message: SlackMessage): Promise<void> {
  const url = getEnv()[ENV_KEY[channel]];
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[slack] ${channel} webhook responded ${res.status}`);
    }
  } catch (err) {
    console.warn(`[slack] ${channel} send failed: ${(err as Error).message}`);
  }
}
