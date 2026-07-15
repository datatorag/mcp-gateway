#!/usr/bin/env node
// Sends a test message to each configured Slack webhook.
// Usage: SLACK_WEBHOOK_LEADS=... SLACK_WEBHOOK_DIGEST=... SLACK_WEBHOOK_ALERTS=... node scripts/test-slack.mjs
const channels = [
  ["SLACK_WEBHOOK_LEADS", "#leads"],
  ["SLACK_WEBHOOK_DIGEST", "#daily-digest"],
  ["SLACK_WEBHOOK_ALERTS", "#ops-alerts"],
];
for (const [envKey, label] of channels) {
  const url = process.env[envKey];
  if (!url) {
    console.log(`skip ${label} (${envKey} unset)`);
    continue;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `✅ test message from datatorag-mcp (${label})` }),
  });
  console.log(`${label}: HTTP ${res.status}`);
}
