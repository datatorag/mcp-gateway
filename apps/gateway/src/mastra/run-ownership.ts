import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Who is allowed to approve a suspended tool call.
 *
 * WHY THIS FILE EXISTS — the agent runtime does not answer that question.
 * Resuming a suspended run is a lookup by run id and nothing else: the id is
 * the only credential. Nothing compares the resuming caller against the
 * identity the run was created under, so a caller who presents someone else's
 * run id gets someone else's run. This was not inferred from the types — it
 * was reproduced end to end against a real MCP server, and the victim's write
 * really executed on it, which is the only evidence that counts. That
 * reproduction is kept, next to the proof that the route's gate defeats it, in
 * `../app/api/playground/chat/route.ownership.test.ts`.
 *
 * It is worse than "an endpoint we must remember to check", because the run id
 * is not something we hand out deliberately: it is embedded in the approval id
 * that goes to the browser as part of the ordinary chat stream, and it comes
 * back inside a client-supplied messages array. There is no separate resume
 * endpoint to guard.
 *
 * SO OWNERSHIP IS BUILT INTO THE ID. A run id minted here is a nonce plus an
 * HMAC over (that nonce, the owning user). Verification recomputes the tag
 * with the id of the user who is asking: only the owner reproduces it. Nobody
 * can construct a valid id for a user they are not, and — unlike a
 * secrecy-based scheme — an id that leaks (a log line, a screen share, a
 * shared browser profile) still cannot be redeemed by anyone else.
 *
 * The consequence worth stating plainly: an approval whose run id does not
 * verify is not resumable BY ANY PATH, because a run that was never minted
 * here can never have been suspended here either.
 *
 * KEY LIFETIME. The key is random per process and never persisted, and that is
 * deliberate rather than an oversight. It does mean a restart invalidates every
 * outstanding approval id: the run snapshot itself lives in Postgres and
 * survives, but no id minted by the old process verifies against the new key,
 * so a user who was mid-approval re-runs the prompt. That was already the
 * outcome — and the same message — before, so nothing regressed, and it buys
 * not having a long-lived secret to store and rotate. Production runs a single
 * gateway container, so it costs one re-run per deploy at worst.
 *
 * If the gateway ever runs more than one process, this key must move to shared
 * configuration — otherwise an approval would only verify on the instance that
 * happened to serve the turn that minted it. Until then a shared secret would
 * be a liability with no benefit.
 */
const KEY = randomBytes(32);

/** Separator between the nonce and its tag.
 *
 * Must not be `::`, and must not contain it: the framework recovers the run id
 * from an approval id by splitting on the LAST `::`, so a run id containing
 * that sequence would be torn apart at the wrong place and would never verify.
 * `~` is outside the base64url alphabet used for both halves, so the split
 * below is unambiguous. */
const SEPARATOR = "~";

function tag(userId: string, nonce: string): string {
  // NUL-separated so a userId ending in the nonce's first characters cannot
  // collide with a different (userId, nonce) pair that concatenates the same.
  return createHmac("sha256", KEY).update(`${userId}\u0000${nonce}`).digest("base64url");
}

/** A fresh run id owned by `userId`.
 *
 * Handed to the agent when a turn starts, which is what puts it in front of
 * the approval id the client later sends back. */
export function mintRunId(userId: string): string {
  const nonce = randomBytes(16).toString("base64url");
  return `${nonce}${SEPARATOR}${tag(userId, nonce)}`;
}

/** Whether `runId` was minted for `userId` by this process.
 *
 * False for anything not minted here at all — a made-up id, an id from a
 * previous process, or a well-formed id belonging to somebody else. The
 * comparison is constant-time so a caller cannot search for a valid tag by
 * timing the response. */
