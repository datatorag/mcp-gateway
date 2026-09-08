// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const capture = vi.fn();
vi.mock("posthog-js", () => ({ default: { capture: (...a: unknown[]) => capture(...a) } }));

const { RunSkillCta } = await import("./run-skill-cta");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  capture.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* SCRUM-223: the public skill page's call to action, the campaign's landing
 * click. Per HQ decision the copy is action plus precondition, never a
 * one-click claim, and the link is the deep link itself: a signed-in reader
 * lands on the agent directly, a signed-out one is bounced to login by the
 * middleware with the slug intact. */
describe("the public page's Run CTA (SCRUM-223)", () => {
  it("links straight to the deep link and states the precondition", () => {
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
