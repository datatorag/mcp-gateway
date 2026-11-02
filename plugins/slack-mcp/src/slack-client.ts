/**
 * Slack Web API client.
 *
 * The gateway sends one user's Slack user token per session in
 * `X-User-Token`; every request carries it as a Bearer header. Nothing here
 * holds an app credential, and a call with no token is refused before any
 * request is made. The token is never put in a URL, a log line or an error.
 *
 * Reads are GETs with query params. The four write methods are POSTs with a
 * JSON body. A request is abandoned after 60 seconds.
 *
 * Errors: Slack answers most refusals with HTTP 200 and `{ok: false, error}`.
 * Every refusal is thrown as a `SlackApiError` carrying Slack's code and the
 * method. Two families are rewritten into words because the code alone sends
 * a reader the wrong way: `missing_scope`, which can only mean the app's
 * scopes changed after the grant, and the refused-token codes, both of which
 * need Slack reconnecting. A request that got no answer is a
 * `SlackUnreachableError`, never retried.
 */

import { MAX_ATTEMPTS, isRateLimited, retryAfterMs, retryClock, retryWaitMs } from "./rate-limit-retry.js";

export const SLACK_API = "https://slack.com/api/";
/** One request's limit. A call that takes longer than this is abandoned. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The Slack methods that change something. Sent as POST JSON; everything
 * else is a GET. */
const WRITE_METHODS = new Set(["chat.postMessage", "chat.update", "reactions.add", "conversations.open"]);

export const NO_TOKEN_MESSAGE =
  "No Slack access token reached this call. The gateway sends the connected account's token with each " +
  "session; the gateway's list_connected_accounts tool shows whether Slack is connected.";

export const RECONNECT_MESSAGE =
  "Slack refused the connection's access token, so the Slack connection needs reconnecting. The gateway's " +
  "list_connected_accounts tool shows the connected Slack accounts, and Slack can be reconnected from the " +
  "DataToRAG dashboard's connections page.";

export const MISSING_SCOPE_MESSAGE =
  "Slack refused this call for a permission the connection was not granted. The connector asks for every " +
  "permission its tools use when Slack is connected, so the grant is older than the connector's permissions: " +
  "reconnect Slack from the DataToRAG dashboard's connections page to grant them.";

const RECONNECT_CODES = new Set(["invalid_auth", "not_authed", "token_expired", "token_revoked", "account_inactive"]);

/** Slack answered, and answered no. */
export class SlackApiError extends Error {
  constructor(
    message: string,
    /** Slack's error code, for example `channel_not_found`. */
    readonly error: string,
    /** The Web API method, for example `conversations.history`. */
    readonly method: string,
    /** The HTTP status; 200 for Slack's usual `ok: false`. */
    readonly status: number = 200,
    /** Slack's requested wait, in whole seconds, on a refusal for rate. */
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

/** A request that got no answer (a dropped connection, the timeout). A write
 * in this state may or may not have landed. */
export class SlackUnreachableError extends Error {
  constructor(
    message: string,
    readonly method: string
  ) {
    super(message);
    this.name = "SlackUnreachableError";
  }
}

type RateReason = "write" | "attempts" | "long-wait";

function rateLimitWords(method: string, seconds: number | undefined, reason: RateReason): string {
  const head = `Slack's rate limit refused ${method} (ratelimited)`;
  const wait =
    seconds === undefined
      ? " and did not say how long to wait."
      : ` and asked for a wait of ${seconds} second${seconds === 1 ? "" : "s"} before the next request.`;
  const tail = {
    write: " The request did not run. It was not sent again, because this tool changes something in Slack.",
    attempts: ` The request did not run. It was sent ${MAX_ATTEMPTS} times and refused each time.`,
    "long-wait": " The request did not run. That wait is longer than one call waits on its own, so it was not sent again.",
  }[reason];
  return head + wait + tail;
}

/** The error for a refused answer. Exported for test. */
export function errorFor(
  method: string,
  status: number,
  text: string,
  retryAfter: string | null,
  reason: RateReason = "attempts"
): SlackApiError {
  let code: string | undefined;
  try {
    const body = JSON.parse(text) as { ok?: unknown; error?: unknown };
    if (body && typeof body === "object" && typeof body.error === "string") code = body.error;
  } catch {
    // Not JSON: a proxy's page, an empty body. Named by the status below.
  }
  if (isRateLimited(status, code)) {
    const ms = retryAfterMs(retryAfter);
    const seconds = ms === undefined ? undefined : Math.ceil(ms / 1000);
    return new SlackApiError(rateLimitWords(method, seconds, reason), "ratelimited", method, status, seconds);
  }
  if (code === "missing_scope") {
    return new SlackApiError(`${MISSING_SCOPE_MESSAGE} (Slack: ${method} missing_scope)`, code, method, status);
  }
  if (code && RECONNECT_CODES.has(code)) {
    return new SlackApiError(`${RECONNECT_MESSAGE} (Slack: ${method} ${code})`, code, method, status);
  }
  if (code) return new SlackApiError(`Slack answered ${method} with ${code}.`, code, method, status);
  return new SlackApiError(`Slack answered ${method} with HTTP ${status}.`, `http_${status}`, method, status);
}

export type ParamValue = string | number | boolean | undefined;
export type Params = Record<string, ParamValue>;

/** Call one Web API method and hand back its body when `ok` is true.
 *
 * A refusal for rate is sent again only when `readOnly` (the calling tool's
 * hint) is true, up to MAX_ATTEMPTS requests in all, waiting what
 * rate-limit-retry.ts allows. Anything else is thrown. The log line names the
 * method and the numbers and nothing else from the request. */
export async function slackCall<T = Record<string, unknown>>(
  token: string | undefined,
  method: string,
  params: Params,
  opts: { readOnly: boolean }
): Promise<T> {
  if (!token) throw new Error(NO_TOKEN_MESSAGE);

  const isWrite = WRITE_METHODS.has(method);
  const url = new URL(method, SLACK_API);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  let body: string | undefined;
  if (isWrite) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    body = JSON.stringify(params);
  } else {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: isWrite ? "POST" : "GET",
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new SlackUnreachableError(
        isWrite
          ? `No answer came back from Slack for ${method} (${reason}). The request may have landed, so a message may have posted or a change may have been applied; it was not sent again.`
          : `No answer came back from Slack for ${method} (${reason}). It was not sent again.`,
        method
      );
    }
    const text = await res.text();
    if (res.ok) {
      let parsed: { ok?: unknown; error?: unknown } | undefined;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      if (parsed && parsed.ok === true) return parsed as T;
      if (!parsed || parsed.error !== "ratelimited") throw errorFor(method, res.status, text, null);
    }

    const retryAfter = res.headers.get("retry-after");
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { error?: string }).error;
    } catch {
      code = undefined;
    }
    if (!isRateLimited(res.status, code)) throw errorFor(method, res.status, text, retryAfter);
    if (!opts.readOnly) throw errorFor(method, res.status, text, retryAfter, "write");
    if (attempt >= MAX_ATTEMPTS) throw errorFor(method, res.status, text, retryAfter, "attempts");
    const wait = retryWaitMs(attempt, retryAfter, waited);
    if (wait === null) throw errorFor(method, res.status, text, retryAfter, "long-wait");
    console.error(
      `rate-limit retry: ${method} answered ${res.status}, attempt ${attempt} of ${MAX_ATTEMPTS}, waiting ${wait}ms`
    );
    waited += wait;
    await retryClock.sleep(wait);
  }
}

