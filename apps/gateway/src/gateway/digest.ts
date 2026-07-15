import { gte, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { leads, users, usageEvents, serviceConnections } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { getStripe } from "../lib/stripe.js";
import { sendSlack, type SlackMessage } from "../lib/slack.js";

export type DigestSections = {
  neon: string[] | null;
  stripe: string[] | null;
  posthog: string[] | null;
};

export type Collectors = {
  neon: (db: Database, since: Date) => Promise<string[]>;
  stripe: (since: Date) => Promise<string[]>;
  posthog: (since: Date) => Promise<string[]>;
};

const MAX_LEAD_LINES = 10; // Slack caps messages at 50 blocks; keep lists bounded

export async function collectNeon(db: Database, since: Date): Promise<string[]> {
  const lines: string[] = [];

  const newLeads = await db
    .select({ name: leads.name, email: leads.email, company: leads.company })
    .from(leads)
    .where(gte(leads.createdAt, since));
  if (newLeads.length > 0) {
    lines.push(`*${newLeads.length} new lead${newLeads.length === 1 ? "" : "s"}:*`);
    for (const l of newLeads.slice(0, MAX_LEAD_LINES)) {
      lines.push(`• ${l.name} <${l.email}> — ${l.company}`);
    }
    if (newLeads.length > MAX_LEAD_LINES) {
      lines.push(`…and ${newLeads.length - MAX_LEAD_LINES} more`);
    }
  }

  const [signups] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(gte(users.createdAt, since));
  lines.push(`Signups: ${signups.n}`);

  const [usage] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      activeUsers: sql<number>`count(distinct ${usageEvents.userId})::int`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, since));
  lines.push(`Tool calls: ${usage.calls} (${usage.activeUsers} active user${usage.activeUsers === 1 ? "" : "s"})`);

  const [conns] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(serviceConnections)
    .where(gte(serviceConnections.connectedAt, since));
  lines.push(`New service connections: ${conns.n}`);

  return lines;
}

export async function collectStripe(since: Date): Promise<string[]> {
  if (!getEnv().STRIPE_API_KEY) return ["_not configured — skipped_"];
  const stripe = getStripe();
  const events = await stripe.events.list({
    created: { gte: Math.floor(since.getTime() / 1000) },
    limit: 100,
  });
  const counts = new Map<string, number>();
  const INTERESTING: Record<string, string> = {
    "customer.created": "New customers",
    "customer.subscription.created": "New subscriptions",
    "payment_intent.succeeded": "Payments succeeded",
    "payment_intent.payment_failed": "Payments FAILED",
  };
  for (const e of events.data) {
    if (INTERESTING[e.type]) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  return [...counts.entries()].map(([type, n]) => `${INTERESTING[type]}: ${n}`);
}

export async function collectPosthog(since: Date): Promise<string[]> {
  const { POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID } = getEnv();
  if (!POSTHOG_PERSONAL_API_KEY || !POSTHOG_PROJECT_ID) return ["_not configured — skipped_"];
  const hogql =
    "SELECT event, count() AS n FROM events " +
    "WHERE timestamp >= now() - INTERVAL 1 DAY " +
    "AND event IN ('$pageview', 'lead_submitted', 'copy_mcp_config', 'connector_added') " +
    "GROUP BY event ORDER BY event";
  const res = await fetch(
    `https://us.posthog.com/api/projects/${POSTHOG_PROJECT_ID}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`PostHog query failed: ${res.status}`);
  const data = (await res.json()) as { results: [string, number][] };
  const LABELS: Record<string, string> = {
    $pageview: "Pageviews",
    lead_submitted: "Lead form submits",
    copy_mcp_config: "MCP config copies",
    connector_added: "Connectors added",
  };
  if (!data.results || data.results.length === 0) return [];
  return data.results.map(([event, n]) => `${LABELS[event] ?? event}: ${n}`);
}

function sectionBlock(title: string, lines: string[] | null): unknown {
  const body =
    lines === null
      ? "_unavailable (source errored — see #ops-alerts)_"
      : lines.length === 0
        ? "_nothing new_"
        : lines.join("\n");
  return {
    type: "section",
    text: { type: "mrkdwn", text: `*${title}*\n${body}` },
  };
}

export function formatDigest(dateLabel: string, sections: DigestSections): SlackMessage {
  return {
    text: `Daily digest — ${dateLabel}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `📊 Daily digest — ${dateLabel}`, emoji: true },
      },
      sectionBlock("Product (DB)", sections.neon),
      sectionBlock("Revenue (Stripe)", sections.stripe),
      sectionBlock("Web + funnel (PostHog)", sections.posthog),
    ],
  };
}

const defaultCollectors: Collectors = {
  neon: collectNeon,
  stripe: collectStripe,
  posthog: collectPosthog,
};

async function runSource(
  name: string,
  fn: () => Promise<string[]>
): Promise<string[] | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[digest] ${name} collector failed`, err);
    void sendSlack("alerts", {
      text: `🟠 Digest source "${name}" failed: ${(err as Error).message}`,
    });
    return null;
  }
}

export async function runDailyDigest(
  db: Database,
  opts?: { dryRun?: boolean; collectors?: Partial<Collectors> }
): Promise<SlackMessage> {
  const c = { ...defaultCollectors, ...opts?.collectors };
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const [neon, stripe, posthog] = await Promise.all([
    runSource("neon", () => c.neon(db, since)),
    runSource("stripe", () => c.stripe(since)),
    runSource("posthog", () => c.posthog(since)),
  ]);

  const message = formatDigest(dateLabel, { neon, stripe, posthog });
  if (opts?.dryRun) {
    console.log(JSON.stringify(message, null, 2));
    return message;
  }
  await sendSlack("digest", message);
  return message;
}
