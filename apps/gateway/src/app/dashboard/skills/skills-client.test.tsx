// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const capture = vi.fn();
vi.mock("posthog-js", () => ({ default: { capture: (...a: unknown[]) => capture(...a) } }));

const { SkillsClient } = await import("./skills-client");
const { SCHEDULING_UI } = await import("./scheduling-flag");

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
    layer: "published" as const,
  },
  {
    slug: "retro-page-to-jira-tickets",
    title: "Turn a retro page into tickets",
    situation: "The retro is in Confluence.",
    produces: "Tickets.",
    services: ["atlassian"],
    layer: "published" as const,
  },
];

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}
const fetchMock = vi.fn();
const buttonNamed = (name: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === name);

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
      layer: "published",
    });
  });
});

/* SCRUM-225: schedules on the same page. A runnable skill can be scheduled
 * from its card; the Schedules section lists each schedule with its state,
 * its history, one-click pause and resume, and a delete behind a
 * confirmation. Every change goes through the API and the section re-renders
 * from the API's answer, never from an optimistic guess. */
const SCHEDULE = {
  id: "s-1",
  skillSlug: "morning-brief",
  title: "Get a morning brief",
  cadence: "daily" as const,
  hour: 7,
  minute: 0,
  weekday: null,
  timezone: "America/Los_Angeles",
  paused: false,
  pausedReason: null,
  consecutiveFailures: 0,
  lastRunAt: "2026-09-09T14:00:00.000Z",
  nextRunAt: "2026-09-10T14:00:00.000Z",
  runs: [
    {
      id: "r-1",
      status: "succeeded" as const,
      startedAt: "2026-09-09T14:00:00.000Z",
      finishedAt: "2026-09-09T14:01:00.000Z",
      threadId: "thread-1",
      delivered: "notification_email" as const,
      toolCallCount: 4,
      error: null,
    },
  ],
};

describe("schedules on the skills page (SCRUM-225)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists each schedule with its cadence, next run, state and history, and links each run to its thread", () => {
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={SKILLS} schedules={[SCHEDULE]} schedulingUi />);
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Schedules");
    expect(text).toContain("Get a morning brief");
    expect(text).toContain("Every day");
    expect(text).toContain("Active");
    expect(text).toContain("succeeded");
    const threadLink = Array.from(container.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/dashboard/agent?thread=thread-1"
    );
    expect(threadLink).toBeTruthy();
  });

  it("shows a paused schedule's reason in plain words", () => {
    act(() => {
      root.render(
        <SkillsClient
          connected={["google-workspace"]}
          skills={SKILLS}
          schedules={[{ ...SCHEDULE, paused: true, pausedReason: "reconnect" }]}
          schedulingUi
        />
      );
    });
    expect(container.textContent).toContain("Paused: reconnect needed");
  });

  it("pauses through the API and re-renders from its answer", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ schedule: { ...SCHEDULE, paused: true, pausedReason: "user" } }));
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={SKILLS} schedules={[SCHEDULE]} schedulingUi />);
    });
    await act(async () => {
      buttonNamed("Pause")!.click();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/skills/schedules/s-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ paused: true }) })
    );
    expect(container.textContent).toContain("Paused by you");
    expect(buttonNamed("Resume")).toBeTruthy();
  });

  it("deletes only after a confirmation, then removes the row", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={SKILLS} schedules={[SCHEDULE]} schedulingUi />);
    });
    // The first Delete on the page is the schedule's; the cards are published
    // and offer Fork, not Delete.
    await act(async () => {
      buttonNamed("Delete")!.click();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      buttonNamed("Yes, delete")!.click();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/skills/schedules/s-1", expect.objectContaining({ method: "DELETE" }));
    expect(container.textContent).not.toContain("Every day");
  });

  it("schedules a runnable skill from its card with the browser's zone, and the new schedule appears", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ schedule: SCHEDULE }, 201));
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={SKILLS} schedules={[]} schedulingUi />);
    });
    // Only the runnable card offers a schedule; the Atlassian card does not.
    const openers = Array.from(container.querySelectorAll("button")).filter(
      (b) => (b.textContent ?? "").trim() === "Schedule"
    );
    expect(openers).toHaveLength(1);
    await act(async () => {
      openers[0]!.click();
    });
    await act(async () => {
      buttonNamed("Save schedule")!.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/skills/schedules");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ slug: "morning-brief", cadence: "daily", timezone: expect.any(String) });
    expect(typeof body.hour).toBe("number");
    expect(container.textContent).toContain("Every day");
    expect(capture).toHaveBeenCalledWith("skill_scheduled", expect.objectContaining({ skill: "morning-brief", source: "dashboard" }));
  });

  it("shows the API's refusal instead of pretending", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not_connected", missing: ["google-workspace"] }, 409));
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={SKILLS} schedules={[]} schedulingUi />);
    });
    await act(async () => {
      buttonNamed("Schedule")!.click();
    });
    await act(async () => {
      buttonNamed("Save schedule")!.click();
    });
    expect(container.textContent).toContain("Connect Google Workspace first");
  });
});

