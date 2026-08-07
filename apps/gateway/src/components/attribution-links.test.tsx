/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const getSessionId = vi.fn();
const getDistinctId = vi.fn();
const getInitialProps = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    get_session_id: () => getSessionId(),
    get_distinct_id: () => getDistinctId(),
    persistence: { get_initial_props: () => getInitialProps() },
  },
}));

import { AttributionLinks } from "./attribution-links";

function clickLink(href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = "go";
  // The decorator listens in the capture phase, so it has already rewritten
  // the href by the time this bubble-phase handler suppresses the navigation
  // jsdom cannot perform. The assertion is on the href the browser would have
  // read for that navigation.
  anchor.addEventListener("click", (e) => e.preventDefault());
  document.body.appendChild(anchor);
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return anchor;
}

function paramsOf(anchor: HTMLAnchorElement): URLSearchParams {
  return new URL(anchor.href).searchParams;
}

describe("AttributionLinks", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionId.mockReturnValue("session-1");
    getDistinctId.mockReturnValue("person-1");
    getInitialProps.mockReturnValue({
      $initial_utm_source: "google",
      $initial_utm_medium: "cpc",
      $initial_utm_campaign: "brand-us",
      $initial_gclid: "Cj0KCQ",
      $initial_referring_domain: "www.google.com",
      $initial_current_url: "https://datatorag.com/?gclid=Cj0KCQ",
    });

    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<AttributionLinks />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("appends the session id and entry snapshot to the signup link", () => {
    const params = paramsOf(clickLink("/auth/google"));
    expect(params.get("a_sid")).toBe("session-1");
    expect(params.get("a_did")).toBe("person-1");
    expect(params.get("a_utm_source")).toBe("google");
    expect(params.get("a_utm_campaign")).toBe("brand-us");
    expect(params.get("a_gclid")).toBe("Cj0KCQ");
    expect(params.get("a_ref_domain")).toBe("www.google.com");
    expect(params.get("a_entry_url")).toBe("https://datatorag.com/?gclid=Cj0KCQ");
  });

  it("covers the service-connect links too", () => {
    expect(paramsOf(clickLink("/auth/google/connect")).get("a_sid")).toBe("session-1");
    expect(paramsOf(clickLink("/auth/atlassian/connect")).get("a_sid")).toBe("session-1");
  });

  it("reads the session id at click time, not once at mount", () => {
    clickLink("/auth/google");
    // Sessions roll over on an idle timeout and at UTC midnight; a value
    // cached at mount would stamp the signup with a session that has already
    // ended, which is worse than no attribution because nothing flags it.
    getSessionId.mockReturnValue("session-2");
    expect(paramsOf(clickLink("/auth/google")).get("a_sid")).toBe("session-2");
  });

  it("leaves unrelated links alone", () => {
    const dashboard = clickLink("/dashboard");
    expect(new URL(dashboard.href).search).toBe("");
    const external = clickLink("https://example.com/pricing");
    expect(new URL(external.href).search).toBe("");
  });

  it("decorates a link clicked through a nested element", () => {
    const anchor = document.createElement("a");
    anchor.href = "/auth/google";
    anchor.addEventListener("click", (e) => e.preventDefault());
    const label = document.createElement("span");
    anchor.appendChild(label);
    document.body.appendChild(anchor);

    label.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(paramsOf(anchor).get("a_sid")).toBe("session-1");
  });

  it("does not accumulate parameters when a link is clicked twice", () => {
    const anchor = document.createElement("a");
    anchor.href = "/auth/google";
    anchor.addEventListener("click", (e) => e.preventDefault());
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(paramsOf(anchor).getAll("a_sid")).toEqual(["session-1"]);
  });

  it("leaves the link usable when the analytics SDK is blocked", () => {
    getSessionId.mockImplementation(() => {
      throw new Error("posthog not initialised");
    });
    const anchor = clickLink("/auth/google");
    expect(new URL(anchor.href).pathname).toBe("/auth/google");
    expect(new URL(anchor.href).search).toBe("");
  });

  it("omits fields the SDK has no value for", () => {
    getInitialProps.mockReturnValue({ $initial_referring_domain: "$direct" });
    const params = paramsOf(clickLink("/auth/google"));
    expect(params.get("a_utm_source")).toBeNull();
    // The sentinel rides across and the server normalises it away — the
    // client's job is to forward, not to interpret.
    expect(params.get("a_ref_domain")).toBe("$direct");
  });
});
