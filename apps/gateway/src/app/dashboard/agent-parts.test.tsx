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
import {
  ConnectGrantContext,
  ConnectPart,
  ConnectReturnContext,
  renderAgentPart,
} from "./agent-parts";
import type { ScopeStatus } from "./connections/types";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { capture } }));

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

  it("routes the connect through the current thread when one is known (SCRUM-78)", () => {
    // The OAuth round trip is a full navigation; the `next` composed here is
    // what brings the user back into the conversation they left. Encoded, so
    // the thread's own query string survives the trip.
    const messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "data-connect",
            data: {
              services: [
                { id: "google-workspace", name: "Google", connectHref: "/auth/google/connect" },
              ],
            },
          },
        ],
      },
    ] as unknown as PlaygroundMessage[];
    act(() => {
      root.render(
        <ConnectReturnContext.Provider
          value={{ nextPath: "/dashboard/agent?thread=t-9" }}
        >
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
        </ConnectReturnContext.Provider>
      );
    });
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      `/auth/google/connect?next=${encodeURIComponent("/dashboard/agent?thread=t-9")}`
    );
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

  it("does not treat an inherited property as a renderer", () => {
    // `data-constructor` would resolve to Object.prototype.constructor on a
    // plain object lookup and be called as a renderer.
    expect(renderAgentPart("data-constructor", {})).toBeNull();
    expect(renderAgentPart("data-toString", {})).toBeNull();
  });

  it("returns null for parts that are not data parts", () => {
    expect(renderAgentPart("text", undefined)).toBeNull();
    expect(renderAgentPart("tool-gws-mcp__docs_get", undefined)).toBeNull();
  });
});

