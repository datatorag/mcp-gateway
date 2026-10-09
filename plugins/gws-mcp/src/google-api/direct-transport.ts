import { buildRequest, requestUrl, type BuiltRequest, supportsMediaDownload } from "./request.js";
import { TransientGwsError, isTransient } from "./errors.js";
import { MAX_ATTEMPTS, isRateLimited, retryClock, retryWaitMs } from "./rate-limit-retry.js";

/** One default per call; media moves more bytes and gets longer (SCRUM-289). */
export const DEFAULT_TIMEOUT_MS = 30_000;
export const PAGE_ALL_TIMEOUT_MS = 120_000;
export const MEDIA_TIMEOUT_MS = 120_000;
/** gws_run's page_all stops here, as the CLI transport's --page-limit did. */
export const PAGE_ALL_LIMIT = 10;

/** The most one JSON or text response may hold. The CLI transport bounded
 * this with its stdout buffer; the bound is restated here because the reason
 * for it did not leave with that transport: every session shares this
 * process, and gws_run lets a caller ask for anything, so one oversized body
 * must fail that call rather than exhaust memory for everyone. Media does not
 * come through here; it streams (directDownload). */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Read a response body as text, refusing past `limit` without holding it. */
export async function readCapped(res: Response, label: string, limit = MAX_RESPONSE_BYTES): Promise<string> {
  if (!res.body) return "";
  const declared = Number(res.headers.get("content-length"));
  const tooLarge = () =>
    new Error(
      `${label}: the response is larger than ${MAX_RESPONSE_BYTES} bytes, the most one call may return. ` +
        `Ask for less (fields, a narrower range, fewer results per page).`
    );
  if (Number.isFinite(declared) && declared > limit) {
    await res.body.cancel().catch(() => {});
    throw tooLarge();
  }
  const reader = res.body.getReader();
  const held: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    held.push(value);
  }
  return Buffer.concat(held).toString("utf8");
}

export interface ApiOptions {
  params?: Record<string, unknown>;
  jsonBody?: unknown;
  pageAll?: boolean;
  dryRun?: boolean;
}

export interface ApiResult {
  success: boolean;
  data: unknown;
}

/** Google's JSON error, in the text class the CLI transport produced:
 * `API error: {"error":{"code":403,"message":"…","reason":"…"}}`.
 *
 * The shape is load-bearing beyond this repo: callers match on the message
 * text and the reason to reword a missing-scope refusal, so the three fields
 * keep their names and their order. `reason` is Google's own, from whichever
 * of its two error formats the API answered in. */
function apiErrorText(status: number, bodyText: string): string {
  let message = bodyText.trim();
  let reason: string | undefined;
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string }>;
        details?: Array<{ reason?: string }>;
      };
    };
    const e = parsed?.error;
    if (e && typeof e === "object") {
      if (typeof e.message === "string") message = e.message;
      reason = e.errors?.find((x) => x.reason)?.reason ?? e.details?.find((x) => x.reason)?.reason ?? e.status;
    }
  } catch {
    // Not JSON (an HTML error page from a proxy): the text itself is the message.
  }
  if (!message) message = `HTTP ${status} with an empty body`;
  return `API error: ${JSON.stringify({ error: { code: status, message, ...(reason ? { reason } : {}) } })}`;
}

const TRANSIENT_STATUS = new Set([502, 503, 504]);

function throwApiError(status: number, bodyText: string): never {
  if (status === 401) {
    // The CLI transport's wording for the same condition, kept because the
    // tool it names is how a self-hosted user recovers.
    throw new Error("Google Workspace authentication required. Use the gws_auth_setup tool to authenticate.");
  }
  const text = apiErrorText(status, bodyText);
  if (TRANSIENT_STATUS.has(status) || isTransient(text)) throw new TransientGwsError(text);
  throw new Error(text);
}

/** A failure of the path to Google, reworded so it cannot carry the request.
 *
 * `fetch` rejects with errors whose `cause` can echo connection detail. The
 * request holds the bearer token, so nothing from the request object is ever
 * interpolated here: only the error's own name/code and the method name. */
function throwNetworkError(err: unknown, label: string): never {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    throw new TransientGwsError(`${label} timed out (ETIMEDOUT)`);
  }
  // Only a value that looks like an error code is echoed. The guarantee is
  // that nothing from the request can ride out in an error, and that should
  // not rest on what a given fetch implementation chooses to put in `code`.
  const raw = e?.cause?.code ?? e?.code ?? e?.name;
  const code = typeof raw === "string" && /^[A-Z][A-Za-z0-9_]{0,40}$/.test(raw) ? raw : "network error";
  const text = `${label} could not reach Google: ${code}`;
  throw isTransient(text) ? new TransientGwsError(text) : new Error(text);
}

