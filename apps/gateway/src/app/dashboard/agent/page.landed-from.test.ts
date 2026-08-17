/**
 * The landing cohort survives the route change.
 *
 * `agent_default_view_shown` used to mean "a new user landed on the Agent"
 * purely because a signup was the only thing routed here. Now that a returning
 * login lands here too, the only thing keeping those two apart is the
 * `landed_from` property, and the only thing feeding it is this mapping from
 * the redirect's query params. Nothing fails if it regresses - the event keeps
 * arriving, just answering a different question - so it gets its own test.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn(async () => "user-1") }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirected");
  }),
}));
// The real client pulls in the whole chat surface; only the props matter here.
vi.mock("./agent-client", () => ({ AgentClient: () => null }));

import AgentPage from "./page";

async function render(searchParams: {
  welcome?: string;
  signup?: string;
  thread?: string;
  connected?: string;
  connect_error?: string;
}) {
  const element = (await AgentPage({
    searchParams: Promise.resolve(searchParams),
  })) as {
    props: {
      isDefaultView: boolean;
      landedFrom: string;
      resumeThreadId: string | null;
      connectedService: string | null;
      connectError: string | null;
    };
  };
  return element.props;
}

/** The connect-return props in their resting state, so the landing tests can
 * keep asserting the WHOLE prop object and notice an accidental addition. */
const NO_CONNECT_RETURN = {
  resumeThreadId: null,
  connectedService: null,
  connectError: null,
  // A plain landing seeds nothing (SCRUM-118); the seeding contract itself
  // is pinned in page.seed-prompt.test.ts.
  seedPrompt: null,
};

describe("agent page landing props", () => {
  it("marks the signup landing as landed_from=signup", async () => {
    expect(await render({ welcome: "1", signup: "1" })).toEqual({
      isDefaultView: true,
      landedFrom: "signup",
      ...NO_CONNECT_RETURN,
    });
  });

  it("marks a returning user's landing as landed_from=login", async () => {
    expect(await render({ welcome: "1" })).toEqual({
      isDefaultView: true,
      landedFrom: "login",
      ...NO_CONNECT_RETURN,
    });
  });

  it("fires no landing event when the route was navigated to rather than landed on", async () => {
    expect((await render({})).isDefaultView).toBe(false);
  });

  it("passes the connect round trip's return leg through (SCRUM-78)", async () => {
    expect(
      await render({ thread: "t-1", connected: "google-workspace" })
    ).toMatchObject({
      resumeThreadId: "t-1",
      connectedService: "google-workspace",
      connectError: null,
    });
    expect(await render({ thread: "t-1", connect_error: "missing_code" })).toMatchObject({
      resumeThreadId: "t-1",
      connectedService: null,
      connectError: "missing_code",
    });
    // Empty strings degrade to a normal landing rather than a phantom resume.
    expect(await render({ thread: "", connected: "" })).toMatchObject(NO_CONNECT_RETURN);
  });
});
