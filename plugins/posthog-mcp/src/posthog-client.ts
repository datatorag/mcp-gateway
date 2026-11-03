/**
 * PostHog REST and query client (SCRUM-471).
 *
 * One session's client holds the regional host, the one project the
 * connection was granted, and the user's access token. Every path is under
 * `/api/projects/{project}/`, so a call can reach no other project. Every
 * tool is a read, so a refusal for rate may be retried; nothing else is.
 *
 * Paths are given as TEMPLATES with their values beside them, so a log line
 * prints the template and never an id, a search or a query. A query is
 * posted with a `name` saying which tool sent it, so each reads plainly in
 * PostHog's query log.
 *
 * At most two requests run at once per session: PostHog runs three queries
 * at once per project and queues the rest, and a session should leave room
 * for the project's own dashboards.
 */

import { MAX_ATTEMPTS, retryClock, retryWaitMs } from "./rate-limit-retry.js";

/** One request's limit. PostHog stops a query after ten seconds of
 * execution; this covers a queue wait on top. */
const REQUEST_TIMEOUT_MS = 45_000;
export const MAX_CONCURRENT = 2;

export const RECONNECT_MESSAGE =
  "PostHog refused the connection's access token, so the PostHog connection needs reconnecting. The gateway's " +
  "connect tool gives a link to reconnect it.";

export const NOT_GRANTED_MESSAGE =
  "PostHog refused: this connection was not granted that. It is read-only and holds one project.";

/** A PostHog call that was answered, and answered no. */
export class PostHogApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    /** Seconds PostHog asked to wait, on a refusal for rate. */
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "PostHogApiError";
  }
}

function parseErrorBody(text: string): { code?: string; detail?: string } {
  try {
    const body = JSON.parse(text) as { code?: unknown; detail?: unknown };
    if (body && typeof body === "object") {
      return {
        code: typeof body.code === "string" ? body.code : undefined,
        detail: typeof body.detail === "string" ? body.detail : undefined,
      };
    }
  } catch {
    // Not JSON: a proxy's page, an empty body. Reported as text below.
  }
  return {};
}

/** Whole seconds from `Retry-After`, or undefined for anything else. */
export function retryAfterSeconds(header: string | null): number | undefined {
  const trimmed = header?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/** The error for a refused answer. Exported for test. */
export function errorFor(status: number, text: string, retryAfter: string | null): PostHogApiError {
  const { code, detail } = parseErrorBody(text);
  if (status === 401) return new PostHogApiError(`${RECONNECT_MESSAGE} (PostHog: 401)`, status, code);
  if (status === 403) return new PostHogApiError(`${NOT_GRANTED_MESSAGE}${detail ? ` PostHog said: ${detail.slice(0, 300)}` : ""}`, status, code);
  if (status === 429) {
    const seconds = retryAfterSeconds(retryAfter);
    const when = seconds === undefined ? "It did not say when to try again." : `Try again in ${seconds} seconds.`;
    return new PostHogApiError(
      `PostHog's limit for queries is used up (it runs a few at once per project, and counts them per hour). ${when} The request did not run.`,
      status,
      code,
      seconds
    );
  }
  const said = detail ?? text.trim().slice(0, 300);
  return new PostHogApiError(`PostHog answered ${status}${said ? `: ${said}` : ""}`, status, code);
}

export type QueryValue = string | number | boolean | undefined;

/** Fill a path template from its values, each one URL-encoded. */
export function fillPath(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`no value for {${key}} in ${template}`);
    return encodeURIComponent(String(value));
  });
}

/** A count of free slots and the callers waiting for one. */
class Slots {
  private free: number;
  private readonly waiting: Array<() => void> = [];
  constructor(size: number) {
    this.free = size;
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    }
  }
}

export class PostHogClient {
  private readonly slots = new Slots(MAX_CONCURRENT);

  constructor(
    private readonly host: string,
    private readonly project: string,
    private readonly token: string
  ) {}

  /** GET a path under the project, and hand back the parsed JSON. */
  get(template: string, options: { params?: Record<string, string | number>; query?: Record<string, QueryValue> } = {}): Promise<unknown> {
    return this.send("GET", template, options);
  }

  /** Run one query through `/query/`, named for the tool that sent it, and
   * wait for it to finish. */
  query(query: Record<string, unknown>, toolName: string): Promise<unknown> {
    return this.send("POST", "/query/", { body: { query, name: `datatorag:${toolName}`, refresh: "blocking" } });
  }

  private send(
    method: "GET" | "POST",
    template: string,
    options: { params?: Record<string, string | number>; query?: Record<string, QueryValue>; body?: unknown }
  ): Promise<unknown> {
    const url = new URL(`${this.host}/api/projects/${encodeURIComponent(this.project)}${fillPath(template, options.params)}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    return this.slots.run(async () => {
      let waited = 0;
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        const text = await res.text();
        if (res.ok) return text.trim() === "" ? {} : JSON.parse(text);
        const retryAfter = res.headers.get("retry-after");
        if (res.status !== 429 || attempt >= MAX_ATTEMPTS) throw errorFor(res.status, text, retryAfter);
        const wait = retryWaitMs(attempt, retryAfter, waited);
        if (wait === null) throw errorFor(res.status, text, retryAfter);
        console.error(`rate-limit retry: ${method} ${template} answered 429, attempt ${attempt} of ${MAX_ATTEMPTS}, waiting ${wait}ms`);
        waited += wait;
        await retryClock.sleep(wait);
      }
    });
  }
}
