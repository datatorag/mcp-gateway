// @vitest-environment jsdom

/**
 * Does the grant panel actually SHOW the right thing in each state?
 *
 * Same reasoning as agent-parts.test.tsx: the failure mode here type-checks,
 * builds and renders without an error while telling a user something false
 * about their access. The two that matter most are the degenerate cases, which
 * are exactly the ones a developer testing against their own healthy account
 * never sees.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { GrantPanel } from "./grant-panel";
import {
  GRANT_ALL_GRANTED,
  GRANT_NONE_GRANTED,
  GRANT_RECONNECT_LABEL,
  GRANT_UNRECORDED,
} from "./grant-copy";
import type { ScopeStatus } from "./types";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { capture } }));

const ALL = [
  "Gmail",
  "Drive",
  "Calendar",
  "Docs",
  "Sheets",
  "Slides",
  "Contacts",
  "Tasks",
];

function status(grantedNames: string[]): ScopeStatus {
  const services = ALL.map((displayName) => ({
    displayName,
    iconKey: displayName.toLowerCase(),
    granted: grantedNames.includes(displayName),
  }));
  return {
    services,
    complete: grantedNames.length === ALL.length,
    missing: services
      .filter((s) => !s.granted)
      .map((s) => ({
        scope: `https://www.googleapis.com/auth/${s.iconKey}`,
        displayName: s.displayName,
      })),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  // Same flag playground-message-list.test.tsx sets: without it React warns on
  // every act() call and the warning buries a real failure.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<Parameters<typeof GrantPanel>[0]> = {}) {
  act(() => {
    root.render(
      <GrantPanel
        connectUrl="/auth/google/connect"
        service="google-workspace"
        scopeStatus={status([])}
        source="connections_page"
        {...props}
      />
    );
  });
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

describe("GrantPanel, the all-declined case", () => {
  /** THE COMMON CASE (per HQ decision, see SCRUM-106). One sentence and one
   * button. If this ever becomes eight rows, the most frequent state on the
   * surface reads as the product being broken. */
  it("renders one sentence and one control, never a chip per service", () => {
    const text = render({ scopeStatus: status([]) });
    expect(text).toContain(GRANT_NONE_GRANTED);
    expect(container.querySelectorAll("li[class*=rounded-full]")).toHaveLength(0);
    for (const name of ALL) {
      expect(text).not.toContain(`${name} `);
    }
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("offers exactly one reconnect control, not one per missing service", () => {
    render({ scopeStatus: status([]) });
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe(GRANT_RECONNECT_LABEL);
  });
});

