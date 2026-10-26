/**
 * Notion REST client.
 *
 * The gateway sends one user's access token per session in `X-User-Token`;
 * every request carries it as a Bearer token and the API version pinned
 * below. Nothing here holds an app credential, and a call with no token is
 * refused before any request is made.
 *
 * The version is pinned so a new Notion version changes nothing until this
 * file moves. `2026-03-11` is the version the markdown endpoints require; in
 * it a database is a container of data sources and queries live on the data
 * source.
 *
 * Errors: Notion answers `{object: "error", status, code, message}`. Every
 * refusal is thrown as a `NotionApiError` carrying the status and code. Two
 * are rewritten into words because the raw text sends a reader the wrong way:
 * `object_not_found`, which Notion also answers for a page that exists but is
 * not shared with the connection (observed), and `unauthorized`, which means
 * the connection itself needs reconnecting.
 */

import { MAX_ATTEMPTS, isRateLimited, retryAfterMs, retryClock, retryWaitMs } from "./rate-limit-retry.js";

export const NOTION_API = "https://api.notion.com";
export const NOTION_VERSION = "2026-03-11";
/** One request's limit. A call that takes longer than this is abandoned. */
const REQUEST_TIMEOUT_MS = 60_000;

export const NOT_SHARED_MESSAGE =
  "Notion did not find this page or database. Notion gives the same answer for a page that does not exist " +
  "and for one that is not shared with the DataToRAG connection, so either is possible. To share a page: " +
  "open it in Notion, open the ••• menu at the top right, choose Connections, and add the DataToRAG " +
  "connection. Sharing a parent page also shares every page under it.";

export const RECONNECT_MESSAGE =
  "Notion refused the connection's access token, so the Notion connection needs reconnecting. The gateway's " +
  "list_connected_accounts tool shows the connected Notion accounts, and Notion can be reconnected from the " +
  "DataToRAG dashboard's connections page.";

export const NO_TOKEN_MESSAGE =
  "No Notion access token reached this call. The gateway sends the connected account's token with each " +
  "session; the gateway's list_connected_accounts tool shows whether Notion is connected.";

/** A Notion call that was answered, and answered no. */
/** A write sent to Notion that got no answer: it may or may not have been
 * applied, and the failure was on the path, not in the request. */
export class NotionUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionUnreachableError";
  }
}

export class NotionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    /** Notion's requested wait, in whole seconds, on a refusal for rate. */
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

interface NotionErrorBody {
  object?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
}

function parseErrorBody(text: string): { code?: string; message?: string } {
  try {
    const body = JSON.parse(text) as NotionErrorBody;
    if (body && typeof body === "object" && body.object === "error") {
      return {
        code: typeof body.code === "string" ? body.code : undefined,
        message: typeof body.message === "string" ? body.message : undefined,
      };
    }
  } catch {
    // Not JSON: a proxy's page, an empty body. Reported as text below.
  }
  return {};
}

/** The words for a refusal for rate, naming the wait Notion asked for. */
function rateLimitWords(
  status: number,
  code: string | undefined,
  seconds: number | undefined,
  reason: "write" | "attempts" | "long-wait"
): string {
  const head = `Notion's rate limit refused this request (${status}${code ? ` ${code}` : ""})`;
  const wait =
    seconds === undefined
      ? " and did not say how long to wait."
      : ` and asked for a wait of ${seconds} second${seconds === 1 ? "" : "s"} before the next request.`;
  const tail = {
    write: " The request did not run. It was not sent again, because this tool changes content.",
    attempts: ` The request did not run. It was sent ${MAX_ATTEMPTS} times and refused each time.`,
    "long-wait": " The request did not run. That wait is longer than one call waits on its own, so it was not sent again.",
  }[reason];
  return head + wait + tail;
}

