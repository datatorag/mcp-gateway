/**
 * Brevo REST client (SCRUM-468).
 *
 * The gateway sends one user's OAuth access token per session in
 * `X-User-Token`; every request carries it as a Bearer token. Nothing here
 * holds an app credential, and a call with no token is refused before any
 * request is made.
 *
 * Paths are given as TEMPLATES with their values beside them
 * (`/contacts/{identifier}` and `{ identifier: "a@example.com" }`). The
 * template is what a log line prints: Brevo addresses a contact by its email
 * in the path, so a filled-in path would put a person's address in our logs.
 *
 * Errors: Brevo answers `{code, message}`. Every refusal is thrown as a
 * `BrevoApiError` carrying the status and code. Three are put in words
 * because the raw text sends a reader the wrong way: 401 (the connection
 * needs reconnecting), 402 (no credits, or today's send limit is used up) and
 * 429 (the hourly limit for this kind of call is used up, with when it
 * resets).
 */

import { MAX_ATTEMPTS, isRateLimited, resetMs, retryClock, retryWaitMs } from "./rate-limit-retry.js";

export const BREVO_API = "https://api.brevo.com/v3";
/** One request's limit. A call that takes longer than this is abandoned. */
const REQUEST_TIMEOUT_MS = 60_000;

export const RECONNECT_MESSAGE =
  "Brevo refused the connection's access token, so the Brevo connection needs reconnecting. The gateway's " +
  "connect tool gives a link to reconnect it.";

export const NO_TOKEN_MESSAGE =
  "No Brevo access token reached this call. The gateway sends the connected account's token with each " +
  "session; the gateway's connect tool shows whether Brevo is connected.";

export const CREDITS_MESSAGE =
  "Brevo refused for lack of credits or because today's send limit is used up.";

/** A write sent to Brevo that got no answer: it may or may not have been
 * applied, and the failure was on the path, not in the request. */
export class BrevoUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrevoUnreachableError";
  }
}

/** A Brevo call that was answered, and answered no. */
export class BrevoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    /** Seconds until Brevo's window resets, on a refusal for rate. */
    readonly resetSeconds?: number
  ) {
    super(message);
    this.name = "BrevoApiError";
  }
}

function parseErrorBody(text: string): { code?: string; message?: string } {
  try {
    const body = JSON.parse(text) as { code?: unknown; message?: unknown };
    if (body && typeof body === "object") {
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

/** "in 42 minutes", "in 30 seconds": how far off Brevo's reset is. */
function inWords(seconds: number): string {
  if (seconds >= 120) return `in ${Math.ceil(seconds / 60)} minutes`;
  return `in ${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** The words for a refusal for rate, naming when Brevo's window resets. */
function rateLimitWords(seconds: number | undefined, reason: "write" | "attempts" | "long-wait"): string {
  const head =
    "Brevo's limit for this kind of call is used up (Brevo counts calls per account per hour, and some kinds allow only 100)";
  const wait = seconds === undefined ? ", and it did not say when it resets." : `; it resets ${inWords(seconds)}.`;
  const tail = {
    write: " The request did not run, and was not sent again because this tool changes something in Brevo.",
    attempts: ` The request did not run. It was sent ${MAX_ATTEMPTS} times and refused each time.`,
    "long-wait": " The request did not run. That is longer than one call waits on its own.",
  }[reason];
  return head + wait + tail;
}

/** The error for a refused answer. Exported for test. */
export function errorFor(
  status: number,
  text: string,
  reset: string | null,
  reason: "write" | "attempts" | "long-wait" = "attempts"
): BrevoApiError {
  const { code, message } = parseErrorBody(text);
  if (status === 401) {
    return new BrevoApiError(`${RECONNECT_MESSAGE} (Brevo: 401${code ? ` ${code}` : ""})`, status, code);
  }
  if (status === 402) {
    return new BrevoApiError(`${CREDITS_MESSAGE}${message ? ` Brevo said: ${message.slice(0, 300)}` : ""}`, status, code);
  }
  if (isRateLimited(status)) {
    const ms = resetMs(reset);
    const seconds = ms === undefined ? undefined : Math.ceil(ms / 1000);
    return new BrevoApiError(rateLimitWords(seconds, reason), status, code, seconds);
  }
  const detail = message ?? text.trim().slice(0, 300);
  return new BrevoApiError(`Brevo answered ${status}${code ? ` ${code}` : ""}${detail ? `: ${detail}` : ""}`, status, code);
}

export type QueryValue = string | number | boolean | undefined;

/** Fill a path template from its values, each one URL-encoded. A value the
 * template names but the call does not give is a bug, not a request. */
export function fillPath(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`no value for {${key}} in ${template}`);
    return encodeURIComponent(String(value));
  });
}

export interface BrevoClientOptions {
  accessToken?: string;
  /** Whether the tool making the calls is read-only. Decides retry; a
   * client that was never told is treated as a write and never retries. */
  readOnlyTool?: boolean;
}

export class BrevoClient {
  private readonly accessToken?: string;
  private readonly readOnlyTool: boolean;

  constructor(options?: BrevoClientOptions) {
    this.accessToken = options?.accessToken;
    this.readOnlyTool = options?.readOnlyTool ?? false;
  }

  withToken(accessToken: string): BrevoClient {
    return new BrevoClient({ accessToken, readOnlyTool: this.readOnlyTool });
  }

  /** The same token, with retry decided by the calling tool's annotation. */
  forTool(readOnly: boolean): BrevoClient {
    return new BrevoClient({ accessToken: this.accessToken, readOnlyTool: readOnly });
  }

  /** Send, and hand back the parsed JSON of an answer that succeeded.
   *
   * A refusal for rate from a read-only tool is sent again, up to
   * MAX_ATTEMPTS requests in all, only while Brevo's reset fits the budget
   * in rate-limit-retry.ts. Anything else is thrown as a BrevoApiError. A
   * request that never got an answer is never retried: a read's error is
   * thrown as it is, a write's in words saying the change may have been
   * applied. A log line names the method, the path TEMPLATE and the numbers,
   * and nothing from the request. */
  async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    template: string,
    options: { params?: Record<string, string | number>; query?: Record<string, QueryValue>; body?: unknown } = {}
  ): Promise<unknown> {
    if (!this.accessToken) throw new Error(NO_TOKEN_MESSAGE);

    const url = new URL(`${BREVO_API}${fillPath(template, options.params)}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
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
        res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (err) {
        if (this.readOnlyTool) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        throw new BrevoUnreachableError(
          `No answer came back from Brevo for ${method} ${template} (${reason}). The change may or may not have been applied; it was not sent again.`
        );
      }
      const text = await res.text();
      if (res.ok) return text.trim() === "" ? {} : JSON.parse(text);

      const reset = res.headers.get("x-sib-ratelimit-reset") ?? res.headers.get("retry-after");
      if (!isRateLimited(res.status)) throw errorFor(res.status, text, reset);
      if (!this.readOnlyTool) throw errorFor(res.status, text, reset, "write");
      if (attempt >= MAX_ATTEMPTS) throw errorFor(res.status, text, reset, "attempts");
      const wait = retryWaitMs(attempt, reset, waited);
      if (wait === null) throw errorFor(res.status, text, reset, "long-wait");
      console.error(`rate-limit retry: ${method} ${template} answered ${res.status}, attempt ${attempt} of ${MAX_ATTEMPTS}, waiting ${wait}ms`);
      waited += wait;
      await retryClock.sleep(wait);
    }
  }
}
