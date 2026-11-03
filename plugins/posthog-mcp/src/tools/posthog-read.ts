/**
 * The ten read tools (SCRUM-471): one PostHog call each, in the connection's
 * one project, nothing changed anywhere.
 *
 * Six go through PostHog's query endpoint. Trends, web overview and error
 * issues take a small flat set of arguments mapped onto PostHog's query
 * schema, so a model is never handed the whole of it; HogQL covers the rest.
 * Every answer is shaped to named fields and capped in rows, and the text is
 * capped last (`jsonResponse`). Wherever a range is, its end is required.
 */
import type { PostHogClient } from "../posthog-client.js";
import { READ, type ToolDef } from "./annotations.js";
import {
  DATE_DESCRIPTION,
  absoluteTime,
  date,
  optBool,
  optDate,
  optEnum,
  optEqualities,
  optInt,
  optStr,
  str,
} from "./args.js";
import { capKeys, capRows, jsonResponse } from "./response.js";

type Args = Record<string, unknown>;
type Result = ReturnType<typeof jsonResponse>;

const MAX_BREAKDOWN_VALUES = 25;
const HOGQL_DEFAULT_ROWS = 100;
const HOGQL_MAX_ROWS = 1_000;
const MAX_PROPERTIES = 20;
const INSIGHT_RESULT_ROWS = 100;

const MATHS = ["total", "dau", "weekly_active", "monthly_active", "unique_session"] as const;
const PROPERTY_MATHS = ["sum", "avg", "min", "max", "median", "p90", "p95", "p99"] as const;
const INTERVALS = ["hour", "day", "week", "month"] as const;
const ISSUE_STATUSES = ["active", "resolved", "suppressed", "all"] as const;
const ISSUE_ORDER = ["occurrences", "last_seen", "first_seen", "users", "sessions"] as const;

const DATE_ARG = { type: "string", description: DATE_DESCRIPTION };
const RANGE = {
  date_from: { ...DATE_ARG, description: `Start of the range. ${DATE_DESCRIPTION}` },
  date_to: { ...DATE_ARG, description: `End of the range, required so the numbers do not move. ${DATE_DESCRIPTION}` },
};
const TEST_ACCOUNTS = {
  filter_test_accounts: {
    type: "boolean",
    description: "Leave out the project's internal and test traffic, by its own test-account filters. Default true.",
  },
};
const EQUALITIES = {
  type: "array",
  maxItems: 5,
  items: {
    type: "object",
    properties: { key: { type: "string" }, value: { type: ["string", "number", "boolean"] } },
    required: ["key", "value"],
    additionalProperties: false,
  },
};
const LIMIT = (max: number, dflt: number) => ({
  limit: { type: "integer", minimum: 1, maximum: max, description: `How many to return, at most ${max}. Default ${dflt}.` },
});