export interface SlackClientOptions {
  accessToken?: string;
  /** Whether the tool making the calls is read-only. Decides retry; a
   * client that was never told is treated as a write and never retries. */
  readOnlyTool?: boolean;
}

/** A token and the calling tool's retry rule, carried together so a tool
 * handler cannot call Slack with the wrong one. */
export class SlackClient {
  private readonly accessToken?: string;
  readonly readOnlyTool: boolean;

  constructor(options?: SlackClientOptions) {
    this.accessToken = options?.accessToken;
    this.readOnlyTool = options?.readOnlyTool ?? false;
  }

  withToken(accessToken: string): SlackClient {
    return new SlackClient({ accessToken, readOnlyTool: this.readOnlyTool });
  }

  /** The same token, with retry decided by the calling tool's annotation. */
  forTool(readOnly: boolean): SlackClient {
    return new SlackClient({ accessToken: this.accessToken, readOnlyTool: readOnly });
  }

  call<T = Record<string, unknown>>(method: string, params: Params = {}): Promise<T> {
    return slackCall<T>(this.accessToken, method, params, { readOnly: this.readOnlyTool });
  }
}

/* ---- cursors ---- */

/** The cursor param for a list call: present only when there is one. */
export function paginate(cursor?: string): { cursor?: string } {
  return cursor ? { cursor } : {};
}

/** Slack's cursor for the next page, or null at the end of the list. */
export function nextCursor(body: unknown): string | null {
  const meta = (body as { response_metadata?: { next_cursor?: unknown } } | null)?.response_metadata;
  return typeof meta?.next_cursor === "string" && meta.next_cursor !== "" ? meta.next_cursor : null;
}

/* ---- channels ---- */

/** A Slack conversation id: C (channel), G (older private channel) or D (DM),
 * then upper-case letters and digits. A channel name is lower case, so the
 * two never collide. */
const CHANNEL_ID = /^[CGD][A-Z0-9]{6,}$/;
/** Pages of 200 read while resolving a name, at most. */
const RESOLVE_PAGE_LIMIT = 200;
const RESOLVE_MAX_PAGES = 50;

interface SlackChannel {
  id: string;
  name?: string;
  user?: string;
  is_private?: boolean;
  is_archived?: boolean;
}

export function isChannelId(ref: string): boolean {
  return CHANNEL_ID.test(ref);
}

