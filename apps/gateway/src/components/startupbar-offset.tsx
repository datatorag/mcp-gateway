"use client";

import { useEffect } from "react";

/** Keeps the page clear of the StartupBar widget's injected top bar.
 *
 * The widget appends a fixed, full-width iframe at top:0 and compensates
 * with a hardcoded 36px — one body-padding write and a one-time shift of
 * fixed elements. But the bar resizes itself (its text wraps on narrow
 * screens, announced via a postMessage the hardcoded shift never hears),
 * so on mobile it grows past 36px and sits on top of the navbar.
 *
 * On iPhone Safari the widget uses a different variant — a STATIC iframe
 * inserted as the body's first child, with no fixed-element shift at all —
 * so the fixed navbar lands directly on top of the bar. That is the
 * mobile overlap as reported.
 *
 * This keys every offset off the iframe's REAL rendered geometry instead:
 * fixed variant → navbar top, body padding and scroll padding track its
 * height; static variant → the navbar tracks the bar's visible remainder
 * as it scrolls away (flow already spaces the content). When the bar is
 * absent — slow or blocked — nothing is applied, so there is never a blank
 * reserved gap. Rendered only by the landing page, which is the only page
 * that loads the widget.
 *
 * On unmount only the observers disconnect; the last-applied offsets stay,
 * because the injected iframe itself survives client-side navigation and
 * removing the padding under a still-visible bar would recreate the
 * overlap elsewhere.
 */
export function StartupBarOffset() {
  useEffect(() => {
    let iframe: HTMLIFrameElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let giveUp: ReturnType<typeof setTimeout> | null = null;

    const apply = (headerTop: number, pagePad: number) => {
      document.body.style.paddingTop = pagePad ? `${pagePad}px` : "";
      document.documentElement.style.scrollPaddingTop = pagePad
        ? `${pagePad}px`
        : "";
      const header = document.querySelector<HTMLElement>("header.fixed");
      if (header) header.style.top = headerTop ? `${headerTop}px` : "";
    };

    const sync = () => {
      if (!iframe || !iframe.isConnected) return;
      const rect = iframe.getBoundingClientRect();
      if (getComputedStyle(iframe).position === "fixed") {
        apply(rect.height, rect.height);
      } else {
        // Static variant: in-flow, so the page needs no padding, and the
        // navbar only needs to clear whatever part of the bar is still on
        // screen (its bottom edge, clamped at 0 once scrolled past).
        apply(Math.max(0, rect.bottom), 0);
      }
    };

    const attach = (): boolean => {
      iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[src^="https://startupbar.co/widget/bar"]'
      );
      if (!iframe) return false;
      resizeObserver = new ResizeObserver(sync);
      resizeObserver.observe(iframe);
      window.addEventListener("scroll", sync, { passive: true });
      sync();
      return true;
    };

    // The widget loads afterInteractive and may be slow or blocked entirely:
    // watch the DOM for it for a while, then stop quietly.
    if (!attach()) {
      mutationObserver = new MutationObserver(() => {
        if (attach()) {
          mutationObserver?.disconnect();
          mutationObserver = null;
        }
      });
      mutationObserver.observe(document.body, { childList: true });
      giveUp = setTimeout(() => {
        mutationObserver?.disconnect();
        mutationObserver = null;
      }, 20000);
    }

    return () => {
      if (giveUp) clearTimeout(giveUp);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", sync);
    };
  }, []);

  return null;
}
