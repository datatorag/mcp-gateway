import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostHogClient } from "../posthog-client.js";
import { eventsQuery, handlePostHogRead, limitedHogQL, posthogReadTools } from "./posthog-read.js";
import { MAX_RESPONSE_CHARS } from "./response.js";

const get = vi.fn();
const query = vi.fn();
const client = { get, query } as unknown as PostHogClient;
const out = async (name: string, args: Record<string, unknown>) =>
  JSON.parse((await handlePostHogRead(client, name, args)).content[0].text) as Record<string, unknown>;

beforeEach(() => {
  get.mockReset().mockResolvedValue({});
  query.mockReset().mockResolvedValue({ results: [] });
});

describe("the ten tools", () => {
  it("are ten reads, closed to unknown arguments, with no em-dash", () => {
    expect(posthogReadTools.map((t) => t.name)).toEqual([
      "posthog_project_get",
      "posthog_trends_query",
      "posthog_hogql_query",
      "posthog_insights_list",
      "posthog_insight_get",
      "posthog_events_list",
      "posthog_persons_search",
      "posthog_dashboards_list",
      "posthog_error_issues_list",
      "posthog_web_overview",
    ]);
    for (const t of posthogReadTools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(JSON.stringify(t)).not.toMatch(/[–—]/);
    }
  });

  it("require the end of every range they take", () => {
    for (const name of ["posthog_trends_query", "posthog_events_list", "posthog_web_overview"]) {
      expect(posthogReadTools.find((t) => t.name === name)!.inputSchema.required).toEqual(expect.arrayContaining(["date_from", "date_to"]));
    }
  });
});

describe("posthog_project_get", () => {
  it("never returns the project's API token or its test-account filters", async () => {
    get.mockResolvedValue({
      id: 42,
      name: "Acme",
      organization: "org",
      timezone: "UTC",
      api_token: "phc_secret",
      test_account_filters: [{ value: "someone@example.com" }],
    });
    const text = (await handlePostHogRead(client, "posthog_project_get", {})).content[0].text;
    expect(JSON.parse(text)).toEqual({ id: 42, name: "Acme", organization: "org", timezone: "UTC" });
    expect(text).not.toContain("phc_secret");
    expect(text).not.toContain("someone@example.com");
  });
});

