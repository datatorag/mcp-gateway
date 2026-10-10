// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const capture = vi.fn();
vi.mock("posthog-js", () => ({ default: { capture: (...a: unknown[]) => capture(...a) } }));

/** Who is reading: null is signed out (and "not known yet"). */
let reader: { id: string } | null = null;
vi.mock("@/lib/use-current-user", () => ({ useCurrentUser: () => reader }));

const { RunSkillCta } = await import("./run-skill-cta");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  capture.mockClear();
  reader = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* SCRUM-223: the public skill page's call to action, the campaign's landing
 * click. Per HQ decision the copy is action plus precondition, never a
 * one-click claim. SCRUM-408: a signed-in reader goes to the deep link; anyone
 * else starts Google sign-in from this button with the deep link as the
 * return path, where the middleware used to bounce them through the login
 * page. */
describe("the public page's Run CTA (SCRUM-223)", () => {
  it("for a signed-in reader, links straight to the deep link and states the precondition", () => {
    reader = { id: "user-1" };
    act(() => {
      root.render(<RunSkillCta services={["Google Workspace"]} slug="morning-brief" />);
    });
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/dashboard/agent?skill=morning-brief");
    expect(link.textContent).toContain("Run this skill");
    const text = container.textContent ?? "";
    expect(text).toContain("Sign in required");
    expect(text).toContain("Connects Google Workspace");
    expect(text).not.toContain("one click");
    // Already agreed when they signed in.
    expect(container.querySelector("[data-sign-in-consent]")).toBeNull();
  });

  it("for anyone else, starts sign-in with the deep link as the return path, and says what signing in agrees to", () => {
    act(() => {
      root.render(<RunSkillCta services={["Google Workspace"]} slug="morning-brief" />);
    });
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(
      "/auth/google?next=%2Fdashboard%2Fagent%3Fskill%3Dmorning-brief"
    );
    expect(link.dataset.cta).toBe("run_skill");
    const consent = container.querySelector("[data-sign-in-consent]")!;
    expect(consent.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(consent.querySelector('a[href="/privacy"]')).not.toBeNull();
  });

  it("reports the click with the slug", () => {
    act(() => {
      root.render(<RunSkillCta services={["Google Workspace"]} slug="morning-brief" />);
    });
    act(() => {
      container
        .querySelector("a")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(capture).toHaveBeenCalledWith("skill_run_cta_clicked", {
      skill: "morning-brief",
      source: "public_skill_page",
    });
  });
});
