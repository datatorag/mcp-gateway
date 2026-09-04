import { and, eq, gte, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { leads, users, usageEvents, serviceConnections } from "@datatorag-mcp/db";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getEnv } from "@datatorag-mcp/config";
import { getStripe } from "../lib/stripe";
import { sendSlack, type SlackMessage } from "../lib/slack";
import { acquisitionSummary, type AcquisitionRow } from "./signup-alert";

export type DigestSections = {
  neon: string[] | null;
  stripe: string[] | null;
  posthog: string[] | null;
};

/**
 * A fact two sources can both report, so the digest can check them against
 * each other (SCRUM-212). THE RULE: when two sources disagree, the digest
 * says so. Two contradictory numbers printed side by side in silence look
 * reconciled, which is worse than printing neither. Only facts the sources
 * are meant to agree on belong here; a counter that undercounts by design
 * (usage_events, with its best-effort insert) would mark every day and
 * teach readers to ignore the marker.
 */
export type FactKey = "connections" | "signups";
export type Facts = Partial<Record<FactKey, number>>;

/** A collector may return bare lines, or lines plus the facts it can vouch
 * for. Bare lines keep the injected collectors in tests and any caller that
 * has nothing to reconcile working unchanged. */
export type CollectorResult = string[] | { lines: string[]; facts?: Facts };

export type Collectors = {
  neon: (db: Database, since: Date) => Promise<CollectorResult>;
  stripe: (since: Date) => Promise<CollectorResult>;
  posthog: (since: Date) => Promise<CollectorResult>;
};

const MAX_LEAD_LINES = 10; // Slack caps messages at 50 blocks; keep lists bounded
const MAX_SIGNUP_LINES = 10;
const NOT_CONFIGURED = ["_not configured — skipped_"]; // rendered for credential-less sources; asserted verbatim in tests
const FUNNEL_WINDOW_DAYS = 14;

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

// ── Product (DB) ──────────────────────────────────────────────────────

/** What the DB section renders from, gathered by collectNeon and formatted
 * by neonLines so the wording is testable without a database. */
export type NeonData = {
  leads: Array<{ name: string; email: string; company: string }>;
  signups: Array<{ name: string | null; email: string } & NonNullable<AcquisitionRow>>;
  usage: { calls: number; activeUsers: number };
  /** Every paying (pro) customer, with their calls in the window. The most
   * informative number the digest has (SCRUM-212): whether a paying customer
   * used the product today, named, and conspicuous at zero. */
  payingCustomers: Array<{ email: string; calls: number }>;
  newConnections: number;
  /** The running funnel: of the signups in the last `days`, how many have
   * ever connected a service. A zero with no denominator reads as quiet
   * when it may be the normal state of the funnel. */
  funnel: { connected: number; signups: number; days: number };
};

export function neonLines(d: NeonData): { lines: string[]; facts: Facts } {
  const lines: string[] = [];

  if (d.leads.length > 0) {
    lines.push(`*${d.leads.length} new lead${d.leads.length === 1 ? "" : "s"}:*`);
    for (const l of d.leads.slice(0, MAX_LEAD_LINES)) {
      lines.push(`• ${l.name} <${l.email}> — ${l.company}`);
    }
    if (d.leads.length > MAX_LEAD_LINES) {
      lines.push(`…and ${d.leads.length - MAX_LEAD_LINES} more`);
    }
  }

  // Named, with provenance: paid and organic are different news, and the
  // count alone flattened them.
  lines.push(`Signups: ${d.signups.length}`);
  for (const s of d.signups.slice(0, MAX_SIGNUP_LINES)) {
    lines.push(`• ${s.name ?? "(no name)"} <${s.email}>: ${acquisitionSummary(s)}`);
  }
  if (d.signups.length > MAX_SIGNUP_LINES) {
    lines.push(`…and ${d.signups.length - MAX_SIGNUP_LINES} more`);
  }

  lines.push(
    `Tool calls: ${d.usage.calls} (${d.usage.activeUsers} active user${d.usage.activeUsers === 1 ? "" : "s"})`
  );
  if (d.payingCustomers.length === 0) {
    lines.push("Paying customers: none");
  } else {
    const active = d.payingCustomers.filter((c) => c.calls > 0).length;
    const marker = active === 0 ? "⚠️ " : "";
    lines.push(`${marker}Paying customers active: ${active} of ${d.payingCustomers.length}`);
    for (const c of d.payingCustomers) {
      lines.push(`• ${c.email}: ${c.calls} call${c.calls === 1 ? "" : "s"}`);
    }
  }

  lines.push(`New service connections: ${d.newConnections}`);
  lines.push(
    `Connected: ${d.funnel.connected} of ${d.funnel.signups} signups in the last ${d.funnel.days} days`
  );

  return {
    lines,
    facts: { signups: d.signups.length, connections: d.newConnections },
  };
}

