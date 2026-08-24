// @vitest-environment jsdom

/**
 * SCRUM-147: the control that changes which account every unqualified tool
 * call runs as. The three behaviours that must hold: nothing is written until
 * the user confirms a step that names the consequence; a failed write says so
 * instead of pretending; cancel really is a no-op.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { SetDefaultControl } from "./default-control";
import {
  SET_DEFAULT_CANCEL_LABEL,
  SET_DEFAULT_CONFIRM_LABEL,
  SET_DEFAULT_CONSEQUENCE,
  SET_DEFAULT_ERROR,
  SET_DEFAULT_LABEL,
  setDefaultConfirm,
} from "./grant-copy";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { capture } }));

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const onChanged = vi.fn(async () => undefined);

function render(props: Partial<Parameters<typeof SetDefaultControl>[0]> = {}) {
  act(() => {
    root.render(
      <SetDefaultControl
        accountId="acct-1"
        accountEmail="target@example.com"
        onChanged={onChanged}
        {...props}
      />
    );
  });
}

function buttonWith(text: string): HTMLButtonElement {
  const hit = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text
  );
  expect(hit, `button "${text}"`).toBeTruthy();
  return hit as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("SetDefaultControl", () => {
  it("writes nothing until the consequence has been shown and confirmed", async () => {
    render();
    expect(container.textContent).toContain(SET_DEFAULT_LABEL);
    expect(container.textContent).not.toContain(SET_DEFAULT_CONSEQUENCE);

    await click(buttonWith(SET_DEFAULT_LABEL));

    // The confirmation names the account and what the change means.
    expect(container.textContent).toContain(
      setDefaultConfirm("target@example.com")
    );
    expect(container.textContent).toContain(SET_DEFAULT_CONSEQUENCE);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ ok: true });
    await click(buttonWith(SET_DEFAULT_CONFIRM_LABEL));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/connections");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      accountId: "acct-1",
      setDefault: true,
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("cancel is a real no-op", async () => {
    render();
    await click(buttonWith(SET_DEFAULT_LABEL));
    await click(buttonWith(SET_DEFAULT_CANCEL_LABEL));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(SET_DEFAULT_CONSEQUENCE);
  });

  it("a failed write says so and does not report success", async () => {
    render();
    await click(buttonWith(SET_DEFAULT_LABEL));
    fetchMock.mockResolvedValue({ ok: false });
    await click(buttonWith(SET_DEFAULT_CONFIRM_LABEL));

    expect(container.textContent).toContain(SET_DEFAULT_ERROR);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a rejected fetch is handled the same way, never thrown to React", async () => {
    render();
    await click(buttonWith(SET_DEFAULT_LABEL));
    fetchMock.mockRejectedValue(new Error("offline"));
    await click(buttonWith(SET_DEFAULT_CONFIRM_LABEL));

    expect(container.textContent).toContain(SET_DEFAULT_ERROR);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("an overriding label still confirms before writing", async () => {
    render({ label: "Make it the default" });
    await click(buttonWith("Make it the default"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(SET_DEFAULT_CONSEQUENCE);
  });
});