export const posthogReadTools: ToolDef[] = [
  {
    name: "posthog_project_get",
    description: "The connected PostHog project: its id, name, organization and timezone. Read the timezone before choosing a date range.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ("Get the PostHog project"),
  },
  {
    name: "posthog_trends_query",
    description:
      "A trend of one to five events over a date range: counts, unique users, or a property's sum or average, per hour, day, week or month, optionally broken down by one event property (at most 25 values).",
    inputSchema: {
      type: "object",
      properties: {
        series: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          description: "The events to count.",
          items: {
            type: "object",
            properties: {
              event: { type: "string", description: "The event name, e.g. $pageview." },
              math: { type: "string", enum: [...MATHS, ...PROPERTY_MATHS], description: "How to count. Default total. sum and the rest need math_property." },
              math_property: { type: "string", description: "The event property a sum, average or percentile is over." },
              properties: { ...EQUALITIES, description: "Only events whose properties equal these, at most five." },
            },
            required: ["event"],
            additionalProperties: false,
          },
        },
        ...RANGE,
        interval: { type: "string", enum: [...INTERVALS], description: "Default day." },
        breakdown: { type: "string", description: "An event property to break the trend down by." },
        ...TEST_ACCOUNTS,
      },
      required: ["series", "date_from", "date_to"],
      additionalProperties: false,
    },
    annotations: READ("Query a trend"),
  },
  {
    name: "posthog_hogql_query",
    description:
      "Runs one HogQL SELECT (PostHog's SQL) in the project and returns its columns and rows. A LIMIT is added when the query has none, and a LIMIT above the cap is lowered. Keep queries narrow: PostHog stops a query after ten seconds. Tables include events, persons and sessions.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "One SELECT, or WITH ... SELECT. No semicolons between statements." },
        ...LIMIT(HOGQL_MAX_ROWS, HOGQL_DEFAULT_ROWS),
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: READ("Run a HogQL query"),
  },
  {
    name: "posthog_insights_list",
    description: "Saved insights, newest first, with a name search. Their results are not included; posthog_insight_get reads one.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of an insight's name or description." },
        saved: { type: "boolean", description: "Only insights saved by a person. Default true." },
        ...LIMIT(100, 20),
        offset: { type: "integer", minimum: 0, description: "How many to skip, to page through. Default 0." },
      },
      additionalProperties: false,
    },
    annotations: READ("List saved insights"),
  },
  {
    name: "posthog_insight_get",
    description:
      "One saved insight by its id or its short id (the code in its URL): its definition and its last computed result, at most 100 rows. refresh: force_cache (default) reads what PostHog has, blocking recomputes if stale.",
    inputSchema: {
      type: "object",
      properties: {
        insight_id: { type: "integer", minimum: 1, description: "The insight's numeric id." },
        short_id: { type: "string", description: "The insight's short id. Give this or insight_id." },
        refresh: { type: "string", enum: ["force_cache", "blocking"], description: "Default force_cache." },
      },
      additionalProperties: false,
    },
    annotations: READ("Get a saved insight"),
  },
  {
    name: "posthog_events_list",
    description:
      "Recent events in a date range, newest first: each event's id, name, time, distinct id and up to 20 of its properties. Filter by event name, a person, or properties equal to values.",
    inputSchema: {
      type: "object",
      properties: {
        ...RANGE,
        event: { type: "string", description: "Only this event name." },
        person_id: { type: "string", description: "Only this person's events, by the person's id." },
        properties: { ...EQUALITIES, description: "Only events whose properties equal these, at most five." },
        ...LIMIT(200, 50),
      },
      required: ["date_from", "date_to"],
      additionalProperties: false,
    },
    annotations: READ("List events"),
  },
  {
    name: "posthog_persons_search",
    description: "People by part of their email, name or distinct id: each one's id, up to five distinct ids, when they were first seen, and up to 20 properties.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of an email, name or distinct id." },
        ...LIMIT(100, 20),
      },
      required: ["search"],
      additionalProperties: false,
    },
    annotations: READ("Search people"),
  },
  {
    name: "posthog_dashboards_list",
    description: "The project's dashboards, with a name search: each one's id, name, description and whether it is pinned.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of a dashboard's name." },
        pinned: { type: "boolean", description: "Only pinned dashboards." },
        ...LIMIT(100, 20),
      },
      additionalProperties: false,
    },
    annotations: READ("List dashboards"),
  },
  {
    name: "posthog_error_issues_list",
    description:
      "Error tracking issues seen in a date range, ranked: each issue's id, name, status, occurrences, users, and when it was first and last seen.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: RANGE.date_from,
        date_to: { ...DATE_ARG, description: `End of the range. Default now. ${DATE_DESCRIPTION}` },
        status: { type: "string", enum: [...ISSUE_STATUSES], description: "Default active." },
        order_by: { type: "string", enum: [...ISSUE_ORDER], description: "Default occurrences." },
        ...LIMIT(100, 20),
        ...TEST_ACCOUNTS,
      },
      required: ["date_from"],
      additionalProperties: false,
    },
    annotations: READ("List error issues"),
  },
  {
    name: "posthog_web_overview",
    description:
      "Web analytics for a date range: visitors, page views, sessions, session duration and bounce rate, optionally against the period before.",
    inputSchema: {
      type: "object",
      properties: {
        ...RANGE,
        compare: { type: "boolean", description: "Also give the period before and the change. Default false." },
        ...TEST_ACCOUNTS,
      },
      required: ["date_from", "date_to"],
      additionalProperties: false,
    },
    annotations: READ("Get web analytics"),
  },
];

