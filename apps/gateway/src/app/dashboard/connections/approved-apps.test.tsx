// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { translatePage } from "@/test-utils/translate-page";

/**
 * "Apps you approved" on the Connections page. An app's name is whatever the
 * app registered with, so it is shown as text and never as markup; Remove
 * asks first, then removes and reads the list again.
 */

import { ApprovedApps } from "./approved-apps";
import * as COPY from "./approved-apps-copy";

type App = {
  clientId: string;
  name: string | null;
  redirectHosts: string[];
  approvedAt: string | null;
  lastTokenAt: string | null;
};

const CLAUDE: App = {
  clientId: "6b1f0c1e-3c1b-4a53-9a55-0d9a2f6f7f10",
  name: "Claude",
  redirectHosts: ["claude.ai"],
  approvedAt: "2026-11-03T18:00:00.000Z",
  lastTokenAt: "2026-11-20T18:00:00.000Z",
};
const HOSTILE: App = {
  clientId: "0d9a2f6f-3c1b-4a53-9a55-6b1f0c1e7f10",
  name: '<img src=x onerror="window.pwned=1"><b>Claude</b>',
  redirectHosts: ["evil.example.net"],
  approvedAt: null,
  lastTokenAt: "2026-11-21T18:00:00.000Z",
};

let apps: App[];
let deleteStatus = 200;
const calls: Array<{ url: string; method: string }> = [];
let container: HTMLDivElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  await act(async () => {
    root.render(<ApprovedApps />);
  });
  await settle();
}

const rows = () => Array.from(container.querySelectorAll("[data-approved-app]"));
const button = (within: Element, label: string) =>
  Array.from(within.querySelectorAll("button")).find((b) => b.textContent === label);
async function click(el: Element | undefined) {
  expect(el).toBeDefined();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  apps = [CLAUDE];
  deleteStatus = 200;
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method });
      if (method === "DELETE") {
        if (deleteStatus === 200) {
          const id = new URL(String(url), "http://localhost").searchParams.get("clientId");
          apps = apps.filter((a) => a.clientId !== id);
        }
        return new Response(JSON.stringify({ ok: deleteStatus === 200 }), { status: deleteStatus });
      }
      return new Response(JSON.stringify({ apps }), { status: 200 });
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

describe("Apps you approved", () => {
  it("has a plain heading and one sentence saying what Remove does", async () => {
    await render();
    expect(container.querySelector("h2")?.textContent).toBe("Apps you approved");
    expect(container.textContent).toContain(COPY.APPROVED_APPS_INTRO);
    expect(COPY.APPROVED_APPS_INTRO).toContain("can no longer use DataToRAG as you until you add it again and approve it");
  });

  it("shows each app's name, host, approval date, and last token date, with a Remove button", async () => {
    await render();
    const [row] = rows();
    expect(row.querySelector("[data-approved-app-name]")?.textContent).toBe("Claude");
    expect(row.textContent).toContain("claude.ai");
    expect(row.textContent).toContain(COPY.approvedOn(CLAUDE.approvedAt));
    expect(row.textContent).toContain(COPY.lastTokenOn(CLAUDE.lastTokenAt));
    expect(COPY.approvedOn(CLAUDE.approvedAt)).toMatch(/^Approved Nov \d+, 2026$/);
    expect(button(row, COPY.REMOVE_LABEL)).toBeDefined();
  });

  it("renders a name as text, never as markup, and says the app gave it", async () => {
    apps = [HOSTILE];
    await render();
    const [row] = rows();
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("b")).toBeNull();
    expect(row.querySelector("[data-approved-app-name]")?.textContent).toBe(HOSTILE.name);
    expect((window as { pwned?: number }).pwned).toBeUndefined();
    expect(row.textContent).toContain(COPY.NAME_UNVERIFIED);
    // No approval row: an older registration, said plainly.
    expect(row.textContent).toContain(COPY.approvedOn(null));
  });

  it("an app that gave no name is shown as one, and two apps with one name are two rows", async () => {
    apps = [{ ...CLAUDE, name: null }, { ...HOSTILE, name: "Claude" }, CLAUDE];
    await render();
    expect(rows()).toHaveLength(3);
    expect(rows()[0].querySelector("[data-approved-app-name]")?.textContent).toBe(COPY.UNNAMED_APP);
    expect(rows()[1].textContent).toContain("evil.example.net");
    expect(rows()[2].textContent).toContain("claude.ai");
  });

  it("says so when there are none", async () => {
    apps = [];
    await render();
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain(COPY.APPROVED_APPS_EMPTY);
  });

  it("Remove asks first: nothing is sent until the confirmation, and Cancel sends nothing", async () => {
    await render();
    await click(button(rows()[0], COPY.REMOVE_LABEL));
    expect(rows()[0].textContent).toContain(COPY.removeConfirm("Claude"));
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);

    await click(button(rows()[0], COPY.REMOVE_CANCEL_LABEL));
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(button(rows()[0], COPY.REMOVE_LABEL)).toBeDefined();
  });

  it("confirming removes that client id and reads the list again, on a translated page too", async () => {
    apps = [CLAUDE, HOSTILE];
    await render();
    expect(translatePage(container)).toBeGreaterThan(0);
    const remove = Array.from(rows()[0].querySelectorAll("button")).at(-1);
    await click(remove);
    translatePage(container);
    const confirm = Array.from(rows()[0].querySelectorAll("button")).at(0);
    await click(confirm);

    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes).toEqual([{ url: `/api/approved-apps?clientId=${CLAUDE.clientId}`, method: "DELETE" }]);
    expect(calls.at(-1)).toEqual({ url: "/api/approved-apps", method: "GET" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("evil.example.net");
  });

  it("a failed removal says so and keeps the row", async () => {
    deleteStatus = 500;
    await render();
    await click(button(rows()[0], COPY.REMOVE_LABEL));
    await click(button(rows()[0], COPY.REMOVE_CONFIRM_LABEL));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain(COPY.REMOVE_ERROR);
  });
});

describe("the section's words", () => {
  const strings = [
    COPY.APPROVED_APPS_TITLE,
    COPY.APPROVED_APPS_INTRO,
    COPY.APPROVED_APPS_EMPTY,
    COPY.APPROVED_APPS_UNAVAILABLE,
    COPY.NAME_UNVERIFIED,
    COPY.UNNAMED_APP,
    COPY.REMOVE_LABEL,
    COPY.REMOVE_CONFIRM_LABEL,
    COPY.REMOVE_CANCEL_LABEL,
    COPY.REMOVE_ERROR,
    COPY.removeConfirm("Claude"),
    COPY.sendsTo(["claude.ai", "localhost"]),
    COPY.approvedOn(null),
    COPY.approvedOn(CLAUDE.approvedAt),
    COPY.lastTokenOn(null),
    COPY.lastTokenOn(CLAUDE.lastTokenAt),
  ];

  it("carry no em or en dash, and call nothing an assistant", () => {
    for (const s of strings) {
      // House style: a dash of either kind is the strongest tell of
      // generated copy, and "assistant" is not what we call an agent.
      expect(s, s).not.toMatch(/[\u2013\u2014]|&mdash;|&ndash;/);
      expect(s.toLowerCase(), s).not.toContain("assistant");
    }
  });
});
