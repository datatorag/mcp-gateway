import { and, gte, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { leads, users, usageEvents, serviceConnections } from "@datatorag-mcp/db";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getEnv } from "@datatorag-mcp/config";
import { getStripe } from "../lib/stripe";
import { sendSlack, type SlackMessage } from "../lib/slack";

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
const NOT_CONFIGURED = ["_not configured — skipped_"]; // rendered for credential-less sources; asserted verbatim in tests

// ── Internal-traffic exclusion ────────────────────────────────────────
// Raw HogQL/API queries do NOT inherit PostHog's insight-level test-account
// filters, and DB counts see every row — so the digest must exclude internal
// traffic itself or dogfooding shows up as customer activity. The @datatorag.com
// domain is excluded unconditionally; the specific email/id lists live in env
// (INTERNAL_EXCLUDE_EMAILS / INTERNAL_EXCLUDE_IDS, comma-separated), NOT in
// this public repo. Keep those env values mirrored with the PostHog
// "Internal / Test users" cohort.

function csv(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function internalExclusion(): { emails: string[]; ids: string[] } {
  const env = getEnv();
  return {
    // Emails are matched lowercased on both sides; ids keep their case —
    // distinct_id comparison is case-sensitive in HogQL.
    emails: csv(env.INTERNAL_EXCLUDE_EMAILS).map((e) => e.toLowerCase()),
    ids: csv(env.INTERNAL_EXCLUDE_IDS),
  };
}

// HogQL string literal — single quotes escaped ClickHouse-style.
const hogqlStr = (s: string) => `'${s.replace(/'/g, "\\'")}'`;

/**
 * WHERE-clause fragment (leading `AND ...`) excluding internal traffic from a
 * HogQL events query. Uses coalesce() because a NULL email would make
 * `NOT IN` evaluate to NULL and silently drop every anonymous event.
 */
export function posthogInternalFilterSql(): string {
  const { emails, ids } = internalExclusion();
  const clauses = [
    "coalesce(person.properties.email, '') NOT ILIKE '%@datatorag.com'",
  ];
  if (emails.length > 0) {
    clauses.push(
      `lower(coalesce(person.properties.email, '')) NOT IN (${emails.map(hogqlStr).join(", ")})`
    );
  }
  if (ids.length > 0) {
    clauses.push(`distinct_id NOT IN (${ids.map(hogqlStr).join(", ")})`);
  }
  return clauses.map((c) => `AND ${c}`).join(" ");
}

// SQL condition: this email column belongs to an internal/test account.
function isInternalEmail(emailCol: PgColumn): SQL {
  const { emails } = internalExclusion();
  const domainMatch = sql`${emailCol} ILIKE '%@datatorag.com'`;
  if (emails.length === 0) return domainMatch;
  return sql`(${domainMatch} OR ${inArray(sql`lower(${emailCol})`, emails)})`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Conditions excluding internal users from a table keyed by user id.
// Only UUID-shaped ids can bind against uuid columns — a PostHog-only
// distinct_id in the env list would make Postgres throw 22P02 and take the
// whole Neon section down. Non-UUID ids still apply in the HogQL filter.
function notInternalUserId(db: Database, userIdCol: PgColumn): SQL[] {
  const ids = internalExclusion().ids.filter((id) => UUID_RE.test(id));
  const internalUsers = db
    .select({ id: users.id })
    .from(users)
    .where(isInternalEmail(users.email));
  const conds: SQL[] = [notInArray(userIdCol, internalUsers)];
  if (ids.length > 0) conds.push(notInArray(userIdCol, ids));
  return conds;
}

export async function collectNeon(db: Database, since: Date): Promise<string[]> {
  const lines: string[] = [];

  const newLeads = await db
    .select({ name: leads.name, email: leads.email, company: leads.company })
    .from(leads)
    .where(and(gte(leads.createdAt, since), sql`NOT ${isInternalEmail(leads.email)}`));
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
    .where(and(gte(users.createdAt, since), sql`NOT ${isInternalEmail(users.email)}`));
  lines.push(`Signups: ${signups.n}`);

  const [usage] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      activeUsers: sql<number>`count(distinct ${usageEvents.userId})::int`,
    })
    .from(usageEvents)
    .where(
      and(gte(usageEvents.createdAt, since), ...notInternalUserId(db, usageEvents.userId))
    );
  lines.push(`Tool calls: ${usage.calls} (${usage.activeUsers} active user${usage.activeUsers === 1 ? "" : "s"})`);

  const [conns] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(serviceConnections)
    .where(
      and(
        gte(serviceConnections.connectedAt, since),
        ...notInternalUserId(db, serviceConnections.userId)
      )
    );
  lines.push(`New service connections: ${conns.n}`);

  return lines;
}

