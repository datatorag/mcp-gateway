// @vitest-environment jsdom

/**
 * SCRUM-149: the dashboard's rendering of a refused zero-grant connect. The
 * property that matters: the refusal is SEEN (with a retry path), other codes
 * change nothing here, and the params never survive into a reload.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ConnectOutcomeNotice } from "./connect-outcome-notice";
import {
  CONNECT_RETRY_LABEL,
  CONNECT_ZERO_GRANT_NOTICE,
} from "./agent-connect-copy";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, "", "/");
});

function renderAt(url: string) {
  window.history.replaceState(null, "", url);
  act(() => {
    root.render(<ConnectOutcomeNotice />);
  });
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

describe("ConnectOutcomeNotice", () => {
  it("shows the zero-grant notice with a retry control, then strips the param", () => {
    const text = renderAt("/dashboard?connect_error=no_services_granted");
    expect(text).toContain(CONNECT_ZERO_GRANT_NOTICE);
    const retry = container.querySelector("a");
    expect(retry?.textContent).toBe(CONNECT_RETRY_LABEL);
    expect(retry?.getAttribute("href")).toBe("/auth/google/connect");
    // One-shot: a reload or shared URL must not resurrect the banner.
    expect(window.location.search).toBe("");
  });

  it("reads the legacy error spelling from the fallback leg too", () => {
    const text = renderAt("/dashboard?error=no_services_granted");
    expect(text).toContain(CONNECT_ZERO_GRANT_NOTICE);
    expect(window.location.search).toBe("");
  });

  it("renders nothing for other codes and leaves unrelated params alone", () => {
    const text = renderAt("/dashboard?connect_error=missing_code&tab=usage");
    expect(text).toBe("");
    // The outcome param is still consumed; the unrelated one survives.
    expect(window.location.search).toBe("?tab=usage");
  });

  it("renders nothing with no params at all", () => {
    expect(renderAt("/dashboard")).toBe("");
  });
});
