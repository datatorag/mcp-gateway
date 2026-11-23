// @vitest-environment jsdom

/**
 * The "Add to your agent" block (SCRUM-503): every event it sends, with its
 * placement and client, the pick it remembers, the connected marks, and the
 * address it hands out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { capture } }));

import { AddToAgent, PICK_KEY, type AddToAgentPlacement } from "./add-to-agent";
import { EVENTS } from "@/lib/analytics";
import { MCP_CLIENTS, clientConfig, clientDeepLink } from "@/lib/mcp-clients";

let container: HTMLDivElement;
let root: Root;
const clipboard = { writeText: vi.fn(async (_text: string) => {}) };
let statusBody: unknown = null;
const fetchMock = vi.fn(async (_url: unknown) => new Response(JSON.stringify(statusBody), { status: 200 }));

/** IntersectionObserver that reports what a test tells it to. */
let observed: { cb: IntersectionObserverCallback; el: Element }[] = [];
class FakeObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) {
    observed.push({ cb: this.cb, el });
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}
function scrollIntoView(on: boolean) {
  for (const { cb, el } of observed) {
    cb([{ isIntersecting: on, target: el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  }
}

const ORIGIN_URL = () => `${window.location.origin}/mcp`;

async function mount(props: Partial<Parameters<typeof AddToAgent>[0]> = {}) {
  await act(async () => {
    root.render(<AddToAgent placement={"docs" as AddToAgentPlacement} {...props} />);
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const q = (sel: string) => container.querySelector(sel);
const events = (name: string) => capture.mock.calls.filter(([n]) => n === name).map(([, props]) => props);
async function click(el: Element | null) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

beforeEach(() => {
  capture.mockReset();
  clipboard.writeText.mockReset();
  clipboard.writeText.mockImplementation(async () => {});
  fetchMock.mockClear();
  statusBody = null;
  observed = [];
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
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

describe("the events, each with its placement and client", () => {
  it("shown: once, when the block is first half on screen, with signed_in and the client it opened on", async () => {
    await mount({ placement: "blog", layout: "compact" });
    expect(events(EVENTS.ADD_TO_AGENT_SHOWN)).toEqual([]);
    scrollIntoView(false);
    expect(events(EVENTS.ADD_TO_AGENT_SHOWN)).toEqual([]);
    scrollIntoView(true);
    scrollIntoView(true);
    expect(events(EVENTS.ADD_TO_AGENT_SHOWN)).toEqual([
      { placement: "blog", client: "claude-web", signed_in: false },
    ]);
  });

  it("client picked: a different client, from the buttons; picking the same one again is not an event", async () => {
    await mount({ placement: "home", signedIn: true });
    await click(q('[data-client="claude-web"]'));
    expect(events(EVENTS.ADD_TO_AGENT_CLIENT_PICKED)).toEqual([]);
    await click(q('[data-client="claude-code"]'));
    expect(events(EVENTS.ADD_TO_AGENT_CLIENT_PICKED)).toEqual([{ placement: "home", client: "claude-code" }]);
    expect(q('[data-client="claude-code"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("client picked: from the compact menu too", async () => {
    await mount({ placement: "agent", layout: "compact", signedIn: true });
    const menu = q("[data-client-menu]") as HTMLSelectElement;
    expect(Array.from(menu.options).map((o) => o.value)).toEqual(MCP_CLIENTS.map((c) => c.id));
    await act(async () => {
      menu.value = "chatgpt";
      menu.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(events(EVENTS.ADD_TO_AGENT_CLIENT_PICKED)).toEqual([{ placement: "agent", client: "chatgpt" }]);
    expect(q("[data-step]")!.getAttribute("data-step")).toBe("chatgpt");
  });

  it("action copy: copies the client's exact config and reports it under both events", async () => {
    await mount({ placement: "site_home" });
    await click(q('[data-client="claude-code"]'));
    await click(q('[data-action="copy"]'));
    expect(clipboard.writeText).toHaveBeenCalledWith(clientConfig("claude-code", ORIGIN_URL()));
    expect(events(EVENTS.ADD_TO_AGENT_ACTION)).toEqual([
      { placement: "site_home", client: "claude-code", action: "copy" },
    ]);
    expect(events(EVENTS.COPY_MCP_CONFIG)).toEqual([{ source: "site_home_claude-code", surface: "site_home" }]);
  });

  it("action copy: a refused clipboard write is not a copy, and reports nothing", async () => {
    clipboard.writeText.mockImplementation(async () => {
      throw new Error("denied");
    });
    await mount({ placement: "docs" });
    await click(q('[data-action="copy"]'));
    expect(events(EVENTS.ADD_TO_AGENT_ACTION)).toEqual([]);
    expect(events(EVENTS.COPY_MCP_CONFIG)).toEqual([]);
  });

  it("action link: Cursor's add link carries the placement and client", async () => {
    await mount({ placement: "page" });
    await click(q('[data-client="cursor"]'));
    const link = q('[data-action="link"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(clientDeepLink("cursor", ORIGIN_URL()));
    link.addEventListener("click", (e) => e.preventDefault());
    await click(link);
    expect(events(EVENTS.ADD_TO_AGENT_ACTION)).toEqual([{ placement: "page", client: "cursor", action: "link" }]);
  });
});

describe("the step", () => {
  it("Cursor: Copy JSON leads and Add to Cursor is second, until the link is tried in a real Cursor", async () => {
    await mount();
    await click(q('[data-client="cursor"]'));
    const buttons = Array.from(container.querySelectorAll("[data-action]")).map((b) => b.getAttribute("data-action"));
    expect(buttons).toEqual(["copy", "link"]);
    expect(q('[data-action="copy"]')!.textContent).toContain("Copy JSON");
  });

  it("every other client has the one copy button, named for what it copies", async () => {
    await mount();
    for (const c of MCP_CLIENTS.filter((c) => c.id !== "cursor")) {
      await click(q(`[data-client="${c.id}"]`));
      expect(container.querySelectorAll("[data-action]").length, c.id).toBe(1);
      expect(q('[data-action="copy"]')!.textContent, c.id).toMatch(/Copy (URL|command|JSON)/);
    }
  });

  it("shows the plan note only for a client whose docs state a limit", async () => {
    await mount();
    for (const c of MCP_CLIENTS) {
      await click(q(`[data-client="${c.id}"]`));
      expect(q("[data-plan-note]")?.textContent ?? null, c.id).toBe(c.planNote ?? null);
    }
  });

  it("signed out, says the account comes when the client asks; signed in, does not", async () => {
    await mount({ signedIn: false });
    expect(q("[data-signed-out]")?.textContent).toMatch(/No account needed first/);
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(container);
    statusBody = { agentClientNames: [] };
    await mount({ signedIn: true });
    expect(q("[data-signed-out]")).toBeNull();
  });

  it("Other MCP client shows the address and the generic JSON", async () => {
    await mount();
    await click(q('[data-client="other"]'));
    const blocks = Array.from(container.querySelectorAll("pre")).map((p) => p.textContent);
    expect(blocks[0]).toBe(ORIGIN_URL());
    expect(JSON.parse(blocks[1]!)).toEqual({ mcpServers: { datatorag: { url: ORIGIN_URL() } } });
  });

  it("the server's HTML carries the production address, before the browser corrects it for its origin", () => {
    const html = renderToStaticMarkup(<AddToAgent placement="docs" />);
    expect(html).toContain(">https://datatorag.com/mcp<");
    expect(html).not.toMatch(/localhost|example\.test/);
  });
});

describe("the pick", () => {
  it("is remembered in this browser and restored on the next page", async () => {
    await mount({ placement: "home", signedIn: true });
    await click(q('[data-client="codex"]'));
    expect(localStorage.getItem(PICK_KEY)).toBe("codex");
    act(() => root.unmount());
    root = createRoot(container);
    await mount({ placement: "blog" });
    expect(q('[aria-pressed="true"]')!.getAttribute("data-client")).toBe("codex");
    // Restoring is not a pick.
    expect(events(EVENTS.ADD_TO_AGENT_CLIENT_PICKED)).toEqual([{ placement: "home", client: "codex" }]);
  });

  it("a client named in the URL wins: ?client= and the old #<client> links", async () => {
    localStorage.setItem(PICK_KEY, "codex");
    window.history.replaceState(null, "", "/add-to-your-agent?client=chatgpt");
    await mount({ placement: "page" });
    expect(q('[aria-pressed="true"]')!.getAttribute("data-client")).toBe("chatgpt");
    act(() => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, "", "/dashboard#cursor");
    await mount({ placement: "home" });
    expect(q('[aria-pressed="true"]')!.getAttribute("data-client")).toBe("cursor");
  });

  it("a hash that is not a client does not hide ?client= (a tracking fragment on an email link)", async () => {
    localStorage.setItem(PICK_KEY, "codex");
    window.history.replaceState(null, "", "/add-to-your-agent?client=cursor#utm");
    await mount({ placement: "page" });
    expect(q('[aria-pressed="true"]')!.getAttribute("data-client")).toBe("cursor");
  });

  it("ignores a stored or linked value that is not a client", async () => {
    localStorage.setItem(PICK_KEY, "__proto__");
    window.history.replaceState(null, "", "/?client=constructor");
    await mount();
    expect(q('[aria-pressed="true"]')!.getAttribute("data-client")).toBe("claude-web");
  });
});

describe("connected marks", () => {
  it("signed in, marks the clients holding a live token, from the live status", async () => {
    statusBody = { agentClientNames: ["Claude", "Cursor"] };
    await mount({ placement: "home", signedIn: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/setup/status");
    const marked = MCP_CLIENTS.filter((c) => q(`[data-client="${c.id}"] [aria-label="connected"]`)).map((c) => c.id);
    expect(marked).toEqual(["claude-web", "claude-desktop", "cursor"]);
    expect(q("[data-connected]")?.textContent).toContain("Claude has signed in to DataToRAG");
    await click(q('[data-client="codex"]'));
    expect(q("[data-connected]")).toBeNull();
  });

  it("claims nothing when the status cannot be read", async () => {
    // A refusal with a body that WOULD mark Claude: only the status check
    // keeps the marks off.
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ agentClientNames: ["Claude"] }), { status: 401 })
    );
    await mount({ placement: "home", signedIn: true });
    expect(q('[aria-label="connected"]')).toBeNull();
  });
});
