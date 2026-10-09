// @vitest-environment jsdom

/**
 * A demo window shown outside the grid still says it is a replay.
 *
 * The grid's disclosure is rendered by `DemoBento`. A blog post does not use
 * `DemoBento`, so the sentence has to travel with the single window instead,
 * and the only check that means anything is the crude one
 * `demo-bento.render.test.tsx` makes: render it and look for the sentence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const { DemoEmbed, EMBEDDABLE_DEMO_IDS } = await import("./demo-embed");
const { DEMO_DISCLOSURE } = await import("./demo-bento");
const { DEMO_SCRIPTS } = await import("./demo-scripts");
const { DEMO_WINDOWS } = await import("./demo-layout");

let container: HTMLDivElement;
let root: Root;

/** A fresh root per render: one root rendering several ids in a loop would
 * reconcile rather than mount, and a later id might never really render. */
function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
  return container;
}

function unmount() {
  act(() => root.unmount());
  container.remove();
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  if (container?.isConnected) unmount();
});

describe("a demo embedded on its own", () => {
  it("can embed exactly the scripts that exist", () => {
    expect([...EMBEDDABLE_DEMO_IDS].sort()).toEqual(
      DEMO_SCRIPTS.map((s) => s.id).sort()
    );
  });

  it.each(DEMO_SCRIPTS.map((s) => s.id))(
    "%s: renders its window and the disclosure, and no route out of the post",
    (id) => {
      const el = mount(<DemoEmbed id={id} />);
      expect(el.textContent).toContain(DEMO_DISCLOSURE);
      expect(el.textContent).toContain(DEMO_WINDOWS[id].service);
      expect(el.querySelector("figure figcaption")?.textContent).toBe(DEMO_DISCLOSURE);
      // No composer link: the post carries its own call to action.
      expect(el.querySelector("a")).toBeNull();
      // And nothing a reader could type into.
      expect(el.querySelector("input, textarea")).toBeNull();
    }
  );

  it("renders nothing at all for an id that is not a script", () => {
    const el = mount(<DemoEmbed id="nope" />);
    expect(el.innerHTML).toBe("");
  });
});
