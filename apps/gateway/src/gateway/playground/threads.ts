import { getMemoryStore } from "@/mastra";

/**
 * THE ONLY WAY TO READ OR DELETE A CONVERSATION. One gate, not a check per
 * route.
 *
 * WHY IT IS ONE FUNCTION-SET AND NOT A CHECK AT EACH CALL SITE. Per-route
 * checks are how the dashboard ended up with some routes verifying the session
 * and others not, which nobody could answer from memory and which took an
 * enumeration to establish. Repeating that shape for conversation data, where
 * the thing leaking is the contents of someone's chat, is worse. So the routes
 * hold no authorization logic at all: they call these functions with the
 * session user and render what comes back.
 *
 * OWNERSHIP IS BY CHECK ON READS AND BY CONSTRUCTION ON WRITES, deliberately a
 * hybrid.
 *
 * Writes keep deriving the thread id server-side from the session user, so a
 * caller cannot create or write into a thread it does not own: the id it would
 * need is not something it can supply.
 *
 * Reads cannot work that way, and the reason is concrete rather than
 * philosophical. The derivation is a one-way hash of the user id and a client
 * conversation id, so the client ids of threads already on disk are
 * unrecoverable — a pure by-construction read would be unable to address any
 * conversation that already exists. And once a list feature hands the user
 * their own thread ids, id secrecy was never the boundary; it was a side
 * effect. So reads take an id and prove ownership explicitly.
 *
 * NOT FOUND, NEVER FORBIDDEN. A foreign id and an unknown id return exactly
 * the same thing. Answering 403 for one and 404 for the other turns this into
 * an oracle that confirms a thread exists for someone else, which is a smaller
 * leak than the messages but is still a leak, and it is free to avoid.
 *
 * The storage layer helps with two of the three operations and not the third:
 * `getThreadById` and `listMessages` both take a resource id and enforce it
 * (verified against real rows: a foreign resource id yields null and zero
 * messages respectively). `deleteThread` takes an id ALONE and enforces
 * nothing. That asymmetry is the whole reason this file exists.
 */

/** A conversation, as a list needs it. Deliberately not the storage row: the
 * route should not be able to leak a field by forgetting to pick. */
export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Enough of a stored message for the UI to replay it. */
export interface StoredMessage {
  id: string;
  role: string;
  content: unknown;
  createdAt: string;
}

interface MemoryDomain {
  listThreads(args: {
    filter?: { resourceId?: string };
    perPage?: number | false;
    page?: number;
    orderBy?: { field?: string; direction?: "ASC" | "DESC" };
  }): Promise<unknown>;
  getThreadById(args: {
    threadId: string;
    resourceId?: string;
  }): Promise<unknown>;
  listMessages(args: {
    threadId: string;
    resourceId?: string;
    perPage?: number | false;
  }): Promise<unknown>;
  deleteThread(threadId: string): Promise<void>;
  updateThread?(args: {
    id: string;
    title: string;
    metadata: Record<string, unknown>;
  }): Promise<unknown>;
}

async function memory(): Promise<MemoryDomain> {
  const store = (await getMemoryStore()) as MemoryDomain | undefined;
  if (!store) throw new Error("memory storage is not configured");
  return store;
}

/** Storage returns either an array or a paginated envelope depending on the
 * call; normalising here keeps that shape question out of every caller. */
function rows<T>(result: unknown, key: "threads" | "messages"): T[] {
  if (Array.isArray(result)) return result as T[];
  const envelope = result as Record<string, unknown> | null;
  const inner = envelope?.[key];
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/**
 * Prove this user owns this thread, or report that it does not exist.
 *
 * The single choke point. Everything below calls it first, including the
 * delete, which is the operation whose storage primitive would otherwise
 * accept any id at all.
 */
async function ownedThread(
  userId: string,
  threadId: string
): Promise<{ id: string; title?: string; updatedAt?: unknown } | null> {
  if (!userId || !threadId) return null;
  const thread = (await (
    await memory()
  ).getThreadById({ threadId, resourceId: userId })) as {
    id: string;
    resourceId?: string;
    title?: string;
    updatedAt?: unknown;
  } | null;
  if (!thread) return null;
  // Belt and braces: the storage call is documented and observed to filter by
  // resource, but this is the one place in the app where being wrong means
  // handing over someone else's conversation. If the parameter were ever
  // silently dropped by a dependency bump, the check below still refuses.
  if (thread.resourceId !== undefined && thread.resourceId !== userId) return null;
  return thread;
}

/** Every conversation this user owns, newest first. */
export async function listThreadsForUser(
  userId: string,
  limit = 50
): Promise<ThreadSummary[]> {
  if (!userId) return [];
  const result = await (
    await memory()
  ).listThreads({
    filter: { resourceId: userId },
    perPage: limit,
    orderBy: { field: "updatedAt", direction: "DESC" },
  });
  return rows<{ id: string; title?: string; updatedAt?: unknown; createdAt?: unknown }>(
    result,
    "threads"
  ).map((t) => ({
    id: t.id,
    title: typeof t.title === "string" ? t.title : "",
    updatedAt: asIso(t.updatedAt) ?? asIso(t.createdAt) ?? new Date(0).toISOString(),
  }));
}

/** One conversation's messages, or null when it is not this user's. */
export async function readThreadForUser(
  userId: string,
  threadId: string
): Promise<StoredMessage[] | null> {
  const thread = await ownedThread(userId, threadId);
  if (!thread) return null;
  const result = await (
    await memory()
  ).listMessages({ threadId, resourceId: userId, perPage: false });
  return rows<{ id: string; role?: string; content?: unknown; createdAt?: unknown }>(
    result,
    "messages"
  ).map((m) => ({
    id: m.id,
    role: typeof m.role === "string" ? m.role : "assistant",
    content: m.content,
    createdAt: asIso(m.createdAt) ?? new Date(0).toISOString(),
  }));
}

/** Delete a conversation. `false` means it was not this user's to delete, and
 * the caller must answer exactly as it would for an id that never existed.
 *
 * THE OWNERSHIP CHECK HERE IS THE ONLY ONE THERE IS. `deleteThread` takes an
 * id and no owner, so removing the guard above it does not fail loudly, it
 * silently deletes strangers' conversations. */
export async function deleteThreadForUser(
  userId: string,
  threadId: string
): Promise<boolean> {
  const thread = await ownedThread(userId, threadId);
  if (!thread) return false;
  await (await memory()).deleteThread(threadId);
  return true;
}

/** Give a thread its title, once, when it does not have one.
 *
 * Titles are written by us rather than by the framework, which leaves them
 * empty. Deterministic and free: see `threadTitle`. */
export async function setThreadTitleIfEmpty(
  userId: string,
  threadId: string,
  title: string
): Promise<void> {
  const thread = await ownedThread(userId, threadId);
  if (!thread || !title) return;
  if (typeof thread.title === "string" && thread.title.trim() !== "") return;
  const store = await memory();
  await store.updateThread?.({ id: threadId, title, metadata: {} });
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
