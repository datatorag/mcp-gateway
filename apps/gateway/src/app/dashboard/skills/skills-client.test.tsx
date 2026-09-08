// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const capture = vi.fn();
vi.mock("posthog-js", () => ({ default: { capture: (...a: unknown[]) => capture(...a) } }));

const { SkillsClient } = await import("./skills-client");

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

/* SCRUM-223: the dashboard's skills route. It renders the catalogue the
 * public pages render, one card per skill, each with a Run link to the deep
 * link and an honest reading of what the skill needs against what this user
 * has connected. */
const SKILLS = [
  {
    slug: "morning-brief",
    title: "Get a morning brief",
    situation: "Every morning I open three inboxes.",
    produces: "One brief.",
    services: ["google-workspace"],
  },
  {
    slug: "retro-page-to-jira-tickets",
    title: "Turn a retro page into tickets",
    situation: "The retro is in Confluence.",
    produces: "Tickets.",
    services: ["atlassian"],
  },
];

describe("the dashboard skills list (SCRUM-223)", () => {
  it("renders every skill with a Run link to its deep link", () => {
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={SKILLS} />);
    });
    const links = Array.from(container.querySelectorAll("a")).filter((a) =>
      (a.getAttribute("href") ?? "").startsWith("/dashboard/agent?skill=")
    );
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard/agent?skill=morning-brief",
      "/dashboard/agent?skill=retro-page-to-jira-tickets",
    ]);
  });

  it("says what each skill needs and whether this user has it", () => {
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={SKILLS} />);
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Google Workspace connected");
    expect(text).toContain("Atlassian not connected");
    // A skill whose service is missing still runs through the same link,
    // because the agent routes to connect and continues; the button says so
    // rather than claiming one click.
    const atlassianCard = Array.from(container.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/dashboard/agent?skill=retro-page-to-jira-tickets"
    );
    expect(atlassianCard?.textContent).toContain("Connect and run");
    const googleCard = Array.from(container.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/dashboard/agent?skill=morning-brief"
    );
    expect(googleCard?.textContent).toContain("Run");
    expect(googleCard?.textContent).not.toContain("Connect and run");
  });

  it("reports the click with the slug and the source, before navigating", () => {
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={SKILLS} />);
    });
    const link = Array.from(container.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/dashboard/agent?skill=morning-brief"
    )!;
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(capture).toHaveBeenCalledWith("skill_run_clicked", {
      skill: "morning-brief",
      source: "dashboard",
      trigger: "manual",
    });
  });
});
