import type { Processor } from "@mastra/core/processors";

/**
 * The third prompt-cache breakpoint, on the latest message, moved every
 * step (SCRUM-241).
 *
 * The system prompt and the last tool schema carry the first two (see
 * `agents/datatorag.ts`). They cache the prefix that never changes inside a
 * turn. What they leave uncached is everything the run itself produces: each
 * tool result was sent again at full price on every later step, so a pass
 * over seven mailboxes was paid for on every step after the one that read
 * it, and a real brief hit the run ceiling before it wrote anything.
 *
 * Anthropic caches the whole prefix up to a breakpoint. With one on the
 * newest block of the newest message, each step writes only what arrived
 * since the previous step and reads the rest at the cache-read weight. The
 * mark is moved, never added: every earlier mark this processor made is
 * removed first, so the messages carry exactly one and the provider's limit
 * of four breakpoints (two are taken above) is never reached, and nothing
 * accumulates in a stored thread.
 *
 * A part's provider metadata becomes that block's cache control on the
 * wire; `prompt-cache.test.ts` asserts it on the bytes of a real request. A
 * provider that does not know the field ignores it and runs uncached, the
 * same fallback the other two breakpoints have.
 */

type Meta = Record<string, unknown>;
type Part = { type?: string; providerMetadata?: Meta; callProviderMetadata?: Meta };
type Message = { content?: { parts?: Part[] } };

const CACHE_CONTROL = { type: "ephemeral" } as const;

/** Which metadata field reaches the wire for this part.
 *
 * The runtime hands a processor its STORED message shape: text, reasoning
 * and file parts, `tool-invocation` parts for tool activity, and bookkeeping
 * parts such as `step-start` that produce no block at all. A text part's
 * `providerMetadata` becomes its block's provider options. A stored
 * `tool-invocation` part's `providerMetadata` is carried over as the call
 * metadata of the converted tool part, and the runtime then hands that to
 * BOTH the tool-call block and the tool-result block. So a tool tail carries
 * the mark on two adjacent blocks, the call and its result, which is one
 * breakpoint's worth of prefix (the call sits just before the result) and
 * keeps the request within the provider's limit of four. A part already in
 * the converted shape (`tool-<name>`, `dynamic-tool`) carries it on
 * `callProviderMetadata` directly. */
const FIELD = (part: Part): "providerMetadata" | "callProviderMetadata" =>
  part.type === "dynamic-tool" || (part.type?.startsWith("tool-") && part.type !== "tool-invocation")
    ? "callProviderMetadata"
    : "providerMetadata";

/** Parts that become a block on the wire AND may carry a breakpoint. Step
 * markers and sources produce no block, so marking them marks nothing. A
 * reasoning part does produce a block, a thinking block, and the provider
 * refuses cache control on one: choosing it would turn the step into a
 * request error. In practice a step ends on its text or its tool call, with
 * the thinking before them, so the reasoning part is never the tail; this
 * keeps it that way when a step ends on thinking alone. */
const MARKABLE = (part: Part): boolean =>
  part.type === "text" ||
  part.type === "file" ||
  part.type === "tool-invocation" ||
  part.type === "dynamic-tool" ||
  (part.type?.startsWith("tool-") ?? false);

/** Removes an Anthropic cache mark from a part, leaving other metadata as it was. */
function unmark(part: Part): void {
  for (const field of ["providerMetadata", "callProviderMetadata"] as const) {
    const anthropic = part[field]?.anthropic;
    if (!anthropic || typeof anthropic !== "object" || !("cacheControl" in anthropic)) continue;
    const { cacheControl: _dropped, ...rest } = anthropic as Meta;
    const meta = { ...part[field] } as Meta;
    if (Object.keys(rest).length) meta.anthropic = rest;
    else delete meta.anthropic;
    if (Object.keys(meta).length) part[field] = meta;
    else delete part[field];
  }
}

function mark(part: Part): void {
  const field = FIELD(part);
  const anthropic = (part[field]?.anthropic ?? {}) as Meta;
  part[field] = { ...part[field], anthropic: { ...anthropic, cacheControl: { ...CACHE_CONTROL } } };
}

// `satisfies`, not a type annotation: the agent's processor slot is a union
// that requires the step hook to be present on the type, and an annotation
// would widen it back to optional.
export const latestMessageBreakpoint = {
  id: "latest-message-breakpoint",
  processInputStep({ messages }: { messages: unknown[] }) {
    const list = messages as Message[];
    for (const m of list) for (const part of m.content?.parts ?? []) unmark(part);
    // The newest block on the wire: the last markable part of the last
    // message that has one (a trailing step marker is skipped).
    const tail = list
      .flatMap((m) => m.content?.parts ?? [])
      .filter(MARKABLE)
      .at(-1);
    if (tail) mark(tail);
    return { messages: messages as never };
  },
} satisfies Processor;
