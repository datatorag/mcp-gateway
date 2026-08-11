// @vitest-environment jsdom

/**
 * Does the disclosure actually REACH THE DOM?
 *
 * demo-copy.test.ts pins the disclosure's TEXT, which catches a reword and
 * catches nothing else. Deleting the element that renders it, or wrapping it
 * in a condition, passes that test and the entire rest of the suite while
 * shipping a scripted replay with nothing marking it as scripted.
 *
 * That is not hypothetical here. The disclosure was moved inside this
 * component precisely because it once lived in a caller's subhead behind a
 * comment asking future callers to carry it, a second caller arrived, and the
 * comment was the only thing between us and presenting a recording as a live
 * session on a lead-capture page. Making it structural was the fix; this test
 * is what keeps the fix.
 *
 * So the assertion is the crude one: render the component the way each real
 * caller does, and look for the sentence in the output.
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
if (typeof Element !== "undefined" && !("getAnimations" in Element.prototype)) {
  (Element.prototype as unknown as { getAnimations: () => unknown[] }).getAnimations =
    () => [];
}

const { DemoBento, DEMO_DISCLOSURE } = await import("./demo-bento");
const { DEMO_CTA_ACTION, DEMO_CTA_SUPPORT, DEMO_HEADING, DEMO_STANDFIRST } =
  await import("./demo-copy");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactElement) {
  act(() => root.render(node));
  return container.textContent ?? "";
}

describe("the demo disclosure reaches the DOM", () => {
  it("renders for the home page shape: heading, standfirst, prompt link", () => {
    const text = render(
      <DemoBento
        heading={DEMO_HEADING}
        promptHref="/auth/login"
        promptLabel="Sign in to run your own prompt"
        standfirst={DEMO_STANDFIRST}
      />
    );
    expect(text).toContain(DEMO_DISCLOSURE);
  });

  it("renders for the lead page shape: its own heading, standfirst and CTA, no composer", () => {
    // The caller that made this structural, in its current shape: it keeps a
    // message-matched heading of its own and takes the shared standfirst and
    // CTA, but still passes no prompt, because a route out of every row is
    // what would compete with the form that page exists to collect.
    const text = render(
      <DemoBento
        ctaHref="/auth/login"
        heading="Watch Claude work inside Google Workspace"
        standfirst={DEMO_STANDFIRST}
      />
    );
    expect(text).toContain(DEMO_DISCLOSURE);
    expect(text).toContain(DEMO_STANDFIRST[0]);
    expect(text).toContain(DEMO_CTA_ACTION);
    expect(text).toContain(DEMO_CTA_SUPPORT);
  });

  it("renders no CTA at all when a caller omits the href", () => {
    // The opt-in half. A surface that wants the windows without a route off
    // the page must be able to have that, which is the state the lead page
    // was in until the CTA was deliberately added to it.
    const text = render(<DemoBento heading={DEMO_HEADING} />);
    expect(text).toContain(DEMO_DISCLOSURE);
    expect(text).not.toContain(DEMO_CTA_ACTION);
  });

  it("gives both surfaces the identical CTA, so they cannot drift apart", () => {
    const home = render(
      <DemoBento ctaHref="/dashboard" heading={DEMO_HEADING} standfirst={DEMO_STANDFIRST} />
    );
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const lead = render(
      <DemoBento
        ctaHref="/auth/login"
        heading="Watch Claude work inside Google Workspace"
        standfirst={DEMO_STANDFIRST}
      />
    );
    for (const line of [DEMO_CTA_ACTION, DEMO_CTA_SUPPORT, DEMO_DISCLOSURE, DEMO_STANDFIRST[0]]) {
      expect(home).toContain(line);
      expect(lead).toContain(line);
    }
  });

  it("renders even when a caller passes an empty standfirst", () => {
    const text = render(<DemoBento heading={DEMO_HEADING} standfirst={[]} />);
    expect(text).toContain(DEMO_DISCLOSURE);
  });

  it("puts the standfirst ABOVE the disclosure, never in place of it", () => {
    const text = render(
      <DemoBento heading={DEMO_HEADING} standfirst={DEMO_STANDFIRST} />
    );
    // Both present, and in that order. A standfirst that displaced the
    // disclosure would still satisfy a naive "contains" check on itself.
    expect(text).toContain(DEMO_STANDFIRST[0]);
    expect(text.indexOf(DEMO_STANDFIRST[0])).toBeLessThan(
      text.indexOf(DEMO_DISCLOSURE)
    );
  });
});
