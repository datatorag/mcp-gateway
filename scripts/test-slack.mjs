#!/usr/bin/env node
// Sends a test message to each configured Slack channel as the Dara bot.
// Usage: SLACK_BOT_TOKEN=... SLACK_CHANNEL_LEADS=... SLACK_CHANNEL_DIGEST=... SLACK_CHANNEL_ALERTS=... node scripts/test-slack.mjs
const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  console.log("SLACK_BOT_TOKEN unset — nothing to test");
  process.exit(1);
}
const channels = [
  ["SLACK_CHANNEL_LEADS", "#leads"],
  ["SLACK_CHANNEL_DIGEST", "#daily-digest"],
  ["SLACK_CHANNEL_ALERTS", "#ops-alerts"],
];
for (const [envKey, label] of channels) {
  const channel = process.env[envKey];
  if (!channel) {
    console.log(`skip ${label} (${envKey} unset)`);
    continue;
  }
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text: `✅ test message from datatorag-mcp (${label})`,
    }),
  });
  const data = await res.json().catch(() => null);
  console.log(`${label}: ${data?.ok ? "ok" : `FAILED ${data?.error ?? res.status}`}`);
}