/** The name a channel reference means, without a leading `#`, lower case. */
export function channelNameKey(ref: string): string {
  return ref.trim().replace(/^#/, "").toLowerCase();
}

/** An id or `#name` to `{id, name}`.
 *
 * An id is looked up with `conversations.info` for its name. A name is
 * matched against every public and private channel the user can see
 * (archived included), and refused unless exactly one matches: a name shared
 * by two channels is never guessed. */
export async function resolveChannel(client: SlackClient, ref: string): Promise<{ id: string; name: string }> {
  const trimmed = ref.trim();
  if (isChannelId(trimmed)) {
    const body = await client.call<{ channel: SlackChannel }>("conversations.info", { channel: trimmed });
    return { id: body.channel.id, name: body.channel.name ?? body.channel.user ?? body.channel.id };
  }
  const wanted = channelNameKey(trimmed);
  if (wanted === "") throw new Error("The channel argument is empty. It takes a channel id or a #name.");

  const matches: SlackChannel[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < RESOLVE_MAX_PAGES; page++) {
    const body = await client.call<{ channels: SlackChannel[] }>("conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: false,
      limit: RESOLVE_PAGE_LIMIT,
      ...paginate(cursor),
    });
    for (const c of body.channels ?? []) {
      if ((c.name ?? "").toLowerCase() === wanted) matches.push(c);
    }
    const next = nextCursor(body);
    if (!next) {
      cursor = undefined;
      break;
    }
    cursor = next;
  }
  if (cursor) {
    throw new Error(
      `#${wanted} could not be resolved: the channel list is longer than ${RESOLVE_MAX_PAGES * RESOLVE_PAGE_LIMIT} channels. The channel's id names it directly.`
    );
  }
  if (matches.length === 0) {
    throw new Error(`No channel named #${wanted} is visible to this Slack account. slack_channels_list lists the ones that are.`);
  }
  if (matches.length > 1) {
    const each = matches
      .map((c) => {
        const notes = [c.is_private ? "private" : "public", ...(c.is_archived ? ["archived"] : [])];
        return `${c.id} (${notes.join(", ")})`;
      })
      .join(", ");
    throw new Error(`#${wanted} matches ${matches.length} channels: ${each}. Nothing was guessed; the channel's id names one of them.`);
  }
  return { id: matches[0].id, name: matches[0].name ?? wanted };
}

/* ---- people and mentions ---- */

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string; email?: string };
}

/** The name a person goes by: display name, else real name, else handle. */
export function displayName(u: SlackUser): string {
  return u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id;
}

/** A user id to a name, looked up once per cache. A user Slack will not
 * describe stays as its id rather than failing the read. */
export async function userName(client: SlackClient, id: string, cache: Map<string, string>): Promise<string> {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  let name = id;
  try {
    const body = await client.call<{ user: SlackUser }>("users.info", { user: id });
    name = displayName(body.user);
  } catch (err) {
    if (!(err instanceof SlackApiError)) throw err;
  }
  cache.set(id, name);
  return name;
}

async function channelLabel(client: SlackClient, id: string, cache: Map<string, string>): Promise<string> {
  const key = `#${id}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let name = id;
  try {
    const body = await client.call<{ channel: SlackChannel }>("conversations.info", { channel: id });
    name = body.channel.name ?? id;
  } catch (err) {
    if (!(err instanceof SlackApiError)) throw err;
  }
  cache.set(key, name);
  return name;
}

const MENTION = /<([@#!])([^>|]+)(?:\|([^>]*))?>/g;
const BROADCASTS = new Set(["here", "channel", "everyone"]);

/** Slack's mention markup to words: `<@U…>` to `@Display Name`, `<#C…|name>`
 * to `#name`, `<!here>` to `@here`. Lookups go through `cache`, which the
 * caller holds for one tool call, so each person is looked up once. */
export async function resolveMentions(client: SlackClient, text: string, cache: Map<string, string>): Promise<string> {
  const found = [...text.matchAll(MENTION)];
  if (found.length === 0) return text;
  const replacements: string[] = [];
  for (const [whole, sigil, id, label] of found) {
    if (sigil === "@") {
      replacements.push(label ? `@${label}` : `@${await userName(client, id, cache)}`);
    } else if (sigil === "#") {
      replacements.push(label ? `#${label}` : `#${await channelLabel(client, id, cache)}`);
    } else if (BROADCASTS.has(id)) {
      replacements.push(`@${id}`);
    } else {
      replacements.push(label ?? whole);
    }
  }
  let i = 0;
  return text.replace(MENTION, () => replacements[i++]);
}

/* ---- text ---- */

/** Per-message text cap. */
export const TEXT_MAX_CHARS = 2000;

/** Text cut to TEXT_MAX_CHARS with the shared marker that reports how much
 * was cut (gws-mcp's `truncate` in `src/tools/response.ts`). */
export function trimText(text: string): string {
  if (text.length <= TEXT_MAX_CHARS) return text;
  return `${text.slice(0, TEXT_MAX_CHARS)}\n…[truncated ${text.length - TEXT_MAX_CHARS} of ${text.length} chars]`;
}