describe("GrantPanel, the partial case", () => {
  it("names what works and what does not, each with its brand mark", () => {
    const text = render({ scopeStatus: status(["Gmail", "Drive"]) });
    expect(text).toContain("Available");
    expect(text).toContain("Not granted");
    expect(text).toContain("Gmail");
    expect(text).toContain("Calendar");

    // SCRUM-97: every service listed carries its logo. Eight services, eight
    // marks, resolved from the icon key and not from the display name.
    const marks = container.querySelectorAll("img[src^='/icons/services/']");
    expect(marks).toHaveLength(8);
    const sources = [...marks].map((m) => m.getAttribute("src"));
    expect(sources).toContain("/icons/services/gmail.svg");
    expect(sources).toContain("/icons/services/calendar.svg");
  });

  it("still offers exactly one control", () => {
    render({ scopeStatus: status(["Gmail", "Drive"]) });
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("GrantPanel, the healthy cases", () => {
  it("says nothing for a full grant next to a card that already says Connected", () => {
    const text = render({ scopeStatus: status(ALL) });
    expect(text).toBe("");
  });

  it("collapses a full grant to one line where the surface asks for it", () => {
    const text = render({
      scopeStatus: status(ALL),
      rawScopes: "https://www.googleapis.com/auth/gmail.modify",
      reassureWhenComplete: true,
    });
    expect(text).toContain(GRANT_ALL_GRANTED);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  /** SCRUM-147: "complete" for a null-scope row is fail-open POLICY, not a
   * reading of the grant. The audit surface must not turn that policy into
   * the positive claim that every service was granted — a claim nobody can
   * actually read off the row. */
  it("does not claim every service was granted when no scope record exists", () => {
    const text = render({
      scopeStatus: status(ALL),
      rawScopes: null,
      reassureWhenComplete: true,
    });
    expect(text).not.toContain(GRANT_ALL_GRANTED);
    expect(text).toContain(GRANT_UNRECORDED);
  });

  /** And the honesty line is reassure-mode only: on surfaces that say nothing
   * for a healthy row, an unreadable row stays silent too (fail-open, no
   * nagging). */
  it("stays silent for a null-scope row outside the audit surface", () => {
    const text = render({ scopeStatus: status(ALL), rawScopes: null });
    expect(text).toBe("");
  });

  it("renders nothing at all when the service is not connected", () => {
    render({ scopeStatus: undefined, isConnected: false });
    expect(container.textContent).toBe("");
  });

  /** Fail-open: an unknown grant must not nag someone whose connection works. */
  it("renders no warning for a row with no scope record", () => {
    const text = render({ scopeStatus: undefined });
    expect(text).not.toContain(GRANT_NONE_GRANTED);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});

describe("GrantPanel, scope URLs", () => {
  /** The rule the whole module exists for: a scope URL never renders until a
   * person opens the disclosure.
   *
   * ASSERTED OUTSIDE THE DISCLOSURE, DELIBERATELY. `container.textContent`
   * reaches inside a CLOSED `<details>`, because textContent knows nothing
   * about rendering, so asserting on it would fail on copy that no user can
   * see and would push the raw scopes out of the disclosure the ticket asks
   * for. What "by default" means is the always-visible half, so that is what
   * this measures. */
  it("shows no scope URL outside the disclosure", () => {
    render({
      scopeStatus: status(["Gmail"]),
      rawScopes: "https://www.googleapis.com/auth/gmail.modify openid",
    });
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("details").forEach((d) => d.remove());
    expect(clone.textContent).not.toContain("googleapis.com");
    expect(clone.textContent).not.toContain("https://");
  });

  it("keeps the disclosure closed, and puts the raw scopes inside it", () => {
    render({
      scopeStatus: status(["Gmail"]),
      rawScopes: "https://www.googleapis.com/auth/gmail.modify openid",
    });
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
    // Present in the DOM but not rendered until opened, which is what a
    // closed <details> means. The raw values live only here.
    expect(details!.textContent).toContain(
      "https://www.googleapis.com/auth/gmail.modify"
    );
  });

  /** Guards the guard: if the panel stopped rendering scopes at all,
   * the "no URL by default" assertion above would pass by failing to look. */
  it("proves the URL check can go red", () => {
    render({
      scopeStatus: status(["Gmail"]),
      rawScopes: "https://www.googleapis.com/auth/gmail.modify",
    });
    expect(container.querySelector("details")!.textContent).toContain(
      "googleapis.com"
    );
  });
});

describe("GrantPanel, the one-click fix path", () => {
  it("carries the return path so consent lands the user back where they were", () => {
    render({ scopeStatus: status([]), nextPath: "/dashboard/agent" });
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(
      "/auth/google/connect?next=%2Fdashboard%2Fagent"
    );
  });

  it("falls back to the bare connect URL with no return path", () => {
    render({ scopeStatus: status([]) });
    expect(container.querySelector("a")!.getAttribute("href")).toBe(
      "/auth/google/connect"
    );
  });

  it("offers no control when the service has no connect route", () => {
    render({ scopeStatus: status([]), connectUrl: null });
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("reports the click against the surface it happened on", () => {
    render({ scopeStatus: status([]), source: "service_detail" });
    act(() => {
      container.querySelector("a")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(capture).toHaveBeenCalledWith(
      "connect_card_clicked",
      expect.objectContaining({ source: "service_detail" })
    );
  });
});

describe("GrantPanel, compact density for the agent card", () => {
  it("drops the disclosure and the available group, keeps the control", () => {
    const text = render({
      scopeStatus: status(["Gmail", "Drive"]),
      density: "compact",
    });
    expect(container.querySelector("details")).toBeNull();
    expect(text).not.toContain("Available");
    expect(text).toContain("Not granted");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  /** SCRUM-97 again: the compact variant still lists company names, so it
   * still carries their marks. Naming them in bare prose would break the
   * standing rule on the surface it was originally raised against. */
  it("still carries a brand mark for every service it names", () => {
    render({ scopeStatus: status(["Gmail", "Drive"]), density: "compact" });
    expect(
      container.querySelectorAll("img[src^='/icons/services/']")
    ).toHaveLength(6);
  });

  it("says nothing at all for a complete grant", () => {
    render({ scopeStatus: status(ALL), density: "compact" });
    expect(container.textContent).toBe("");
  });
});
