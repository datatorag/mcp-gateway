"use client";

import { useEffect, type RefObject } from "react";

/**
 * Size an element to the viewport space REMAINING BELOW whatever sits above it.
 *
 * WHY THIS IS NOT JUST `h-dvh`. A full-height shell written as `100dvh`
 * assumes it starts at the top of the viewport. When anything pushes it down,
 * the shell keeps its full viewport height and its BOTTOM goes off-screen by
 * exactly the amount it was pushed — so the thing anchored to the bottom, a
 * chat composer in our case, is the part that disappears. Measured on
 * production: shell top 36, height 1000, bottom 1036 in a 1000px viewport,
 * composer clipped, and the page able to scroll by exactly 36.
 *
 * WHAT PUSHES IT DOWN HERE. The marketing page loads a third-party badge
 * widget that injects a fixed bar and compensates with `body { padding-top }`.
 * Both the bar and the padding deliberately SURVIVE client-side navigation —
 * removing the padding under a still-visible bar would just move the overlap
 * elsewhere — so a visitor who arrives from the marketing site carries the
 * offset into the app. A direct load has neither and is unaffected, which is
 * why this reproduces only on the path a real visitor takes.
 *
 * WHY IT MEASURES RATHER THAN SUBTRACTING A KNOWN VALUE. The offset is not one
 * number and not always body padding: that widget has a second variant, used
 * on iOS Safari, which inserts the bar IN FLOW with no padding at all. A fix
 * keyed to `padding-top` would work on one variant and silently not the other.
 * Reading the element's own top edge covers both, and covers whatever gets
 * added above the app next, without knowing anything about it.
 *
 * THE OBSERVERS ARE THE POINT, not defensive garnish. Third-party chrome
 * arrives late: a measurement taken before the node exists and has real height
 * reads a page the offender has not reached yet, and reports a clean result
 * that is about a different page than the one the user ends up looking at. So
 * this re-measures when the body's children change (the in-flow variant
 * appearing), when its style attribute changes (the padding write), when the
 * body resizes, and on viewport resize.
 */
export function useFitBelowTopChrome(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    let frame = 0;

    const measure = () => {
      // Distance from the top of the DOCUMENT, so a scrolled page cannot make
      // the reading drift. Once the fit is correct the page will not scroll,
      // but it can be scrolled at the moment this first runs.
      const top = el.getBoundingClientRect().top + window.scrollY;
      const fits = Math.max(0, window.innerHeight - top);
      // Only write when it actually changes: an unconditional style write
      // inside a ResizeObserver on an ancestor is a feedback loop.
      const next = `${fits}px`;
      if (el.style.height !== next) el.style.height = next;
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    schedule();
    window.addEventListener("resize", schedule);

    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);

    const mutate = new MutationObserver(schedule);
    mutate.observe(document.body, {
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      resize.disconnect();
      mutate.disconnect();
      // Hand the element back the way it was found, so a route change out of
      // the full-height mode does not leave a pinned pixel height behind.
      el.style.height = "";
    };
  }, [ref, enabled]);
}