describe("posthog_trends_query", () => {
  it("maps the flat arguments onto a TrendsQuery, filtering test accounts by default", async () => {
    await out("posthog_trends_query", {
      series: [{ event: "$pageview", math: "dau", properties: [{ key: "$host", value: "example.com" }] }],
      date_from: "-7d",
      date_to: "2026-11-01",
      breakdown: "$browser",
    });
    expect(query).toHaveBeenCalledWith(
      {
        kind: "TrendsQuery",
        series: [{ kind: "EventsNode", event: "$pageview", math: "dau", properties: [{ type: "event", key: "$host", value: "example.com", operator: "exact" }] }],
        dateRange: { date_from: "-7d", date_to: "2026-11-01" },
        interval: "day",
        filterTestAccounts: true,
        breakdownFilter: { breakdown: "$browser", breakdown_type: "event", breakdown_limit: 25 },
      },
      "posthog_trends_query"
    );
  });

  it("refuses a missing date_to, and a property math with no property", async () => {
    await expect(handlePostHogRead(client, "posthog_trends_query", { series: [{ event: "e" }], date_from: "-7d" })).rejects.toThrow(/date_to is required/);
    await expect(
      handlePostHogRead(client, "posthog_trends_query", { series: [{ event: "e", math: "sum" }], date_from: "-7d", date_to: "-1d" })
    ).rejects.toThrow(/needs math_property/);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("posthog_hogql_query", () => {
  it("adds LIMIT 100 when there is none, and lowers one above the cap", () => {
    expect(limitedHogQL("SELECT event FROM events", undefined)).toBe("SELECT event FROM events\nLIMIT 100");
    expect(limitedHogQL("select event from events limit 5000;", undefined)).toBe("select event from events LIMIT 1000");
    expect(limitedHogQL("SELECT 1 LIMIT 10", undefined)).toBe("SELECT 1 LIMIT 10");
    expect(limitedHogQL("SELECT 1 LIMIT 500", 50)).toBe("SELECT 1 LIMIT 50");
    expect(limitedHogQL("WITH x AS (SELECT 1 LIMIT 3) SELECT * FROM x", undefined)).toBe("WITH x AS (SELECT 1 LIMIT 3) SELECT * FROM x\nLIMIT 100");
  });

  it("refuses anything but one SELECT", () => {
    expect(() => limitedHogQL("DELETE FROM events", undefined)).toThrow(/one SELECT/);
    expect(() => limitedHogQL("SELECT 1; SELECT 2", undefined)).toThrow(/one statement/);
  });

  it("returns the columns and rows", async () => {
    query.mockResolvedValue({ columns: ["event"], results: [["$pageview"]] });
    expect(await out("posthog_hogql_query", { query: "SELECT event FROM events" })).toEqual({ columns: ["event"], rows: [["$pageview"]] });
  });
});

describe("posthog_events_list", () => {
  it("passes every value as a placeholder, never inside the query text", () => {
    const nasty = "x') OR 1=1 --";
    const q = eventsQuery(
      { date_from: "2026-10-01", date_to: "2026-11-01", event: nasty, person_id: nasty, properties: [{ key: nasty, value: nasty }] },
      new Date("2026-11-02T00:00:00Z")
    );
    expect(q.query).not.toContain(nasty);
    expect(q.values).toMatchObject({ event: nasty, person_id: nasty, key_0: nasty, value_0: nasty, date_from: "2026-10-01T00:00:00Z" });
  });

  it("turns a relative range into times, and caps each event's properties at 20", async () => {
    const q = eventsQuery({ date_from: "-7d", date_to: "-1d" }, new Date("2026-11-08T00:00:00Z"));
    expect(q.values).toEqual({ date_from: "2026-11-01T00:00:00.000Z", date_to: "2026-11-07T00:00:00.000Z" });
    const props = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, i]));
    query.mockResolvedValue({ columns: ["uuid", "event", "timestamp", "distinct_id", "properties"], results: [["u", "e", "t", "d", JSON.stringify(props)]] });
    const res = await out("posthog_events_list", { date_from: "-7d", date_to: "-1d" });
    const [event] = res.events as Array<{ properties: Record<string, unknown> }>;
    expect(Object.keys(event.properties)).toHaveLength(20);
  });
});

describe("posthog_insight_get", () => {
  it("reads by id or short id, one of them, and caps the result at 100 rows", async () => {
    await expect(handlePostHogRead(client, "posthog_insight_get", {})).rejects.toThrow(/one of them/);
    get.mockResolvedValue({ id: 7, name: "n", result: Array.from({ length: 150 }, (_, i) => i), filters: { x: 1 } });
    const res = await out("posthog_insight_get", { insight_id: 7 });
    expect(get).toHaveBeenCalledWith("/insights/{id}/", { params: { id: 7 }, query: { refresh: "force_cache" } });
    expect((res.result as unknown[]).length).toBe(100);
    expect(res.truncated).toBe(true);
    get.mockResolvedValue({ results: [{ id: 8, short_id: "abc" }] });
    expect(await out("posthog_insight_get", { short_id: "abc" })).toMatchObject({ id: 8 });
  });
});

describe("posthog_error_issues_list", () => {
  it("sends an ErrorTrackingQuery with the range, order and resolution PostHog requires", async () => {
    query.mockResolvedValue({ results: [{ id: "i", name: "TypeError", status: "active", aggregations: { occurrences: 3, users: 2 } }] });
    const res = await out("posthog_error_issues_list", { date_from: "-7d" });
    expect(query.mock.calls[0][0]).toMatchObject({ kind: "ErrorTrackingQuery", dateRange: { date_from: "-7d" }, orderBy: "occurrences", volumeResolution: 1, status: "active" });
    expect(res.issues).toEqual([{ id: "i", name: "TypeError", status: "active", occurrences: 3, users: 2 }]);
  });
});

describe("the other reads", () => {
  it("search people, list dashboards and insights, and read web analytics with their caps", async () => {
    get.mockResolvedValue({ results: [{ id: 1, distinct_ids: ["a", "b", "c", "d", "e", "f"], properties: {} }] });
    const persons = await out("posthog_persons_search", { search: "jane" });
    expect(get).toHaveBeenCalledWith("/persons/", { query: { search: "jane", limit: 20 } });
    expect((persons.persons as Array<{ distinct_ids: string[] }>)[0].distinct_ids).toHaveLength(5);

    await out("posthog_dashboards_list", { pinned: true });
    expect(get).toHaveBeenLastCalledWith("/dashboards/", { query: { search: undefined, pinned: true, limit: 20 } });

    await out("posthog_insights_list", {});
    expect(get).toHaveBeenLastCalledWith("/insights/", { query: { search: undefined, saved: true, limit: 20, offset: undefined, basic: true } });

    await out("posthog_web_overview", { date_from: "-7d", date_to: "-1d", compare: true });
    expect(query).toHaveBeenLastCalledWith(
      { kind: "WebOverviewQuery", properties: [], dateRange: { date_from: "-7d", date_to: "-1d" }, compareFilter: { compare: true }, filterTestAccounts: true },
      "posthog_web_overview"
    );
  });

  it("cuts a result over the text cap and says so", async () => {
    query.mockResolvedValue({ columns: ["x"], results: Array.from({ length: 1000 }, () => ["y".repeat(100)]) });
    const text = (await handlePostHogRead(client, "posthog_hogql_query", { query: "SELECT x FROM t" })).content[0].text;
    expect(text.length).toBeLessThan(MAX_RESPONSE_CHARS + 200);
    expect(text).toMatch(/\[truncated: \d+ of \d+ characters left out/);
  });
});