export async function collectNeon(db: Database, since: Date): Promise<CollectorResult> {
  const newLeads = await db
    .select({ name: leads.name, email: leads.email, company: leads.company })
    .from(leads)
    .where(and(gte(leads.createdAt, since), sql`NOT ${isInternalEmail(leads.email)}`));

  const signups = await db
    .select({
      name: users.name,
      email: users.email,
      acquisitionChannel: users.acquisitionChannel,
      acquisitionUtmSource: users.acquisitionUtmSource,
      acquisitionUtmMedium: users.acquisitionUtmMedium,
      acquisitionUtmCampaign: users.acquisitionUtmCampaign,
      acquisitionGclid: users.acquisitionGclid,
      acquisitionReferringDomain: users.acquisitionReferringDomain,
    })
    .from(users)
    .where(and(gte(users.createdAt, since), sql`NOT ${isInternalEmail(users.email)}`))
    .orderBy(users.createdAt);

  const [usage] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      activeUsers: sql<number>`count(distinct ${usageEvents.userId})::int`,
    })
    .from(usageEvents)
    .where(
      and(gte(usageEvents.createdAt, since), ...notInternalUserId(db, usageEvents.userId))
    );

  // Every paying customer, joined to their calls in the window. A LEFT join
  // on purpose: the customer who called nothing is the row this line exists
  // to show.
  const payingCustomers = await db
    .select({
      email: users.email,
      calls: sql<number>`count(${usageEvents.id})::int`,
    })
    .from(users)
    .leftJoin(
      usageEvents,
      and(eq(usageEvents.userId, users.id), gte(usageEvents.createdAt, since))
    )
    .where(and(eq(users.plan, "pro"), sql`NOT ${isInternalEmail(users.email)}`))
    .groupBy(users.id, users.email)
    .orderBy(users.email);

  const [conns] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(serviceConnections)
    .where(
      and(
        gte(serviceConnections.connectedAt, since),
        ...notInternalUserId(db, serviceConnections.userId)
      )
    );

  const windowStart = new Date(since.getTime() - (FUNNEL_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
  const [funnel] = await db
    .select({
      signups: sql<number>`count(*)::int`,
      connected: sql<number>`count(*) filter (where exists (select 1 from ${serviceConnections} where ${serviceConnections.userId} = ${users.id}))::int`,
    })
    .from(users)
    .where(and(gte(users.createdAt, windowStart), sql`NOT ${isInternalEmail(users.email)}`));

  return neonLines({
    leads: newLeads,
    signups,
    usage,
    payingCustomers,
    newConnections: conns.n,
    funnel: { connected: funnel.connected, signups: funnel.signups, days: FUNNEL_WINDOW_DAYS },
  });
}

// ── Revenue (Stripe) ──────────────────────────────────────────────────

/**
 * Each Stripe event labelled as what it IS, in a fixed order (SCRUM-211).
 *
 * `customer.created` is emitted by our own checkout route the moment
 * checkout BEGINS, before anyone has paid. Labelling it "New customers"
 * reported intent as revenue, and the digest announced a customer where
 * there was only a started checkout, while the same map held the two events
 * that would have contradicted it. A customer exists when a
 * subscription is created; a payment is a payment. A started checkout that
 * no subscription followed now says so on its own line, because that gap is
 * the signal, not the count.
 */
const STRIPE_LINES: Array<{ type: string; label: string }> = [
  { type: "customer.created", label: "Checkouts started" },
  { type: "customer.subscription.created", label: "New customers (subscription created)" },
  { type: "payment_intent.succeeded", label: "Payments succeeded" },
  { type: "payment_intent.payment_failed", label: "Payments FAILED" },
];

export function stripeLines(counts: Record<string, number>): string[] {
  const lines: string[] = [];
  const started = counts["customer.created"] ?? 0;
  const customers = counts["customer.subscription.created"] ?? 0;
  for (const { type, label } of STRIPE_LINES) {
    const n = counts[type] ?? 0;
    if (n === 0) continue;
    if (type === "customer.created") {
      const became =
        customers === 1 ? "1 became a customer" : `${customers} became customers`;
      lines.push(`${label}: ${started} (${became})`);
    } else {
      lines.push(`${label}: ${n}`);
    }
  }
  return lines;
}

export async function collectStripe(since: Date): Promise<CollectorResult> {
  if (!getEnv().STRIPE_API_KEY) return NOT_CONFIGURED;
  const stripe = getStripe();
  const events = await stripe.events.list({
    created: { gte: Math.floor(since.getTime() / 1000) },
    limit: 100,
  });
  const counts: Record<string, number> = {};
  for (const e of events.data) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return stripeLines(counts);
}

// ── Web + funnel (PostHog) ────────────────────────────────────────────

const POSTHOG_EVENTS = [
  "$pageview",
  "lead_submitted",
  "user_signed_up",
  "copy_mcp_config",
  "connector_added",
  "account_connected",
  "agent_run",
  "tool_call",
  "playground_tool_call",
];

/**
 * Labels that say what the event IS (SCRUM-211). `connector_added` is a
 * CLICK on the dashboard's connect button, captured client-side before OAuth
 * starts; it fires without a connection behind it and carries no user
 * email. `account_connected` is the server-side event emitted when a
 * connection is actually written, and it is the one the DB count can be
 * checked against. "Connectors added" was the click wearing the connection's
 * name, printed beside a DB count that contradicted it.
 */
const POSTHOG_LABELS: Record<string, string> = {
  $pageview: "Pageviews",
  lead_submitted: "Lead form submits",
  user_signed_up: "Signups",
  copy_mcp_config: "MCP config copies",
  connector_added: "Connect clicks (dashboard)",
  account_connected: "Accounts connected",
  agent_run: "Agent runs",
  tool_call: "Tool calls",
  // Kept only so history spanning the rename stays visible. Nothing emits
  // this any more; when it stops appearing it has aged out, not broken.
  playground_tool_call: "Tool calls (before the rename)",
};

export function posthogLines(rows: Array<[string, string, number]>): {
  lines: string[];
  facts: Facts;
} {
  const lines: string[] = [];
  for (const [event, , n] of rows) {
    if (event === "tool_call") continue; // aggregated below
    lines.push(`${POSTHOG_LABELS[event] ?? event}: ${n}`);
  }
  // ORDER BY event puts tool_call rows last, so appending the aggregate here
  // keeps the line order identical to the unsplit version of this digest.
  const toolCalls = rows.filter(([event]) => event === "tool_call");
  if (toolCalls.length > 0) {
    const total = toolCalls.reduce((sum, [, , n]) => sum + n, 0);
    const split = toolCalls.map(([, surface, n]) => `${n} ${surface}`).join(" / ");
    lines.push(`${POSTHOG_LABELS.tool_call}: ${total} (${split})`);
  }
  // Absent rows are a claim of zero, not silence: the query asked for these
  // events and none came back.
  const count = (event: string) =>
    rows.filter(([e]) => e === event).reduce((sum, [, , n]) => sum + n, 0);
  return {
    lines,
    facts: { connections: count("account_connected"), signups: count("user_signed_up") },
  };
}

export async function collectPosthog(since: Date): Promise<CollectorResult> {
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
    `WHERE timestamp >= toDateTime('${since.toISOString().slice(0, 19).replace("T", " ")}') ` +
    `AND event IN (${POSTHOG_EVENTS.map(hogqlStr).join(", ")}) ` +
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
  return posthogLines(data.results ?? []);
}

// ── Reconciliation ────────────────────────────────────────────────────

const FACT_LABELS: Record<FactKey, string> = {
  connections: "New service connections",
  signups: "Signups",
};

/** One line per shared fact the sources disagree on. Silent when they agree
 * and when either side has no facts to offer (a failed source is already
 * marked unavailable in its own section). */
export function reconcile(sources: { neon: Facts | null; posthog: Facts | null }): string[] {
  const { neon, posthog } = sources;
  if (!neon || !posthog) return [];
  const lines: string[] = [];
  for (const key of Object.keys(FACT_LABELS) as FactKey[]) {
    const a = neon[key];
    const b = posthog[key];
    if (a === undefined || b === undefined) continue;
    if (a !== b) lines.push(`${FACT_LABELS[key]}: DB says ${a}, PostHog says ${b}`);
  }
  return lines;
}

// ── Rendering ─────────────────────────────────────────────────────────

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

export function formatDigest(
  dateLabel: string,
  sections: DigestSections,
  disagreements: string[] = []
): SlackMessage {
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📊 Daily digest: ${dateLabel}`, emoji: true },
    },
    sectionBlock("Product (DB)", sections.neon),
    sectionBlock("Revenue (Stripe)", sections.stripe),
    sectionBlock("Web + funnel (PostHog)", sections.posthog),
  ];
  if (disagreements.length > 0) {
    // Conspicuous by design. Two numbers that disagree in silence look
    // reconciled; this block is what stops that.
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⚠️ Sources disagree*\n${disagreements.join("\n")}\n_One of these is wrong. Neither is confirmed until you know which._`,
      },
    });
  }
  return {
    text: `Daily digest: ${dateLabel}${disagreements.length > 0 ? " (sources disagree)" : ""}`,
    blocks,
  };
}

const defaultCollectors: Collectors = {
  neon: collectNeon,
  stripe: collectStripe,
  posthog: collectPosthog,
};

type SourceOutcome = { lines: string[]; facts: Facts | null } | null;

function normalise(result: CollectorResult): { lines: string[]; facts: Facts | null } {
  return Array.isArray(result)
    ? { lines: result, facts: null }
    : { lines: result.lines, facts: result.facts ?? null };
}

async function runSource(
  name: string,
  fn: () => Promise<CollectorResult>
): Promise<SourceOutcome> {
  try {
    return normalise(await fn());
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

  const disagreements = reconcile({
    neon: neon?.facts ?? null,
    posthog: posthog?.facts ?? null,
  });
  const message = formatDigest(
    dateLabel,
    {
      neon: neon?.lines ?? null,
      stripe: stripe?.lines ?? null,
      posthog: posthog?.lines ?? null,
    },
    disagreements
  );
  if (opts?.dryRun) {
    console.log(JSON.stringify(message, null, 2));
    return message;
  }
  await sendSlack("digest", message);
  return message;
}
