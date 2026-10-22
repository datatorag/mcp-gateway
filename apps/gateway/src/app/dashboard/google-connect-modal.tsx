"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CONSENT_STEPS,
  INTERSTITIAL_ANNOTATION,
  INTERSTITIAL_CTA,
  INTERSTITIAL_EXPLANATION,
  INTERSTITIAL_INSTRUCTION,
  INTERSTITIAL_TITLE,
  MODAL_DISMISS,
  SELECT_ALL_ROW,
  SELECT_ALL_STEP,
} from "@/gateway/connect-interstitial";

const CONNECT_PATH = "/auth/google/connect";

/**
 * Where Continue goes for a click on this anchor, or null when the click is
 * not one the modal takes (SCRUM-435).
 *
 * The modal takes a plain click on a same-origin link to the Google connect
 * route that has not already been through the instructions. Everything else
 * navigates as it did: a new tab or window (it gets the route-level page),
 * the proceed and refused legs, Atlassian and Notion, anything a handler
 * before this one already cancelled.
 *
 * Continue is the clicked URL with `proceed=1` added, so whatever the link
 * carried (`next`, and the attribution snapshot the capture listener in
 * `attribution-links.tsx` put on it a moment earlier) reaches the proceed
 * leg intact.
 */
export function googleConnectModalTarget(
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">,
  anchor: HTMLAnchorElement,
  origin: string
): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.target !== "" && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== CONNECT_PATH) return null;
  if (url.searchParams.has("proceed") || url.searchParams.has("refused")) return null;
  url.searchParams.set("proceed", "1");
  return `${url.pathname}${url.search}`;
}

/** The steps of Google's screen, with the mark on the Select all row. */
function ConsentSteps() {
  const r = SELECT_ALL_ROW;
  return (
    <ol className="grid gap-4 sm:grid-cols-3 sm:gap-3">
      {CONSENT_STEPS.map((step, i) => (
        <li key={step.src} className="min-w-0">
          <p className="mb-1.5 text-xs text-foreground sm:min-h-8">
            <span className="mr-1 font-semibold text-muted-foreground">{i + 1}.</span>
            {step.caption}
          </p>
          {/* Dark captures in their own dark frame, so they read the same in
              the light theme. Plain img with its intrinsic size: the box is
              reserved before the file arrives. */}
          <div className="relative overflow-hidden rounded-lg border bg-[#0e0e0e] leading-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={step.src}
              width={step.width}
              height={step.height}
              alt={step.alt}
              className="block h-auto w-full"
            />
            {i === SELECT_ALL_STEP && (
              <>
                <span
                  aria-hidden="true"
                  className="absolute rounded-md border-2 border-amber-400"
                  style={{ top: `${r.top}%`, left: `${r.left}%`, width: `${r.width}%`, height: `${r.height}%` }}
                />
                <span
                  data-select-all-mark
                  className="absolute -translate-y-1/2 whitespace-nowrap rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold leading-snug text-stone-900"
                  style={{ top: `${r.top + r.height / 2}%`, left: `${r.left + r.width + 2}%` }}
                >
                  {INTERSTITIAL_ANNOTATION}
                </span>
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The Google connect instructions as a modal over the dashboard (SCRUM-435).
 *
 * Mounted once by the dashboard layout. It listens for clicks on the
 * document instead of being wired into each connect control, the same
 * reasoning as the route-level page it stands in for: every surface that
 * links to the connect route (the connection cards, the detail page, the
 * agent's in-thread card) gets the modal without knowing it exists, and so
 * does the next one. The listener is in the bubble phase, so each surface's
 * own click handler (its connect event) has already run.
 */
export function GoogleConnectModalHost() {
  const [proceedHref, setProceedHref] = useState<string | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = googleConnectModalTarget(event, anchor, window.location.origin);
      if (!href) return;
      event.preventDefault();
      setProceedHref(href);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <Dialog open={proceedHref !== null} onOpenChange={(open) => !open && setProceedHref(null)}>
      <DialogContent
        data-google-connect-modal
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{INTERSTITIAL_TITLE}</DialogTitle>
          <DialogDescription>{INTERSTITIAL_EXPLANATION}</DialogDescription>
        </DialogHeader>
        <div className="-mx-4 overflow-y-auto px-4">
          <ConsentSteps />
          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-foreground dark:border-amber-700 dark:bg-amber-950/40">
            {INTERSTITIAL_INSTRUCTION}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setProceedHref(null)}>
            {MODAL_DISMISS}
          </Button>
          <Button render={<a href={proceedHref ?? CONNECT_PATH} />}>{INTERSTITIAL_CTA}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