/** Where the bearer token may travel. Every table entry is rooted at one of
 * these, and a resumable upload's session URL, which Google hands back in a
 * response header, is checked against the same rule before anything is sent
 * to it: a header is input, and the token must not follow it off Google. */
export function assertGoogleApiUrl(url: string): URL {
  const parsed = new URL(url);
  const googleHost = parsed.hostname === "googleapis.com" || parsed.hostname.endsWith(".googleapis.com");
  if (parsed.protocol !== "https:" || !googleHost || parsed.port !== "" || parsed.username !== "" || parsed.password !== "") {
    throw new Error("Refusing to send credentials to a non-Google URL.");
  }
  return parsed;
}

/** The one surface outside the API hosts that takes the token: the
 * Visualization query endpoint behind sheets_query, which is not a
 * Discovery-based API and lives on docs.google.com. Exact hosts, no suffix
 * match: docs.google.com has no subdomains this client should ever reach. */
const VISUALIZATION_HOSTS: ReadonlySet<string> = new Set(["docs.google.com", "www.googleapis.com"]);
export function assertVisualizationUrl(url: string): URL {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !VISUALIZATION_HOSTS.has(parsed.hostname) ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("fetchText only reaches Google origins.");
  }
  return parsed;
}

/** Where a request may carry the token, by name. A caller picks a
 * destination; it cannot supply its own rule. None of them follows a
 * redirect: `error` refuses one, and `manual` hands the 3xx back unfollowed.
 *
 * - `api`: every ordinary API call. A redirect is a network error.
 * - `visualization`: the query endpoint, whose caller reads the 3xx status.
 * - `uploadSession`: a resumable upload's chunks. Google answers each
 *   intermediate chunk with 308 Resume Incomplete, which fetch treats as a
 *   redirect, so under `error` every resumable upload died on its first chunk
 *   with a bare TypeError. Here the 308 comes back unfollowed, and
 *   sendAuthorized itself refuses any 3xx that is not a Location-free 308
 *   (`resumeOnly`), so no caller can select this destination without the
 *   check. */
const DESTINATIONS = {
  api: { assert: assertGoogleApiUrl, redirect: "error", resumeOnly: false },
  visualization: { assert: assertVisualizationUrl, redirect: "manual", resumeOnly: false },
  uploadSession: { assert: assertGoogleApiUrl, redirect: "manual", resumeOnly: true },
} as const;
export type Destination = keyof typeof DESTINATIONS;

/** THE ONE PLACE THE TOKEN IS USED. It goes into the Authorization header and
 * nowhere else: not a URL, not a log line, not an error. The URL is checked
 * against the destination's rule before anything is sent, and a redirect is
 * never followed, so the header cannot be replayed elsewhere. A test reads
 * the source tree to hold this comment to its word. */
export async function sendAuthorized(
  token: string,
  target: { method: string; url: string },
  label: string,
  init: {
    body?: string | Uint8Array;
    headers?: Record<string, string>;
    timeout: number;
    destination?: Destination;
  }
): Promise<Response> {
  const { assert, redirect, resumeOnly } = DESTINATIONS[init.destination ?? "api"];
  assert(target.url);
  // Caller headers go in first and lose: no spelling of Authorization from a
  // caller survives, because fetch would join two spellings into one value.
  const headers = Object.fromEntries(
    Object.entries(init.headers ?? {}).filter(([name]) => name.toLowerCase() !== "authorization")
  );
  let res: Response;
  try {
    res = await fetch(target.url, {
      method: target.method,
      headers: { ...headers, Authorization: `Bearer ${token}` },
      body: init.body as BodyInit | undefined,
      signal: AbortSignal.timeout(init.timeout),
      redirect,
    });
  } catch (err) {
    throwNetworkError(err, label);
  }
  // A 308 is Resume Incomplete only when it names no Location. Anything that
  // names one, and any other 3xx, is a real redirect: refused here, never
  // followed, since following it would carry the token somewhere else.
  if (resumeOnly && res.status >= 300 && res.status < 400 && (res.status !== 308 || res.headers.get("location"))) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`${label}: the upload session answered with a redirect (${res.status}), which is refused.`);
  }
  return res;
}

function send(
  token: string,
  request: BuiltRequest,
  label: string,
  init: { body?: string; headers?: Record<string, string>; timeout: number; extraQuery?: Array<[string, string]> }
): Promise<Response> {
  return sendAuthorized(token, { method: request.method, url: requestUrl(request, init.extraQuery) }, label, init);
}