/* SCRUM-226: a user's own skills on the same page. Every card says which
 * layer it is; a published card offers Fork; the user's own cards offer Edit
 * and Delete behind a confirmation that says, for a shadow, that the
 * published one comes back. Every change goes through the API and the page
 * re-renders from its answer. */
const PUBLISHED = { ...SKILLS[0]!, layer: "published" as const };
const MINE = {
  slug: "morning-brief",
  title: "Get a morning brief",
  situation: "Every morning I open three inboxes.",
  produces: "One brief, my way.",
  services: ["google-workspace"],
  layer: "yours" as const,
  forkedFrom: { slug: "morning-brief", version: "0123456789abcdef" },
};

describe("user-owned skills on the skills page (SCRUM-226)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says which layer each card is", () => {
    act(() => {
      root.render(
        <SkillsClient connected={["google-workspace"]} skills={[PUBLISHED, { ...SKILLS[1]!, layer: "published" }]} schedulingUi />
      );
    });
    expect(container.textContent).toContain("Published");
    expect(container.textContent).not.toContain("Your version");
    act(() => {
      root.unmount();
      root = createRoot(container);
      root.render(<SkillsClient connected={["google-workspace"]} skills={[PUBLISHED, { ...MINE, slug: "draft-sweep" }]} schedulingUi />);
    });
    expect(container.textContent).toContain("Your version");
  });

  it("forks a published skill through the API and the card becomes yours", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill: MINE }, 201));
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={[PUBLISHED]} schedulingUi />);
    });
    await act(async () => {
      buttonNamed("Fork")!.click();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/skills/fork",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ slug: "morning-brief" }) })
    );
    expect(container.textContent).toContain("Your version");
    expect(buttonNamed("Fork")).toBeUndefined();
    expect(capture).toHaveBeenCalledWith("skill_forked", expect.objectContaining({ skill: "morning-brief", source: "dashboard" }));
  });

  it("deletes a shadow only after a confirmation that says the published skill comes back", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ slug: "morning-brief", shadowed: true }));
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={[MINE]} schedulingUi />);
    });
    await act(async () => {
      buttonNamed("Delete")!.click();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("the published skill comes back");
    await act(async () => {
      buttonNamed("Yes, delete")!.click();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/skills/own/morning-brief", expect.objectContaining({ method: "DELETE" }));
    expect(container.textContent).not.toContain("Your version");
  });

  it("edits through the API and shows the saved version", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill: { ...MINE, produces: "One brief, updated." } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill: { ...MINE, produces: "One brief, updated.", source: "---\nname: morning-brief\n---\n", tools: ["gmail_list"] } }));
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={[MINE]} schedulingUi />);
    });
    await act(async () => {
      buttonNamed("Edit")!.click();
    });
    const produces = container.querySelector('textarea[name="produces"], input[name="produces"]') as HTMLInputElement;
    expect(produces).toBeTruthy();
    await act(async () => {
      buttonNamed("Save")!.click();
    });
    const call = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/skills/own/morning-brief" && (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(call).toBeTruthy();
    expect(container.textContent).toContain("One brief, updated.");
  });

  it("shows the API's refusal on a save, naming the field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill: { ...MINE, source: "---\n", tools: ["gmail_list"] } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid", field: "tools", message: "unknown tool: gmail_teleport" }, 400));
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={[MINE]} schedulingUi />);
    });
    await act(async () => {
      buttonNamed("Edit")!.click();
    });
    await act(async () => {
      buttonNamed("Save")!.click();
    });
    expect(container.textContent).toContain("unknown tool: gmail_teleport");
  });

  it("creates a new skill from the New skill form", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill: { ...MINE, slug: "draft-sweep", title: "Sweep my drafts" } }, 201));
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={[PUBLISHED]} schedulingUi />);
    });
    await act(async () => {
      buttonNamed("New skill")!.click();
    });
    await act(async () => {
      buttonNamed("Save")!.click();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/skills/own", expect.objectContaining({ method: "POST" }));
    expect(container.textContent).toContain("Sweep my drafts");
    expect(capture).toHaveBeenCalledWith("skill_created", expect.objectContaining({ skill: "draft-sweep", source: "dashboard" }));
  });
});

/* SCRUM-239: scheduling is hidden from the UI until it is designed. The
 * default render shows none of it, even with schedules present, and the
 * reveal is one constant. The backend, its routes and the 225 tests above
 * (which render with the UI revealed) are untouched. */
describe("scheduling hidden from the UI (SCRUM-239)", () => {
  it("shows no Schedule control, no Schedules section and no schedule copy by default", () => {
    act(() => {
      root.render(<SkillsClient connected={["google-workspace"]} skills={SKILLS} schedules={[SCHEDULE]} />);
    });
    const text = container.textContent ?? "";
    expect(SCHEDULING_UI).toBe(false);
    expect(text).not.toContain("Schedules");
    expect(text).not.toContain("schedule it");
    expect(text).not.toContain("Every day");
    expect(buttonNamed("Schedule")).toBeFalsy();
    // The rest of the page is intact.
    expect(text).toContain("Run one now");
    expect(text).toContain("fork a published one");
  });
});