/** A list answer's `results`, or an empty list. */
function results(data: unknown): unknown[] {
  const r = (data as { results?: unknown })?.results;
  return Array.isArray(r) ? r : [];
}

function pick<T extends string>(row: unknown, keys: readonly T[]): Partial<Record<T, unknown>> {
  const out: Partial<Record<T, unknown>> = {};
  if (row && typeof row === "object") for (const k of keys) if (k in row) out[k] = (row as Record<string, unknown>)[k];
  return out;
}

function eventFilters(filters: Array<{ key: string; value: string | number | boolean }> | undefined) {
  return (filters ?? []).map((f) => ({ type: "event", key: f.key, value: f.value, operator: "exact" }));
}

function trendsQuery(args: Args): Record<string, unknown> {
  const series = args.series;
  if (!Array.isArray(series) || series.length < 1 || series.length > 5) throw new Error("series must be a list of one to five events.");
  const nodes = series.map((s, i) => {
    const item = (s ?? {}) as Args;
    const event = str(item, "event");
    const math = optEnum(item, "math", [...MATHS, ...PROPERTY_MATHS]);
    const mathProperty = optStr(item, "math_property");
    if (math && (PROPERTY_MATHS as readonly string[]).includes(math) && !mathProperty) {
      throw new Error(`series[${i}]: math ${math} needs math_property, the property it is over.`);
    }
    return {
      kind: "EventsNode",
      event,
      ...(math ? { math } : {}),
      ...(mathProperty ? { math_property: mathProperty } : {}),
      ...(item.properties !== undefined ? { properties: eventFilters(optEqualities(item, "properties", 5)) } : {}),
    };
  });
  const breakdown = optStr(args, "breakdown");
  return {
    kind: "TrendsQuery",
    series: nodes,
    dateRange: { date_from: date(args, "date_from"), date_to: date(args, "date_to") },
    interval: optEnum(args, "interval", INTERVALS) ?? "day",
    filterTestAccounts: optBool(args, "filter_test_accounts") ?? true,
    ...(breakdown ? { breakdownFilter: { breakdown, breakdown_type: "event", breakdown_limit: MAX_BREAKDOWN_VALUES } } : {}),
  };
}

/** The query with a LIMIT no higher than the cap: a trailing LIMIT is
 * lowered, and a query with none gets one. Exported for test. */
export function limitedHogQL(query: string, requested: number | undefined): string {
  const body = query.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(body)) throw new Error("query must be one SELECT (or WITH ... SELECT).");
  if (body.includes(";")) throw new Error("query must be one statement, with no semicolons inside it.");
  const cap = Math.min(requested ?? HOGQL_MAX_ROWS, HOGQL_MAX_ROWS);
  const trailing = /\blimit\s+(\d+)\s*$/i.exec(body);
  if (trailing) return `${body.slice(0, trailing.index)}LIMIT ${Math.min(Number(trailing[1]), cap)}`;
  return `${body}\nLIMIT ${requested ?? HOGQL_DEFAULT_ROWS}`;
}

/** The events query, every value a placeholder PostHog fills in, never text
 * in the query. Exported for test. */