export function ownsRunId(userId: string, runId: string): boolean {
  const at = runId.indexOf(SEPARATOR);
  if (at === -1) return false;
  const presented = Buffer.from(runId.slice(at + SEPARATOR.length));
  const expected = Buffer.from(tag(userId, runId.slice(0, at)));
  // timingSafeEqual throws on a length mismatch, so that has to be checked
  // first — and it is not a leak: the tag length is fixed and public.
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** One approval decision found in a client-supplied messages array. */
export type ApprovalTarget = { runId: string; approved: boolean };

/** Every approval response anywhere in a request, whether or not the runtime
 * would act on it.
 *
 * Deliberately a SUPERSET of what the runtime extracts. The runtime's own
 * extractor is not exported, so matching it exactly is not something we could
 * verify or keep in lockstep — but we do not need to match it, we need to
 * dominate it. It ignores approvals we would see (it looks only at requests
 * whose final message is an assistant one, and drops parts whose tool-call id
 * disagrees with the approval id); it can never act on one we would MISS. So
 * checking everything found here is sufficient however that extractor changes,
 * and the failure mode of a future divergence is a rejected request rather
 * than an unchecked resume.
 *
 * The run id is recovered by splitting the approval id at its LAST `::`, the
 * join the runtime uses. Ids from {@link mintRunId} never contain that
 * sequence, so the split is exact for anything we issued — and anything we did
 * not issue fails {@link ownsRunId} regardless of where it splits.
 *
 * Written against `unknown` on purpose: this reads a request body, so every
 * level of it is hostile until proven otherwise. */
export function findApprovalTargets(messages: unknown): ApprovalTarget[] {
  if (!Array.isArray(messages)) return [];
  const targets: ApprovalTarget[] = [];
  for (const message of messages) {
    const parts = (message as { parts?: unknown })?.parts;
    if ((message as { role?: unknown })?.role !== "assistant" || !Array.isArray(parts)) continue;
    for (const part of parts) {
      if ((part as { state?: unknown })?.state !== "approval-responded") continue;
      const approval = (part as { approval?: unknown })?.approval as
        | { id?: unknown; approved?: unknown }
        | undefined;
      if (typeof approval?.id !== "string") continue;
      const at = approval.id.lastIndexOf("::");
      // `<= 0` rather than `=== -1`: an id that STARTS with the separator has
      // an empty run id, which is not something we ever minted.
      if (at <= 0) continue;
      targets.push({ runId: approval.id.slice(0, at), approved: approval.approved === true });
    }
  }
  return targets;
}

/** The conversation thread a client-supplied chat id maps to, for this user.
 *
 * Conversation ids are chosen by the browser, so on their own they are an
 * invitation to read someone else's chat by guessing one. Folding the user id
 * into the derivation removes the question entirely: the same chat id sent by
 * two different users produces two different threads, so a thread is
 * unreachable from any account but its owner's.
 *
 * NOT keyed with {@link KEY}, and that is the point. This value has to be
 * STABLE — a thread the user comes back to tomorrow must resolve to the same
 * id, or conversation history silently forks on every restart. It does not
 * need to be unguessable, because guessing it buys nothing: the derivation
 * already binds it to one account, and thread reads are additionally scoped by
 * the `resource` we pass alongside it. Plain hashing is the right tool.
 *
 * THIS DERIVATION IS THE CONTROL, not a tidiness measure — measured, not
 * assumed. Handing the runtime one user's thread id alongside another user's
 * resource id recalls NOTHING of the first user's conversation, so reads are
 * genuinely scoped by the pair. But the write is not refused: the second
 * user's messages land in the named thread, tagged with their own resource id,
 * where neither party will ever recall them. So the reason no user can address
 * another's thread is that the id is derived here, from the session user, and
 * never accepted from the request — keep it that way. Taking a thread id off
 * the wire would not leak a conversation, but it would let anyone scribble
 * into anyone's. */
export function deriveThreadId(userId: string, clientThreadId: string): string {
  return createHash("sha256")
    .update(`${userId}\u0000${clientThreadId}`)
    .digest("base64url")
    .slice(0, 32);
}
