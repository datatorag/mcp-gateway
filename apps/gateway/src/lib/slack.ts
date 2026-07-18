import { getEnv } from "@datatorag-mcp/config";

export type SlackChannel = "leads" | "digest" | "alerts";

export interface SlackMessage {
  text: string; // fallback + notification line
  blocks?: unknown[]; // optional Block Kit
}

const CHANNEL_ENV: Record<
  SlackChannel,
  "SLACK_CHANNEL_LEADS" | "SLACK_CHANNEL_DIGEST" | "SLACK_CHANNEL_ALERTS"
> = {
  leads: "SLACK_CHANNEL_LEADS",
  digest: "SLACK_CHANNEL_DIGEST",
  alerts: "SLACK_CHANNEL_ALERTS",
};

/**
 * Post a message to Slack as the Dara bot via chat.postMessage.
 * Fire-and-forget safe: never throws, no-ops when the bot token or the
 * channel id env var is unset. Call as `void sendSlack(...)` in request
 * paths. Note chat.postMessage reports failures as HTTP 200 with
 * `ok: false`, so both layers are checked.
 */
export async function sendSlack(channel: SlackChannel, message: SlackMessage): Promise<void> {
  const env = getEnv();
  const token = env.SLACK_BOT_TOKEN;
  const channelId = env[CHANNEL_ENV[channel]];
  if (!token || !channelId) return;
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: channelId, ...message }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (!res.ok || !data?.ok) {
      console.warn(
        `[slack] ${channel} post failed: ${data?.error ?? `HTTP ${res.status}`}`
      );
    }
  } catch (err) {
    console.warn(`[slack] ${channel} send failed: ${(err as Error).message}`);
  }
}