/** The error for a refused answer. Exported for test. */
export function errorFor(
  status: number,
  text: string,
  retryAfter: string | null,
  reason: "write" | "attempts" | "long-wait" = "attempts"
): NotionApiError {
  const { code, message } = parseErrorBody(text);
  if (status === 404 && code === "object_not_found") {
    return new NotionApiError(`${NOT_SHARED_MESSAGE} (Notion: 404 object_not_found)`, status, code);
  }
  if (status === 401) {
    return new NotionApiError(`${RECONNECT_MESSAGE} (Notion: 401${code ? ` ${code}` : ""})`, status, code);
  }
  if (isRateLimited(status)) {
    const ms = retryAfterMs(retryAfter);
    const seconds = ms === undefined ? undefined : Math.ceil(ms / 1000);
    return new NotionApiError(rateLimitWords(status, code, seconds, reason), status, code, seconds);
  }
  const detail = message ?? text.trim().slice(0, 300);
  return new NotionApiError(
    `Notion answered ${status}${code ? ` ${code}` : ""}${detail ? `: ${detail}` : ""}`,
    status,
    code
  );
}

export type QueryValue = string | number | undefined;

export interface NotionClientOptions {
  accessToken?: string;
  /** Whether the tool making the calls is read-only. Decides retry; a
   * client that was never told is treated as a write and never retries. */
  readOnlyTool?: boolean;
}

export class NotionClient {
  private readonly accessToken?: string;
  private readonly readOnlyTool: boolean;

  constructor(options?: NotionClientOptions) {
    this.accessToken = options?.accessToken;
    this.readOnlyTool = options?.readOnlyTool ?? false;
  }

  withToken(accessToken: string): NotionClient {
    return new NotionClient({ accessToken, readOnlyTool: this.readOnlyTool });
  }

  /** The same token, with retry decided by the calling tool's annotation. */
  forTool(readOnly: boolean): NotionClient {
    return new NotionClient({ accessToken: this.accessToken, readOnlyTool: readOnly });
  }

  get(path: string, query?: Record<string, QueryValue>): Promise<unknown> {
    return this.request("GET", path, { query });
  }

  post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, { body });
  }

  patch(path: string, body: unknown): Promise<unknown> {
    return this.request("PATCH", path, { body });
  }

  delete(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  /** Send, and hand back the parsed JSON of an answer that succeeded.
   *
   * A refusal for rate from a read-only tool is sent again, up to
   * MAX_ATTEMPTS requests in all, waiting what rate-limit-retry.ts allows.
   * Anything else is thrown as a NotionApiError. A request that never got an
   * answer (a dropped connection, the timeout) is never retried: a read's
   * error is thrown as it is, a write's in words saying the change may have
   * been applied. The log line names the method, the path's shape and the numbers
   * and nothing else from the request. */
  async request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { query?: Record<string, QueryValue>; body?: unknown } = {}
  ): Promise<unknown> {
    if (!this.accessToken) throw new Error(NO_TOKEN_MESSAGE);

    const url = new URL(path, NOTION_API);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Notion-Version": NOTION_VERSION,
      Accept: "application/json",
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let waited = 0;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        // A write with no answer may have been applied before the connection
        // dropped; it is not sent again, and the words say so.
        if (this.readOnlyTool) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        throw new NotionUnreachableError(
          `No answer came back from Notion for ${method} ${url.pathname} (${reason}). The change may or may not have been applied; it was not sent again.`
        );
      }
      const text = await res.text();
      if (res.ok) return text.trim() === "" ? {} : JSON.parse(text);

      const retryAfter = res.headers.get("retry-after");
      if (!isRateLimited(res.status)) throw errorFor(res.status, text, retryAfter);
      if (!this.readOnlyTool) throw errorFor(res.status, text, retryAfter, "write");
      if (attempt >= MAX_ATTEMPTS) throw errorFor(res.status, text, retryAfter, "attempts");
      const wait = retryWaitMs(attempt, retryAfter, waited);
      if (wait === null) throw errorFor(res.status, text, retryAfter, "long-wait");
      console.error(
        `rate-limit retry: ${method} ${url.pathname.replace(/[0-9a-f-]{32,36}/gi, "{id}")} answered ${res.status}, attempt ${attempt} of ${MAX_ATTEMPTS}, waiting ${wait}ms`
      );
      waited += wait;
      await retryClock.sleep(wait);
    }
  }
}
