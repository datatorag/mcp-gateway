// @vitest-environment jsdom

/**
 * Do the agent's own parts actually SHOW?
 *
 * Same reasoning as playground-message-list.test.tsx, and the same failure
 * mode it was written for: `MessageRow` returns `null` for any part it does
 * not recognise, so a data part the server emits and the client does not
 * render is invisible. Nothing that inspects types catches it — `tsc` is
 * perfectly happy, the build passes, and the thread just quietly lacks the
 * control the agent thought it had offered.
 *
 * So these assert on rendered DOM, from parts shaped the way they arrive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { MessageList, type PlaygroundMessage } from "./playground-presentation";
import { renderAgentPart } from "./agent-parts";

vi.mock("@/components/setup-instructions", () => ({
  // The config block is a large component with its own analytics; this suite
  // is about whether the part REACHES a renderer, not about that component.
  SetupInstructions: ({ surface }: { surface?: string }) => (
    <div data-testid="mcp-config">config surface={surface}</div>
  ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderParts(parts: unknown[]) {
  const messages = [
    { id: "m1", role: "assistant", parts },
  ] as unknown as PlaygroundMessage[];
  act(() => {
    root.render(
      <MessageList
        awaitingConfirm={false}
        busy={false}
        comments={{}}
        erroredIds={new Set()}
        feedback={{}}
        lastMessageComplete
        messages={messages}
        onCommentChange={() => {}}
        onDecide={() => {}}
        onRate={() => {}}
        onRegenerate={() => {}}
        onSendComment={() => {}}
      />
    );
  });
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

describe("agent data parts render in the thread", () => {
  it("renders the connect control with a link per service", () => {
    const text = renderParts([
      {
        type: "data-connect",
        data: {
          services: [
            { id: "google-workspace", name: "Google", connectHref: "/auth/google/connect" },
          ],
        },
      },
    ]);

    expect(text).toContain("Connect Google");
    const link = container.querySelector('a[href="/auth/google/connect"]');
    expect(link).not.toBeNull();
  });

  it("renders account state as a meter, not a wall", () => {
    const text = renderParts([
      {
        type: "data-account-state",
        data: { runsRemaining: 18, runsCap: 25, connectedAccounts: ["me@datatorag.com"] },
      },
    ]);

    // The whole point of exposing the counter: the user can see where they
    // stand before they hit the limit.
    expect(text).toContain("18 of your 25 runs left");
    expect(text).toContain("me@datatorag.com");
  });

  it("renders the config block tagged as the agent surface", () => {
    renderParts([{ type: "data-mcp-config", data: {} }]);

    // A config the agent offered mid-conversation and one found on a settings
    // page are different user states, and the copy event has to tell them apart.
    expect(container.querySelector('[data-testid="mcp-config"]')?.textContent).toContain(
      "surface=agent"
    );
  });

  it("renders text and a data part in the same message, in order", () => {
    const text = renderParts([
      { type: "text", text: "I need access first." },
      {
        type: "data-connect",
        data: {
          services: [{ id: "google-workspace", name: "Google", connectHref: "/x" }],
        },
      },
    ]);

    // Positional by nature: the part lands where the agent put it, which is
    // the property that made this a data part rather than a synthetic row.
    expect(text.indexOf("I need access first.")).toBeLessThan(text.indexOf("Connect Google"));
  });

  it("ignores an unknown data part instead of breaking the thread", () => {
    // A part from a newer server reaching an older client is normal during a
    // deploy. Losing one control is survivable; losing the conversation is not.
    const text = renderParts([
      { type: "text", text: "still here" },
      { type: "data-something-we-do-not-know", data: { x: 1 } },
    ]);

    expect(text).toContain("still here");
  });

  it("returns null for parts that are not data parts", () => {
    expect(renderAgentPart("text", undefined)).toBeNull();
    expect(renderAgentPart("tool-gws-mcp__docs_get", undefined)).toBeNull();
  });
});
