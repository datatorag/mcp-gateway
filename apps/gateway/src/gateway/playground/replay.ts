/**
 * Turn a stored conversation back into messages the live UI can render.
 *
 * THE SHAPES ARE NOT THE SAME, and that is the whole job. The chat runtime
 * streams tool activity as `tool-<name>` parts carrying `input`, `output` and
 * `state` at the top level. Storage holds the older `tool-invocation` shape,
 * with all of that nested under `toolInvocation`. Handing stored parts to the
 * renderer unconverted does not fail loudly: `isToolPart` matches
 * `tool-invocation` because it does begin with `tool-`, so every replayed tool
 * card renders with the literal name "invocation" and no arguments and no
 * result. Verified against real stored rows before writing this.
 *
 * A PENDING APPROVAL MUST NOT COME BACK AS A BUTTON. If the last turn stopped
 * waiting for a decision, that decision can no longer be given: the suspended
 * run is consumed on first use and approval ids deliberately do not survive a
 * restart. Replaying the Approve and Deny pair would produce two controls that
 * answer 403, which is precisely the dead-control failure this surface has
 * already been rolled back for. So a pending approval is converted into an
 * inert, honest part that says the decision expired, and the write is left
 * un-run, which is the truth: nothing was approved.
 */

/** Data parts we are willing to reconstitute from storage.
 *
 * Deliberately a list rather than a prefix test: `data-*` is an open namespace
 * that anything writing to the thread can put a part into, and this converter
 * is the boundary between stored bytes and rendered UI. */
const REPLAYABLE_DATA_PARTS = new Set([
  "data-approval-expired",
  "data-account-state",
  "data-mcp-config",
  // The inline Connect offer (SCRUM-78). It MUST replay: the connect flow is
  // a full-page OAuth round trip, so the one moment this part matters most is
  // when the thread is being rehydrated after the user comes back.
  "data-connect",
]);

/** The subset of a stored part this module understands. */
interface StoredPart {
  type?: string;
  text?: string;
  toolInvocation?: {
    toolName?: string;
    args?: unknown;
    result?: unknown;
    state?: string;
    toolCallId?: string;
    approval?: unknown;
  };
  [key: string]: unknown;
}

interface StoredContent {
  parts?: StoredPart[];
  content?: unknown;
}

export interface ReplayMessage {
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
}

/** What the live renderer calls a finished tool call. Storage's `state` values
 * come from an older vocabulary, so they are mapped rather than passed. */
function mapToolState(state: string | undefined, hasResult: boolean): string {
  switch (state) {
    case "result":
    case "output-available":
      return "output-available";
    case "partial-call":
    case "call":
    case "input-available":
      // A call with no result that is not awaiting a decision did not finish.
      // Reporting it as available output would invent a result it never had.
      return hasResult ? "output-available" : "output-error";
    case "output-error":
      return "output-error";
    default:
      return hasResult ? "output-available" : "output-error";
  }
}

/** True when this stored part is a write that stopped for a decision nobody
 * can give any more. */
function isPendingApproval(part: StoredPart): boolean {
  const state = part.toolInvocation?.state;
  if (part.type === "data-tool-call-approval") return true;
  return state === "approval-requested" || state === "awaiting-approval";
}

/**
 * Convert one stored part. Returns null for parts the UI has no use for, which
 * is not an error: `step-start` is stream bookkeeping and renders as nothing
 * live either.
 */
export function replayPart(part: StoredPart): unknown | null {
  const type = part.type;
  if (!type) return null;

  if (type === "text") {
    return typeof part.text === "string" && part.text !== ""
      ? { type: "text", text: part.text }
      : null;
  }

  // Reasoning is stored but the live thread does not surface it, so replay
  // matches what the user saw at the time rather than revealing more.
  if (type === "reasoning" || type === "step-start") return null;

  if (type === "tool-invocation") {
    const call = part.toolInvocation ?? {};
    const name = typeof call.toolName === "string" ? call.toolName : "";
    if (!name) return null;

    if (isPendingApproval(part)) {
      return expiredApproval(name);
    }

    const hasResult = call.result !== undefined && call.result !== null;
    return {
      // The live vocabulary: `tool-<name>`, so the renderer's own name
      // derivation and the card's title come out right.
      type: `tool-${name}`,
      toolCallId: call.toolCallId ?? `replay-${name}`,
      state: mapToolState(call.state, hasResult),
      input: call.args ?? {},
      ...(hasResult ? { output: call.result } : {}),
      ...(hasResult ? {} : { errorText: "This call did not finish." }),
    };
  }

  if (isPendingApproval(part)) {
    return expiredApproval(toolNameFromApproval(part));
  }

  // ALLOW-LISTED, not passed through. Replayed content is the user's own
  // today, so a hostile stored part would be self-inflicted — but that stops
  // being true the first time a thread is shared, exported, or opened by
  // support, and this is the code that would carry it. An unknown kind renders
  // as nothing either way, so refusing it here costs nothing and removes the
  // question.
  if (type.startsWith("data-") && REPLAYABLE_DATA_PARTS.has(type)) return part;

  return null;
}

/** The inert replacement for a decision that can no longer be answered. */
function expiredApproval(toolName: string) {
  return {
    type: "data-approval-expired",
    data: { toolName },
  };
}

function toolNameFromApproval(part: StoredPart): string {
  const call = part.toolInvocation;
  if (call && typeof call.toolName === "string") return call.toolName;
  const data = (part as { data?: { toolName?: unknown } }).data;
  return typeof data?.toolName === "string" ? data.toolName : "";
}

/**
 * Convert a stored message into a renderable one, or null when nothing in it
 * survives conversion.
 *
 * A message whose every part drops out is skipped rather than rendered empty:
 * an empty bubble in a replayed thread reads as a bug, and it is one.
 */
export function replayMessage(stored: {
  id: string;
  role: string;
  content: unknown;
}): ReplayMessage | null {
  const content = stored.content as StoredContent | string | null;
  const role = stored.role === "user" ? "user" : "assistant";

  // Oldest rows may hold a bare string rather than a parts array.
  if (typeof content === "string") {
    return content.trim() === ""
      ? null
      : { id: stored.id, role, parts: [{ type: "text", text: content }] };
  }

  const stored_parts = Array.isArray(content?.parts) ? content!.parts! : [];
  const parts = stored_parts
    .map((p) => replayPart(p))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (parts.length === 0) {
    // Fall back to the flat `content` field some rows carry alongside parts,
    // so a message is not silently lost just because its parts were all
    // bookkeeping.
    const flat = (content as StoredContent | null)?.content;
    if (typeof flat === "string" && flat.trim() !== "") {
      return { id: stored.id, role, parts: [{ type: "text", text: flat }] };
    }
    return null;
  }

  return { id: stored.id, role, parts };
}

/** A whole conversation, ready for the chat runtime to be seeded with. */
export function replayThread(
  stored: Array<{ id: string; role: string; content: unknown }>
): ReplayMessage[] {
  return stored
    .map((m) => replayMessage(m))
    .filter((m): m is ReplayMessage => m !== null);
}