describe("connect control click telemetry (SCRUM-112)", () => {
  beforeEach(() => capture.mockClear());

  const SERVICES = [
    { id: "google-workspace", name: "Google Workspace", connectHref: "/auth/google/connect" },
  ];

  function renderConnect(source?: "thread" | "empty_state") {
    act(() => {
      root.render(<ConnectPart services={SERVICES} source={source} />);
    });
    const anchor = container.querySelector("a");
    expect(anchor, "no connect control rendered").not.toBeNull();
    return anchor as HTMLAnchorElement;
  }

  it("captures a click with the service and the affordance", () => {
    const anchor = renderConnect("thread");
    act(() => {
      // preventDefault by the TEST, not the component: jsdom would otherwise
      // attempt the navigation. The component must not prevent it — the
      // capture rides the click and never gates the OAuth redirect, which is
      // asserted separately below.
      anchor.addEventListener("click", (e) => e.preventDefault());
      anchor.click();
    });

    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe("connect_card_clicked");
    // BEHAVIOUR, NOT CONTENT, pinned exactly: the property set is closed, so
    // a future edit cannot quietly add request text or an email address to a
    // public analytics event. That closure is a standing rule and a public
    // product claim, which is why this is a strict equality on the keys.
    expect(props).toEqual({ service: "google-workspace", source: "thread" });
  });

  it("labels the empty-state affordance as its own source", () => {
    const anchor = renderConnect("empty_state");
    act(() => {
      anchor.addEventListener("click", (e) => e.preventDefault());
      anchor.click();
    });
    expect(capture).toHaveBeenCalledWith(
      "connect_card_clicked",
      expect.objectContaining({ source: "empty_state" })
    );
  });

  it("does not gate navigation on the capture", () => {
    // The click handler must leave the event's default alone: a telemetry
    // call that blocks or delays the OAuth redirect would trade the
    // measurement for the thing being measured.
    const anchor = renderConnect("thread");
    let defaultPrevented = true;
    act(() => {
      anchor.addEventListener(
        "click",
        (e) => {
          defaultPrevented = e.defaultPrevented;
          e.preventDefault(); // stop jsdom navigating, AFTER reading the flag
        },
        // Runs after the component's own bubble-phase handler.
        { capture: false }
      );
      anchor.click();
    });
    expect(defaultPrevented).toBe(false);
  });

  it("captures nothing on mere render", () => {
    renderConnect("thread");
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("connect control marks (SCRUM-97)", () => {
  it("each known service's control carries its mark AND its label", () => {
    act(() => {
      root.render(
        <ConnectPart
          services={[
            { id: "google-workspace", name: "Google Workspace", connectHref: "/auth/google/connect" },
            { id: "atlassian", name: "Atlassian", connectHref: "/auth/atlassian/connect" },
          ]}
          source="empty_state"
        />
      );
    });
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      // Mark PLUS label: the vendor mark is present and the readable name
      // survives beside it. Never mark alone.
      expect(anchor.querySelector("svg"), "control lost its mark").not.toBeNull();
      expect(anchor.textContent).toContain("Connect ");
    }
    expect(anchors[0]?.textContent).toContain("Google Workspace");
    expect(anchors[1]?.textContent).toContain("Atlassian");
  });

  it("an unknown service id renders the label with no mark, never a broken image", () => {
    act(() => {
      root.render(
        <ConnectPart
          services={[{ id: "not-a-service", name: "Mystery", connectHref: "/auth/mystery/connect" }]}
          source="thread"
        />
      );
    });
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.textContent).toContain("Connect Mystery");
    expect(anchor!.querySelector("svg")).toBeNull();
    expect(anchor!.querySelector("img")).toBeNull();
  });
});

/** SCRUM-106: the same `data-connect` part renders DIFFERENTLY depending on
 * what the user's default account actually granted, and that state comes
 * from context at render time, never from the stored part. */
describe("connect part on a connected-but-short account", () => {
  const ALL = ["Gmail", "Drive", "Calendar", "Docs", "Sheets", "Slides", "Contacts", "Tasks"];
  const shortStatus = (granted: string[]): ScopeStatus => {
    const services = ALL.map((displayName) => ({
      displayName,
      iconKey: displayName.toLowerCase(),
      granted: granted.includes(displayName),
    }));
    return {
      complete: granted.length === ALL.length,
      missing: services
        .filter((s) => !s.granted)
        .map((s) => ({ scope: `scope:${s.iconKey}`, displayName: s.displayName })),
      services,
    };
  };
  const part = {
    type: "data-connect",
    data: {
      services: [
        { id: "google-workspace", name: "Google Workspace", connectHref: "/auth/google/connect" },
      ],
    },
  };
  function renderWithGrant(status: ScopeStatus | undefined) {
    const messages = [
      { id: "m1", role: "assistant", parts: [part] },
    ] as unknown as PlaygroundMessage[];
    act(() => {
      root.render(
        <ConnectGrantContext.Provider
          value={{ scopeStatusByService: { "google-workspace": status } }}
        >
          <ConnectReturnContext.Provider value={{ nextPath: "/dashboard/agent?thread=t-9" }}>
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
          </ConnectReturnContext.Provider>
        </ConnectGrantContext.Provider>
      );
    });
    return (container.textContent ?? "").replace(/\s+/g, " ");
  }

  it("swaps the connect pitch for the grant panel, with one reconnect anchor", () => {
    const text = renderWithGrant(shortStatus([]));
    // The old card told an already-connected user to "Connect". Gone.
    expect(text).not.toContain("Connect an account");
    expect(text).not.toContain("Connect Google Workspace");
    expect(text).toContain("No Google services were granted");
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("Reconnect and grant access");
    // Same return-path composition the connect button uses.
    expect(links[0].getAttribute("href")).toBe(
      `/auth/google/connect?next=${encodeURIComponent("/dashboard/agent?thread=t-9")}`
    );
  });

  it("names the missing services with their marks on a partial grant", () => {
    const text = renderWithGrant(shortStatus(["Gmail", "Drive"]));
    expect(text).toContain("Not granted");
    expect(text).toContain("Calendar");
    expect(
      container.querySelectorAll("img[src^='/icons/services/']")
    ).toHaveLength(6);
    // Compact: never the raw-scope disclosure on the agent surface.
    expect(container.querySelector("details")).toBeNull();
  });

  it("keeps the plain connect card when the grant is complete or unknown", () => {
    for (const status of [shortStatus(ALL), undefined]) {
      const text = renderWithGrant(status);
      expect(text).toContain("Connect Google Workspace");
      expect(text).not.toContain("Reconnect");
    }
  });
});
