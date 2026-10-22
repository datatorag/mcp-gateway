// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { resetCurrentUserForTests } from "@/lib/use-current-user";
import {
  CONNECT_HELPER_DISMISS,
  CONNECT_HELPER_TEXT,
  ConnectHelper,
  NOTION_CONNECT_HELPER_TEXT,
  NotionConnectHelper,
} from "./connect-helper";
import { ConnectPart } from "./agent-parts";

let container: HTMLDivElement;
let root: Root;
/** What /api/me answers; null is a signed-out 401. */
let me: Record<string, unknown> | null;
let posts: string[];
let postFails: boolean;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const note = () => container.querySelector("[data-connect-helper]");
const USER = { id: "user-1", email: "a@example.com", name: null, avatarUrl: null };
const GOOGLE = { id: "google-workspace", name: "Google Workspace", connectHref: "/auth/google/connect" };
const ATLASSIAN = { id: "atlassian", name: "Atlassian", connectHref: "/auth/atlassian/connect" };
const NOTION = { id: "notion", name: "Notion", connectHref: "/auth/notion/connect" };

beforeEach(() => {
  resetCurrentUserForTests();
  me = { ...USER, connectHelperDismissed: false };
  posts = [];
  postFails = false;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (init?.method === "POST") {
        posts.push(target);
        return postFails ? Promise.reject(new Error("offline")) : Promise.resolve(new Response("{}", { status: 200 }));
      }
      if (target.includes("/api/me")) {
        return Promise.resolve(
          me === null
            ? new Response("{}", { status: 401 })
            : new Response(JSON.stringify({ user: me }), { status: 200 })
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    })
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the note under a Google connect button (SCRUM-410)", () => {
  it("says what the button opens, what to do there, and the way out", async () => {
    act(() => root.render(<ConnectHelper />));
    await settle();
    expect(note()?.textContent).toContain(CONNECT_HELPER_TEXT);
    expect(CONNECT_HELPER_TEXT).toBe(
      "Opens Google. Tick every box on the consent screen so the agent can read and write for you. Disconnect any time."
    );
    expect(CONNECT_HELPER_TEXT).not.toContain(String.fromCharCode(0x2014));
  });

  it("is not there for a user who dismissed it, and never flashes in while that is unknown", async () => {
    me = { ...USER, connectHelperDismissed: true };
    act(() => root.render(<ConnectHelper />));
    // Before the user is known: nothing.
    expect(note()).toBeNull();
    await settle();
    expect(note()).toBeNull();
  });

  it("hides at once when dismissed, and tells the server", async () => {
    act(() => root.render(<ConnectHelper />));
    await settle();
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe(CONNECT_HELPER_DISMISS);

    act(() => button.click());
    expect(note()).toBeNull();
    await settle();
    expect(posts).toEqual(["/api/me/connect-helper"]);
  });

  it("dismissing one hides every copy on the page", async () => {
    act(() =>
      root.render(
        <div>
          <ConnectHelper />
          <ConnectHelper />
        </div>
      )
    );
    await settle();
    expect(container.querySelectorAll("[data-connect-helper]")).toHaveLength(2);
    act(() => container.querySelector("button")!.click());
    expect(container.querySelectorAll("[data-connect-helper]")).toHaveLength(0);
  });

  it("stays hidden for this visit even if the request to record it fails", async () => {
    postFails = true;
    act(() => root.render(<ConnectHelper />));
    await settle();
    act(() => container.querySelector("button")!.click());
    await settle();
    expect(note()).toBeNull();
  });

  it("is not shown to someone who is not signed in", async () => {
    me = null;
    act(() => root.render(<ConnectHelper />));
    await settle();
    expect(note()).toBeNull();
  });
});

describe("where the note appears on the connect card", () => {
  it("under a card that offers Google", async () => {
    act(() => root.render(<ConnectPart services={[GOOGLE, ATLASSIAN]} />));
    await settle();
    expect(note()).not.toBeNull();
    // Below the buttons, not between them.
    const lastButton = Array.from(container.querySelectorAll("a")).pop()!;
    expect(lastButton.compareDocumentPosition(note()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("not under a card that offers only another connector: it is about Google's screen", async () => {
    act(() => root.render(<ConnectPart services={[ATLASSIAN]} />));
    await settle();
    expect(note()).toBeNull();
  });
});

describe("the note under a Notion connect button (SCRUM-436)", () => {
  const notionNote = () => container.querySelector("[data-notion-connect-helper]");

  it("says Notion asks for the workspace, and how to use another login", () => {
    act(() => root.render(<NotionConnectHelper />));
    expect(notionNote()?.textContent).toBe(NOTION_CONNECT_HELPER_TEXT);
    expect(NOTION_CONNECT_HELPER_TEXT).toBe(
      "Notion asks which workspace to connect. To use a different Notion login, log out on Notion's page first."
    );
    expect(NOTION_CONNECT_HELPER_TEXT).not.toContain(String.fromCharCode(0x2014));
    expect(NOTION_CONNECT_HELPER_TEXT).not.toMatch(/\d/);
  });

  it("has no dismiss control and stores nothing: it is not the Google note's preference", async () => {
    act(() => root.render(<NotionConnectHelper />));
    await settle();
    expect(notionNote()!.querySelector("button")).toBeNull();
    expect(posts).toEqual([]);
  });

  it("is under the agent's connect card when it offers Notion, below the buttons", async () => {
    act(() => root.render(<ConnectPart services={[GOOGLE, NOTION]} />));
    await settle();
    const lastButton = Array.from(container.querySelectorAll("a")).pop()!;
    expect(lastButton.compareDocumentPosition(notionNote()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Google's own note is still there, for Google's button.
    expect(note()).not.toBeNull();
  });

  it("is not under a card that offers only Atlassian or only Google", async () => {
    act(() => root.render(<ConnectPart services={[ATLASSIAN]} />));
    await settle();
    expect(notionNote()).toBeNull();
    act(() => root.render(<ConnectPart services={[GOOGLE]} />));
    await settle();
    expect(notionNote()).toBeNull();
  });
});
