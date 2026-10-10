// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("posthog-js", () => ({
  default: { captureException: vi.fn() },
}));
import posthog from "posthog-js";

import DashboardError from "./error";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.mocked(posthog.captureException).mockClear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the dashboard's error page", () => {
  it("says what happened, offers a retry, and reports the error", () => {
    const error = new Error("boom");
    const reset = vi.fn();
    act(() => root.render(<DashboardError error={error} reset={reset} />));

    const card = container.querySelector('[data-testid="dashboard-error"]');
    expect(card?.textContent).toContain("This page hit an error.");
    // The error's own text is for the report, never for the page.
    expect(card?.textContent).not.toContain("boom");
    expect(card?.textContent).not.toContain(String.fromCharCode(0x2014));

    const retry = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Try again"
    );
    act(() => retry?.click());
    expect(reset).toHaveBeenCalledTimes(1);

    expect(posthog.captureException).toHaveBeenCalledWith(error, { boundary: "dashboard" });
  });
});
