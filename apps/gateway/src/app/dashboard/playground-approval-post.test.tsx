// @vitest-environment jsdom

/**
 * Does approving a gated write actually SEND the decision?
 *
 * Recording a decision and delivering it are two different things, and only one
 * of them is visible. `addToolApprovalResponse` rewrites the tool part in place,
 * so the card flips to "Responded", the confirm buttons disappear and the
 * composer unlocks — the UI looks exactly like a successful approval whether or
 * not a single byte left the browser. The suspended run on the server just
 * never resumes, and the write the user said yes to never happens.
 *
 * The thing that turns the recorded decision into a request is one line of
 * `useChat` configuration — `sendAutomaticallyWhen`. Nothing type-checks it:
 * it is optional, so deleting it compiles, builds, renders and passes every
 * other test in this repo. That is precisely why it is worth a test of its own,
 * and why this one asserts on the OUTGOING REQUEST rather than on any state the
 * component holds.
 *
 * So: mount the real container (the only place that knows about `useChat`),
 * serve it a real suspended turn over a stubbed `fetch`, click Approve, and
 * demand that a second POST goes out carrying that decision.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessageChunk } from "ai";

import { Playground, type PlaygroundHandle } from "./playground";

/** In the shape the server mints one — a credential, relayed byte for byte. */
const APPROVAL_ID =
  "Zm9vYmFyYmF6cXV4MTIzNA~x9Kj-_2QlZ0nT4pRs6VbWc8dYeAfGhIjKlMnOpQrStU::call-1";

const WRITE_TOOL = "gws-mcp__docs_create";

/** A turn that stops at the gated write. No `finish-step`, no `finish` — that
 * is what a suspended turn looks like on the wire, not an incomplete fixture. */
const SUSPENDED_TURN: UIMessageChunk[] = [
  { type: "start", messageId: "assistant-1" },
  { type: "start-step" },
  { type: "tool-input-start", toolCallId: "call-1", toolName: WRITE_TOOL },
  {
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: WRITE_TOOL,
    input: { title: "Q3 report" },
  },
  { type: "tool-approval-request", toolCallId: "call-1", approvalId: APPROVAL_ID },
];

/** The resume leg: the write runs and the turn ends normally. */
const RESUMED_TURN: UIMessageChunk[] = [
  { type: "start", messageId: "assistant-1" },
  { type: "start-step" },
  {
    type: "tool-output-available",
    toolCallId: "call-1",
    output: { url: "https://docs.example/1" },
  },
  { type: "finish-step" },
  { type: "finish" },
];

function sseResponse(chunks: UIMessageChunk[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;
let handle: PlaygroundHandle | null;
/** Every request body the component posted, parsed. THE assertion surface. */
let posted: Array<Record<string, unknown>>;

const fetchMock = vi.fn();

/** Let queued microtasks and stream reads settle inside act(). */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function buttonLabelled(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find((el) =>
    (el.textContent ?? "").includes(label)
  );
  if (!match) {
    throw new Error(
      `no button labelled ${JSON.stringify(label)} — rendered: ${(
        container.textContent ?? ""
      ).replace(/\s+/g, " ")}`
    );
  }
  return match;
}

beforeEach(() => {
  posted = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
    // The meter (SCRUM-94) reads these two on mount and after each turn;
    // they are not chat traffic and must not be counted as turns.
    const target = String(url);
    if (target.includes("/api/playground/quota")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ runsUsed: 0, runsCap: 25, runsRemaining: 25 }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    }
    if (target.includes("/api/connections")) {
      return Promise.resolve(
        new Response(JSON.stringify({ accounts: [], connections: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    posted.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return Promise.resolve(
      sseResponse(posted.length === 1 ? SUSPENDED_TURN : RESUMED_TURN)
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  // jsdom has neither, and the vendored conversation/scroll components use both.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.scrollTo ??= () => {};

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  handle = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mountAndSuspend(): Promise<void> {
  act(() => {
    root.render(
      <Playground
        hasConnectedAccount
        prompts={["do a thing"]}
        ref={(instance: PlaygroundHandle | null) => {
          handle = instance;
        }}
      />
    );
  });

  act(() => {
    handle?.runPrompt("create the doc");
  });
  await settle();

  // Precondition, not the assertion: the turn really did suspend, and the user
  // really is looking at a confirm card.
  expect(posted).toHaveLength(1);
  expect(buttonLabelled("Approve & run")).toBeTruthy();
}

/** The decision as it appears on the wire: the tool part moved to
 * `approval-responded`, on the last assistant message. */
function approvalPartsIn(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const messages = (body.messages ?? []) as Array<{ parts?: unknown[] }>;
  return messages
    .flatMap((message) => (Array.isArray(message.parts) ? message.parts : []))
    .filter(
      (part): part is Record<string, unknown> =>
        (part as { state?: unknown })?.state === "approval-responded"
    );
}

describe("delivering the user's decision on a gated write", () => {
  it("POSTs the approval, rather than only recording it in the UI", async () => {
    await mountAndSuspend();

    act(() => {
      buttonLabelled("Approve & run").click();
    });
    await settle();

    // The whole point. Recording the decision is not delivering it; without
    // `sendAutomaticallyWhen` this stays at 1 and the suspended run is stranded
    // on the server while the UI shows a perfectly happy conversation.
    // Counted as CHAT posts, not raw fetches — the meter's quota/connections
    // reads share the same global fetch and are filtered out above.
    expect(posted).toHaveLength(2);

    const approvals = approvalPartsIn(posted[1]!);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.approval).toMatchObject({ id: APPROVAL_ID, approved: true });
    // Strict identity: the id is an HMAC-bearing credential, so a UI that
    // re-encoded or rebuilt it would post something the server answers 403 to.
    expect((approvals[0]!.approval as { id: string }).id).toBe(APPROVAL_ID);
  });

  it("POSTs a denial too, so the suspended run is closed out rather than left open", async () => {
    await mountAndSuspend();

    act(() => {
      buttonLabelled("Deny").click();
    });
    await settle();

    expect(posted).toHaveLength(2);
    const approvals = approvalPartsIn(posted[1]!);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.approval).toMatchObject({ id: APPROVAL_ID, approved: false });
  });
});
