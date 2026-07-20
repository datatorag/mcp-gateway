import { randomUUID } from "node:crypto";
import type { ToolUse } from "./engine";

/**
 * Short-lived server-side hold for a playground turn paused at a write,
 * awaiting the user's approve/deny. The paused conversation can't live in the
 * browser (it's the raw provider message array, and a client could tamper
 * with it), so it stays here keyed by an opaque resume token.
 *
 * In-memory is sufficient: prod runs a single gateway container, a lost hold
 * (redeploy/expiry) just means the user re-runs the prompt, and holds are
 * tiny and short-lived. TTL + a size cap bound memory. If the gateway ever
 * scales to multiple instances, move this to Redis/Postgres keyed the same way.
 */

export type PendingTurn = {
  userId: string;
  messages: unknown[];
  batch: ToolUse[];
  createdAt: number;
};

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

const store = new Map<string, PendingTurn>();

function sweep(now: number): void {
  for (const [token, entry] of store) {
    if (now - entry.createdAt > TTL_MS) store.delete(token);
  }
  // Hard cap as a memory backstop: drop oldest (insertion order) if still over.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Persist a paused turn and return its resume token. */
export function putPending(userId: string, messages: unknown[], batch: ToolUse[]): string {
  const now = Date.now();
  sweep(now);
  const token = randomUUID();
  store.set(token, { userId, messages, batch, createdAt: now });
  return token;
}

/** Fetch and remove a paused turn — only if the token exists, belongs to this
 * user, and hasn't expired. Returns null otherwise (one-shot; a token is never
 * reusable). */
export function takePending(userId: string, token: string): PendingTurn | null {
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token);
  if (entry.userId !== userId) return null;
  if (Date.now() - entry.createdAt > TTL_MS) return null;
  return entry;
}

/** Test-only: clear all holds. */
export function _resetPendingStore(): void {
  store.clear();
}
