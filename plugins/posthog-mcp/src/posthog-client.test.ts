import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostHogApiError, PostHogClient } from "./posthog-client.js";
import { retryClock } from "./rate-limit-retry.js";

const client = () => new PostHogClient("https://us.posthog.com", "42", "pha_t");
const calls: Array<{ url: string; init: RequestInit }> = [];
let answers: Array<() => Response> = [];

beforeEach(() => {
  calls.length = 0;
  answers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return (answers.shift() ?? (() => new Response("{}", { status: 200 })))();
    })
  );
  vi.spyOn(retryClock, "sleep").mockImplementation(async () => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the PostHog client", () => {
  it("sends the token to the host, under the one project", async () => {
    await client().get("/insights/{id}/", { params: { id: 7 }, query: { refresh: "force_cache", search: undefined } });
    expect(calls[0].url).toBe("https://us.posthog.com/api/projects/42/insights/7/?refresh=force_cache");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer pha_t");
  });

  it("posts a query named for its tool, waiting for the result", async () => {
    await client().query({ kind: "HogQLQuery", query: "SELECT 1" }, "posthog_hogql_query");
    expect(calls[0].url).toBe("https://us.posthog.com/api/projects/42/query/");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      query: { kind: "HogQLQuery", query: "SELECT 1" },
      name: "datatorag:posthog_hogql_query",
      refresh: "blocking",
    });
  });

  it("says reconnect on 401 and not granted on 403", async () => {
    answers = [() => new Response("{}", { status: 401 }), () => new Response(JSON.stringify({ detail: "no" }), { status: 403 })];
    await expect(client().get("/")).rejects.toThrow(/needs reconnecting/);
    await expect(client().get("/")).rejects.toThrow(/not granted/);
  });

  it("retries a 429 once when PostHog asks for a short wait", async () => {
    answers = [() => new Response("{}", { status: 429, headers: { "Retry-After": "3" } })];
    await expect(client().get("/")).resolves.toEqual({});
    expect(calls).toHaveLength(2);
    expect(retryClock.sleep).toHaveBeenCalledWith(3000);
  });

  it("answers a 429 with a long wait at once, saying when to try again", async () => {
    answers = [() => new Response("{}", { status: 429, headers: { "Retry-After": "60" } })];
    const err = (await client().get("/").catch((e: unknown) => e)) as PostHogApiError;
    expect(err).toBeInstanceOf(PostHogApiError);
    expect(err.message).toMatch(/Try again in 60 seconds/);
    expect(calls).toHaveLength(1);
  });

  it("never retries a 5xx", async () => {
    answers = [() => new Response("oops", { status: 502 })];
    await expect(client().get("/")).rejects.toThrow(/PostHog answered 502/);
    expect(calls).toHaveLength(1);
  });

  it("runs at most two requests at once", async () => {
    let running = 0;
    let most = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return new Response("{}", { status: 200 });
      })
    );
    const c = client();
    await Promise.all([c.get("/"), c.get("/"), c.get("/"), c.get("/")]);
    expect(most).toBe(2);
  });

  it("logs the path template on a retry, never a value", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    answers = [() => new Response("{}", { status: 429, headers: { "Retry-After": "1" } })];
    await client().get("/persons/", { query: { search: "jane@example.com" } });
    expect(log.mock.calls.flat().join(" ")).toContain("/persons/");
    expect(log.mock.calls.flat().join(" ")).not.toContain("jane");
  });
});
