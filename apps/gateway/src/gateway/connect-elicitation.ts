/**
 * URL-mode elicitation for a connect (SCRUM-466).
 *
 * Used only when the client declared `elicitation.url` at initialize. The
 * prompt is a convenience beside the answer, never the answer: the tool call
 * returns at once with the connect link in its result, and the same link is
 * also sent as `elicitation/create`, which is NEVER awaited. Accept, decline
 * or no answer at all change nothing. A tool call must never wait on a
 * person: the edge cuts an idle stream, the client cuts an idle call after
 * minutes, and a late answer on a cut stream reaches nobody.
 *
 * When the link's connect completes in the browser, the callback marks the
 * link completed and, best effort, sends `elicitation/complete` for the
 * prompt, so a client that shows one can clear it. Kept in this process for
 * the link's lifetime and no longer; a prompt on another process is simply
 * not cleared.
 */
import { randomUUID } from "node:crypto";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Database } from "@datatorag-mcp/db";
import { CONNECT_LINK_TTL_MS, markConnectLinkCompleted } from "./connect-links";

export type CallExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The words the client shows beside the link. */
export const elicitationMessage = (service: string) => `Connect ${service} to continue.`;

/** Prompts sent for a link, by link id: how to tell the client it is done.
 * On `globalThis`, like the download store, so a module loaded twice still
 * shares one table. */
const PROMPTS = Symbol.for("datatorag.connect-elicitation.prompts");
function prompts(): Map<string, () => Promise<void>> {
  const g = globalThis as unknown as Record<symbol, Map<string, () => Promise<void>> | undefined>;
  return (g[PROMPTS] ??= new Map());
}

/** Whether the client can be sent a URL elicitation. */
export function supportsUrlElicitation(server: Server): boolean {
  return Boolean(server.getClientCapabilities()?.elicitation?.url);
}

/**
 * Sends the link as a URL elicitation and returns without waiting for it.
 * Never throws, and nothing the client answers is read.
 */
export function promptConnect(input: {
  server: Server;
  extra: CallExtra;
  serviceName: string;
  link: { id: string; url: string };
}): void {
  // Its own random id: the link's row id is a database key, never sent out.
  const elicitationId = randomUUID();
  try {
    input.server
      .elicitInput(
        { mode: "url", elicitationId, url: input.link.url, message: elicitationMessage(input.serviceName) },
        // On the tool call's stream while it lasts; the answer, if any, comes
        // back on a request of its own and is ignored.
        { timeout: CONNECT_LINK_TTL_MS, relatedRequestId: input.extra.requestId }
      )
      .catch(() => undefined);
  } catch {
    return;
  }
  const table = prompts();
  table.set(input.link.id, () => input.server.createElicitationCompletionNotifier(elicitationId)());
  setTimeout(() => table.delete(input.link.id), CONNECT_LINK_TTL_MS).unref();
}

/** The callback's half: the link's connect stored its account. Marks it, and
 * tells the client its prompt is done, without waiting on either. */
export async function connectLinkDone(db: Database, linkId: string): Promise<void> {
  const complete = prompts().get(linkId);
  prompts().delete(linkId);
  if (complete) {
    try {
      complete().catch(() => undefined);
    } catch {
      // A session that has gone away cannot be told; nothing else depends on it.
    }
  }
  try {
    await markConnectLinkCompleted(db, linkId);
  } catch (err) {
    console.error("[connect-elicitation] could not mark a link completed:", err instanceof Error ? err.message : err);
  }
}