/** Send, and hand back only an answer that succeeded.
 *
 * A read refused for rate is sent again, up to MAX_ATTEMPTS requests in all
 * (see rate-limit-retry.ts for what counts and why writes are left alone).
 * Anything else, and a refusal that outlasts the attempts, is thrown as the
 * same error the single request always produced. The log line names the
 * method and the numbers and nothing from the request. */
async function sendOk(
  token: string,
  request: BuiltRequest,
  label: string,
  init: { body?: string; headers?: Record<string, string>; timeout: number; extraQuery?: Array<[string, string]> }
): Promise<Response> {
  const isRead = request.method === "GET";
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    const res = await send(token, request, label, init);
    if (res.ok) return res;
    const text = await readCapped(res, label);
    if (isRead && attempt < MAX_ATTEMPTS && isRateLimited(res.status, text)) {
      const wait = retryWaitMs(attempt, res.headers.get("retry-after"), waited);
      if (wait !== null) {
        console.error(`rate-limit retry: ${label} answered ${res.status}, attempt ${attempt} of ${MAX_ATTEMPTS}, waiting ${wait}ms`);
        waited += wait;
        await retryClock.sleep(wait);
        continue;
      }
    }
    throwApiError(res.status, text);
  }
}

/** The CLI transport parsed stdout as JSON and fell back to the trimmed text;
 * an empty body therefore read as "". Callers were written against that. */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

export async function directApi(
  token: string,
  service: string,
  resource: string,
  method: string,
  options?: ApiOptions
): Promise<ApiResult> {
  const request = buildRequest(service, resource, method, options);
  const label = `${service} ${resource} ${method}`;

  if (options?.dryRun) {
    return {
      success: true,
      data: {
        body: request.body,
        dry_run: true,
        is_multipart_upload: false,
        method: request.method,
        query_params: request.queryParams,
        url: request.url,
      },
    };
  }

  const hasBody = options?.jsonBody !== undefined && options?.jsonBody !== null;
  const once = async (limit: number, extraQuery?: Array<[string, string]>) => {
    const res = await sendOk(token, request, label, {
      body: hasBody ? JSON.stringify(options?.jsonBody) : undefined,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      timeout: options?.pageAll ? PAGE_ALL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
      extraQuery,
    });
    return readCapped(res, label, limit);
  };

  if (!options?.pageAll) return { success: true, data: parseBody(await once(MAX_RESPONSE_BYTES)) };

  // One JSON document per page, newline separated, which is what --page-all
  // printed; a single page parses as plain JSON, as it did then.
  //
  // THE BUDGET IS FOR THE CALL, NOT THE PAGE. The old transport held every
  // page under one buffer; a per-page cap here would quietly be ten times
  // that. Each page is read against what is left, so the call fails with the
  // same error the moment the pages together pass the bound. Each page is
  // parsed once and re-serialised once, onto one line: Google pretty-prints,
  // and a line-per-document format cannot carry a document with newlines.
  const pages: string[] = [];
  let remaining = MAX_RESPONSE_BYTES;
  let pageToken: string | undefined;
  for (let i = 0; i < PAGE_ALL_LIMIT; i++) {
    const text = (await once(remaining, pageToken ? [["pageToken", pageToken]] : undefined)).trim();
    remaining -= Buffer.byteLength(text, "utf8");
    const parsed = parseBody(text);
    pages.push(JSON.stringify(parsed));
    const next = (parsed as { nextPageToken?: unknown } | undefined)?.nextPageToken;
    if (typeof next !== "string" || next === "") {
      if (pages.length === 1) return { success: true, data: parsed };
      break;
    }
    pageToken = next;
  }
  return { success: true, data: pages.join("\n") };
}

export interface DownloadResult {
  stream: ReadableStream<Uint8Array>;
  contentType?: string;
  size?: number;
}

/** Open a response as a byte stream instead of reading it into memory. A
 * method Discovery marks as a media download is asked for `alt=media`; any
 * other method (a Gmail attachment, whose bytes arrive inside JSON) streams
 * the body it has. The caller owns the stream and its size. */
export async function directDownload(
  token: string,
  service: string,
  resource: string,
  method: string,
  params: Record<string, unknown>
): Promise<DownloadResult> {
  const media = supportsMediaDownload(service, resource, method);
  const request = buildRequest(service, resource, method, { params: media ? { ...params, alt: "media" } : params });
  const label = `${service} ${resource} ${method}`;
  const res = await sendOk(token, request, label, { timeout: MEDIA_TIMEOUT_MS });
  if (!res.body) throw new Error(`${label} returned no content`);
  const length = Number(res.headers.get("content-length"));
  return {
    stream: res.body,
    contentType: res.headers.get("content-type") ?? undefined,
    size: Number.isFinite(length) && length > 0 ? length : undefined,
  };
}

export { throwApiError, parseBody };
