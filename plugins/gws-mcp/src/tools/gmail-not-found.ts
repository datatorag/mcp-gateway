import type { GwsClient } from "../gws-client.js";
import { GwsApiError } from "../google-api/errors.js";

/**
 * SCRUM-493. When Gmail answers 404 for a message, thread, draft or
 * attachment id, the answer says what was not found, in which mailbox, why
 * that usually happens and what to do next, instead of Google's bare
 * "Requested entity was not found". One path for every Gmail tool: it is
 * keyed on the request that failed (its resource and path parameters), never
 * on the tool, so a tool that reads a message on the way to doing something
 * else (a reply, a forward) is covered too. Google's own code and reason
 * follow the sentence, for debugging. Nothing is retried in another account.
 */

type Kind = "message" | "thread" | "draft" | "attachment";

const KIND_BY_RESOURCE: Record<string, Kind> = {
  "users.messages": "message",
  "users.threads": "thread",
  "users.drafts": "draft",
  "users.messages.attachments": "attachment",
};

/** Why each kind of id usually stops resolving, and where its current id is. */
const REASONS: Record<Kind, string> = {
  message:
    "It may have been deleted for good, or it may belong to another connected Google account. gmail_search finds a message's current id.",
  thread:
    "It may have been deleted for good, or it may belong to another connected Google account. gmail_search returns each message's threadId.",
  draft:
    "A draft stops existing once it is sent or deleted, and it may belong to another connected Google account. gmail_list_drafts lists the current drafts.",
  attachment:
    "Gmail issues a new attachment id each time a message is read, so an id from an earlier read can stop working. gmail_read lists the message's attachments with their current ids and part ids.",
};

/** The address of the mailbox the token opens, or null when Gmail does not
 * say. One call, made only after a 404, with the access the call already had. */
async function mailboxOf(client: GwsClient): Promise<string | null> {
  try {
    const profile = await client.api("gmail", "users", "getProfile", { params: { userId: "me" } });
    const email = (profile.data as { emailAddress?: unknown })?.emailAddress;
    return typeof email === "string" && email !== "" ? email : null;
  } catch {
    return null;
  }
}

/** A thread id that is really a message id: the message's own thread, when
 * Gmail has a message by that id. Certain, because it is Gmail's answer. */
async function threadOfMessage(client: GwsClient, id: string): Promise<string | null> {
  try {
    const msg = await client.api("gmail", "users.messages", "get", {
      params: { userId: "me", id, format: "minimal" },
    });
    const threadId = (msg.data as { threadId?: unknown })?.threadId;
    return typeof threadId === "string" && threadId !== "" ? threadId : null;
  } catch {
    return null;
  }
}

/** The words for a Gmail 404, or null for any other error. */
export async function gmailNotFound(client: GwsClient, err: unknown): Promise<string | null> {
  if (!(err instanceof GwsApiError) || err.status !== 404 || err.request?.service !== "gmail") return null;
  const kind = KIND_BY_RESOURCE[err.request.resource];
  const id = err.request.pathParams.id;
  if (!kind || !id) return null;

  const google = `(Google: ${err.status}${err.reason ? ` ${err.reason}` : ""}, ${err.message})`;
  if (kind === "thread") {
    const threadId = await threadOfMessage(client, id);
    if (threadId && threadId !== id) {
      return (
        `${id} is a message id, not a thread id. That message belongs to thread ${threadId}, ` +
        `which is the id gmail_read_thread and the other thread tools take. ${google}`
      );
    }
  }

  const mailbox = await mailboxOf(client);
  const where = mailbox ? ` in ${mailbox}` : " in this Gmail account";
  const what =
    kind === "attachment" && err.request.pathParams.messageId
      ? `attachment with the id ${id} on message ${err.request.pathParams.messageId}`
      : `${kind} with the id ${id}`;
  return (
    `Gmail has no ${what}${where}. ${REASONS[kind]} ` +
    `The account argument reads from another mailbox, and list_connected_accounts names the connected accounts. ` +
    google
  );
}
