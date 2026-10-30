/**
 * URL-mode elicitation for a connect (SCRUM-466).
 *
 * Used only when the client declared `elicitation.url` at initialize. The
 * server asks the client to open a connect link; accepting means the user
 * agreed to open it, not that they finished, so the call then waits for that
 * link's connect to store its account, up to a bound. The callback marks the
 * link completed in the database and wakes a waiter in this process; a waiter
 * on another process (a deploy in between) finds the mark by re-reading.
 *
 * While waiting, a progress notification goes out every 20 seconds when the
 * call carried a progress token, so a stream that holds the call open is not
 * idle the whole time.
 */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Database } from "@datatorag-mcp/db";
import { CONNECT_LINK_TTL_MS, connectLinkCompleted, markConnectLinkCompleted } from "./connect-links";

export type CallExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** How long the call waits after the user accepts. Inside the link's ten
 * minutes, which is also how long the request itself may stay open. */
export const CONNECT_WAIT_MS = 5 * 60 * 1000;
const POLL_MS = 5_000;
const PROGRESS_MS = 20_000;

/** The words the client shows beside the link. */
export const elicitationMessage = (service: string) => `Connect ${service} to continue.`;

export type ElicitOutcome = "connected" | "declined" | "timed_out" | "unavailable";

/** In-process waiters, keyed by link id. On `globalThis`, like the download
 * store, so a module loaded twice still shares one table. */
const WAITERS = Symbol.for("datatorag.connect-elicitation.waiters");
function waiters(): Map<string, Set<() => void>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Set<() => void>> | undefined>;
  return (g[WAITERS] ??= new Map());
}

/** The callback's half: the link's connect stored its account. */
export async function connectLinkDone(db: Database, linkId: string): Promise<void> {
  try {
    await markConnectLinkCompleted(db, linkId);
  } catch (err) {
    console.error("[connect-elicitation] could not mark a link completed:", err instanceof Error ? err.message : err);
  }
  for (const wake of waiters().get(linkId) ?? []) wake();
}

/** Whether the client can be sent a URL elicitation. */
export function supportsUrlElicitation(server: Server): boolean {
  return Boolean(server.getClientCapabilities()?.elicitation?.url);
}

/** Resolves true when the link's connect completes, false at the deadline or
 * when the call is cancelled. */
function waitForConnect(db: Database, linkId: string, extra: CallExtra, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const set = waiters().get(linkId) ?? new Set<() => void>();
    waiters().set(linkId, set);
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(poll);
      clearInterval(progress);
      set.delete(wake);
      if (set.size === 0) waiters().delete(linkId);
      extra.signal.removeEventListener("abort", abort);
      resolve(value);
    };
    const wake = () => finish(true);
    const abort = () => finish(false);
    set.add(wake);
    extra.signal.addEventListener("abort", abort);
    const deadline = setTimeout(() => finish(false), ms);
    const poll = setInterval(() => {
      connectLinkCompleted(db, linkId).then(
        (done) => done && finish(true),
        () => undefined
      );
    }, POLL_MS);
    const token = extra._meta?.progressToken;
    let ticks = 0;
    const progress = setInterval(() => {
      if (token === undefined) return;
      ticks += 1;
      extra
        .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ticks } })
        .catch(() => undefined);
    }, PROGRESS_MS);
  });
}

/**
 * Asks the client to open a connect link and waits for the connect. Never
 * throws: anything that goes wrong is an outcome, and the caller falls back
 * to the tool result with a link.
 */
export async function elicitConnect(input: {
  server: Server;
  db: Database;
  extra: CallExtra;
  serviceName: string;
  issueLink: () => Promise<{ id: string; url: string } | null>;
}): Promise<ElicitOutcome> {
  const link = await input.issueLink();
  if (!link) return "unavailable";
  let action: string;
  try {
    const result = await input.server.elicitInput(
      { mode: "url", elicitationId: link.id, url: link.url, message: elicitationMessage(input.serviceName) },
      // On the tool call's own stream: a client need not hold the standalone
      // one open, and this request belongs to the call.
      { timeout: CONNECT_LINK_TTL_MS, signal: input.extra.signal, relatedRequestId: input.extra.requestId }
    );
    action = result.action;
  } catch (err) {
    console.warn("[connect-elicitation] elicitation failed:", err instanceof Error ? err.message : err);
    return "unavailable";
  }
  if (action !== "accept") return "declined";
  const connected = await waitForConnect(input.db, link.id, input.extra, CONNECT_WAIT_MS);
  if (!connected) return "timed_out";
  try {
    await input.server.createElicitationCompletionNotifier(link.id, { relatedRequestId: input.extra.requestId })();
  } catch {
    // The client hears it from the retried call's answer anyway.
  }
  return "connected";
}