export async function collectStripe(since: Date): Promise<string[]> {
  if (!getEnv().STRIPE_API_KEY) return NOT_CONFIGURED;
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
  if (!POSTHOG_PERSONAL_API_KEY || !POSTHOG_PROJECT_ID) return NOT_CONFIGURED;
  // THE CUTOVER RULE, stated here once and referenced from elsewhere rather
  // than restated, because a rule copied into three queries becomes three
  // rules the first time one of them is edited:
  //
  //   Events recorded before the surface attribute existed do not carry it.
  //   Absent `surface` means "mcp". The agent surface additionally emitted
  //   under an older event name, so any query spanning the change has to
  //   union it in. There is no backfill and there will not be one — the
  //   attribute was never captured, so there is nothing to recover.
  //
  // Same shape as the acquisition columns: rows that predate the change are
  // permanently null and the query carries the knowledge instead.
  // The tool_call count is additionally split by surface. Only the event
  // stream can answer "which door did the traffic come through" —
  // usage_events has no surface column (see usage/exclusions.ts for why),
  // so the DB section's total stays unsplit and this line carries the split.
  const hogql =
    "SELECT event, " +
    "if(event = 'tool_call', coalesce(nullif(JSONExtractString(properties, 'surface'), ''), 'mcp'), '') AS surface, " +
    "count() AS n FROM events " +
    "WHERE timestamp >= now() - INTERVAL 1 DAY " +
    "AND event IN ('$pageview', 'lead_submitted', 'copy_mcp_config', " +
    "'connector_added', 'agent_run', 'tool_call', 'playground_tool_call') " +
    `${posthogInternalFilterSql()} ` +
    "GROUP BY event, surface ORDER BY event, surface";
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
  const data = (await res.json()) as { results: [string, string, number][] };
  const LABELS: Record<string, string> = {
    $pageview: "Pageviews",
    lead_submitted: "Lead form submits",
    copy_mcp_config: "MCP config copies",
    connector_added: "Connectors added",
    agent_run: "Agent runs",
    tool_call: "Tool calls",
    // Kept only so history spanning the rename stays visible. Nothing emits
    // this any more; when it stops appearing it has aged out, not broken.
    playground_tool_call: "Tool calls (before the rename)",
  };
  if (!data.results || data.results.length === 0) return [];
  const lines: string[] = [];
  for (const [event, , n] of data.results) {
    if (event === "tool_call") continue; // aggregated below
    lines.push(`${LABELS[event] ?? event}: ${n}`);
  }
  // ORDER BY event puts tool_call rows last, so appending the aggregate here
  // keeps the line order identical to the unsplit version of this digest.
  const toolCalls = data.results.filter(([event]) => event === "tool_call");
  if (toolCalls.length > 0) {
    const total = toolCalls.reduce((sum, [, , n]) => sum + n, 0);
    const split = toolCalls.map(([, surface, n]) => `${n} ${surface}`).join(" / ");
    lines.push(`Tool calls: ${total} (${split})`);
  }
  return lines;
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
    await sendSlack("alerts", {
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
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dateLabel = now.toLocaleDateString("en-US", {
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