export function eventsQuery(args: Args, now: Date): Record<string, unknown> {
  const values: Record<string, unknown> = {
    date_from: absoluteTime(date(args, "date_from"), now),
    date_to: absoluteTime(date(args, "date_to"), now),
  };
  const where = ["timestamp >= toDateTime({date_from})", "timestamp < toDateTime({date_to})"];
  const event = optStr(args, "event");
  if (event) {
    values.event = event;
    where.push("event = {event}");
  }
  const personId = optStr(args, "person_id");
  if (personId) {
    values.person_id = personId;
    where.push("person_id = {person_id}");
  }
  (optEqualities(args, "properties", 5) ?? []).forEach((f, i) => {
    values[`key_${i}`] = f.key;
    values[`value_${i}`] = String(f.value);
    where.push(`JSONExtractString(properties, {key_${i}}) = {value_${i}}`);
  });
  const limit = optInt(args, "limit", 1, 200) ?? 50;
  return {
    kind: "HogQLQuery",
    query: `SELECT uuid, event, timestamp, distinct_id, properties FROM events WHERE ${where.join(" AND ")} ORDER BY timestamp DESC LIMIT ${limit}`,
    values,
  };
}

async function projectGet(client: PostHogClient): Promise<Result> {
  // Named fields only: never the project's API token, and never its
  // test-account filters, whose values can be people's addresses.
  return jsonResponse(pick(await client.get("/"), ["id", "name", "organization", "timezone", "week_start_day"] as const));
}

async function trends(client: PostHogClient, args: Args): Promise<Result> {
  const data = await client.query(trendsQuery(args), "posthog_trends_query");
  const capped = capRows(results(data), MAX_BREAKDOWN_VALUES * 5);
  return jsonResponse({
    series: capped.rows.map((r) => pick(r, ["label", "breakdown_value", "count", "aggregated_value", "days", "data"] as const)),
    ...(capped.truncated ? { truncated: true } : {}),
  });
}

async function hogql(client: PostHogClient, args: Args): Promise<Result> {
  const query = limitedHogQL(str(args, "query"), optInt(args, "limit", 1, HOGQL_MAX_ROWS));
  const data = (await client.query({ kind: "HogQLQuery", query }, "posthog_hogql_query")) as { columns?: unknown; hasMore?: unknown };
  const capped = capRows(results(data), HOGQL_MAX_ROWS);
  return jsonResponse({
    columns: Array.isArray(data.columns) ? data.columns : [],
    rows: capped.rows,
    ...(capped.truncated || data.hasMore === true ? { truncated: true } : {}),
  });
}

async function insightsList(client: PostHogClient, args: Args): Promise<Result> {
  const data = await client.get("/insights/", {
    query: {
      search: optStr(args, "search"),
      saved: optBool(args, "saved") ?? true,
      limit: optInt(args, "limit", 1, 100) ?? 20,
      offset: optInt(args, "offset", 0, 1_000_000),
      basic: true,
    },
  });
  return jsonResponse({
    insights: results(data).map((r) => pick(r, ["id", "short_id", "name", "description", "last_refresh"] as const)),
    count: (data as { count?: unknown }).count,
  });
}

async function insightGet(client: PostHogClient, args: Args): Promise<Result> {
  const id = optInt(args, "insight_id", 1, Number.MAX_SAFE_INTEGER);
  const shortId = optStr(args, "short_id");
  if ((id === undefined) === (shortId === undefined)) throw new Error("Give insight_id or short_id, one of them.");
  const refresh = optEnum(args, "refresh", ["force_cache", "blocking"] as const) ?? "force_cache";
  let insight: unknown;
  if (id !== undefined) {
    insight = await client.get("/insights/{id}/", { params: { id }, query: { refresh } });
  } else {
    insight = results(await client.get("/insights/", { query: { short_id: shortId, refresh } }))[0];
    if (!insight) throw new Error("No saved insight has that short_id in this project.");
  }
  const raw = (insight as { result?: unknown }).result;
  const capped = Array.isArray(raw) ? capRows(raw, INSIGHT_RESULT_ROWS) : { rows: raw, truncated: false };
  return jsonResponse({
    ...pick(insight, ["id", "short_id", "name", "description", "query", "last_refresh"] as const),
    result: capped.rows,
    ...(capped.truncated ? { truncated: true } : {}),
  });
}

async function eventsList(client: PostHogClient, args: Args): Promise<Result> {
  const data = (await client.query(eventsQuery(args, new Date()), "posthog_events_list")) as { columns?: unknown };
  const columns = Array.isArray(data.columns) ? (data.columns as string[]) : ["uuid", "event", "timestamp", "distinct_id", "properties"];
  return jsonResponse({
    events: results(data).map((row) => {
      const r = Array.isArray(row) ? Object.fromEntries(columns.map((c, i) => [c, row[i]])) : (row as Record<string, unknown>);
      const props = typeof r.properties === "string" ? safeJson(r.properties) : r.properties;
      return { ...pick(r, ["uuid", "event", "timestamp", "distinct_id"] as const), properties: capKeys(props, MAX_PROPERTIES) };
    }),
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function personsSearch(client: PostHogClient, args: Args): Promise<Result> {
  const data = await client.get("/persons/", { query: { search: str(args, "search"), limit: optInt(args, "limit", 1, 100) ?? 20 } });
  return jsonResponse({
    persons: results(data).map((r) => {
      const p = r as { distinct_ids?: unknown; properties?: unknown };
      return {
        ...pick(r, ["id", "uuid", "created_at"] as const),
        distinct_ids: Array.isArray(p.distinct_ids) ? p.distinct_ids.slice(0, 5) : [],
        properties: capKeys(p.properties, MAX_PROPERTIES),
      };
    }),
  });
}

async function dashboardsList(client: PostHogClient, args: Args): Promise<Result> {
  const data = await client.get("/dashboards/", {
    query: { search: optStr(args, "search"), pinned: optBool(args, "pinned"), limit: optInt(args, "limit", 1, 100) ?? 20 },
  });
  return jsonResponse({
    dashboards: results(data).map((r) => pick(r, ["id", "name", "description", "pinned"] as const)),
    count: (data as { count?: unknown }).count,
  });
}

async function errorIssuesList(client: PostHogClient, args: Args): Promise<Result> {
  const status = optEnum(args, "status", ISSUE_STATUSES) ?? "active";
  const query = {
    kind: "ErrorTrackingQuery",
    dateRange: { date_from: date(args, "date_from"), date_to: optDate(args, "date_to") ?? null },
    orderBy: optEnum(args, "order_by", ISSUE_ORDER) ?? "occurrences",
    ...(status === "all" ? {} : { status }),
    volumeResolution: 1,
    limit: optInt(args, "limit", 1, 100) ?? 20,
    filterTestAccounts: optBool(args, "filter_test_accounts") ?? true,
  };
  const data = await client.query(query, "posthog_error_issues_list");
  return jsonResponse({
    issues: capRows(results(data), 100).rows.map((r) => {
      const a = ((r as { aggregations?: unknown }).aggregations ?? {}) as Record<string, unknown>;
      return {
        ...pick(r, ["id", "name", "status", "first_seen", "last_seen"] as const),
        occurrences: a.occurrences,
        users: a.users,
      };
    }),
  });
}

async function webOverview(client: PostHogClient, args: Args): Promise<Result> {
  const query = {
    kind: "WebOverviewQuery",
    properties: [],
    dateRange: { date_from: date(args, "date_from"), date_to: date(args, "date_to") },
    ...(optBool(args, "compare") ? { compareFilter: { compare: true } } : {}),
    filterTestAccounts: optBool(args, "filter_test_accounts") ?? true,
  };
  const data = await client.query(query, "posthog_web_overview");
  return jsonResponse({
    metrics: results(data).map((r) => pick(r, ["key", "kind", "value", "previous", "changeFromPreviousPct"] as const)),
  });
}

const HANDLERS: Record<string, (client: PostHogClient, args: Args) => Promise<Result>> = {
  posthog_project_get: projectGet,
  posthog_trends_query: trends,
  posthog_hogql_query: hogql,
  posthog_insights_list: insightsList,
  posthog_insight_get: insightGet,
  posthog_events_list: eventsList,
  posthog_persons_search: personsSearch,
  posthog_dashboards_list: dashboardsList,
  posthog_error_issues_list: errorIssuesList,
  posthog_web_overview: webOverview,
};

export async function handlePostHogRead(client: PostHogClient, name: string, args: Args): Promise<Result> {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(client, args);
}
