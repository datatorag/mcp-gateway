/**
 * The instruction page before the handoff to Google (SCRUM-150).
 *
 * The consent failure it exists to prevent happens on Google's screen, where
 * we control neither layout, defaults, nor copy: granular consent brings the
 * service checkboxes up UNTICKED, and the Continue gesture that sign-in just
 * taught the user grants zero services (the state SCRUM-149 refuses to
 * record). The moment before the redirect is the only lever we hold, so it is
 * held at the CHOKE POINT — the `/auth/google/connect` route itself — rather
 * than on the controls that link to it. Every surface that offers a connect
 * (dashboard cards, the detail page, the agent's in-thread card, docs links)
 * passes through here without knowing the interstitial exists, including the
 * retry path a refused zero-grant connect lands on.
 *
 * Served by Express, so the styling is self-contained: light and dark via
 * prefers-color-scheme, system fonts, no dependency on the Next bundle.
 *
 * SCRUM-435 supersedes this page's original choice of a schematic drawing
 * over a screenshot. The steps are now real captures of Google's screen
 * (cropped, the account address and the grant's expiry date redacted),
 * because the real screen teaches better than a drawing of it, and a
 * capture that ages is drift we accept: when
 * Google repaints, the captures are retaken. They are dark-mode captures
 * shown inside their own dark frame, so they read the same on a light page.
 * On the dashboard the same steps open as a modal over the page the connect
 * started from (`google-connect-modal.tsx`); this route-level page stays as
 * the fallback for every entry outside the dashboard and for the refused
 * retry, so the choke point still holds there.
 *
 * Atlassian deliberately has no interstitial: its consent screen has no
 * per-scope opt-out, so there is nothing to teach.
 */

/** Copy as constants so the mechanical rules (no em-dashes, no scope URLs,
 * no counts) can be asserted rather than remembered. */
export const INTERSTITIAL_TITLE = "One thing before Google's screen";
export const INTERSTITIAL_EXPLANATION =
  "Google will now ask which services DataToRAG can use. The checkboxes " +
  "come unticked, and continuing without ticking them connects nothing.";
export const INTERSTITIAL_INSTRUCTION =
  'Tick "Select all" on Google\'s screen, then continue there.';
export const INTERSTITIAL_ANNOTATION = "tick this first";
export const INTERSTITIAL_SELECT_ALL = "Select all";
export const INTERSTITIAL_CTA = "Continue to Google";
export const INTERSTITIAL_CANCEL = "Back to the dashboard";
/** The modal's dismiss button. The page's is a link back; the modal's
 * closes over the page you are already on. */
export const MODAL_DISMISS = "Not now";

/** One step of Google's screen: a capture served from `public/connect`, with
 * its intrinsic size so the image box is reserved before it loads and the
 * modal does not jump. */
export type ConsentStep = {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
};

export const CONSENT_STEPS: ConsentStep[] = [
  {
    src: "/connect/consent-1-wants-access.webp",
    width: 896,
    height: 623,
    alt: "Google's screen: DataToRAG MCP wants access to your Google Account",
    caption: "Google asks to connect your account.",
  },
  {
    src: "/connect/consent-2-select-all.webp",
    width: 896,
    height: 516,
    alt: "Google's screen: Select what DataToRAG MCP can access, with a Select all box above unticked boxes for each service",
    caption: "Tick Select all. Every box below it starts unticked.",
  },
  {
    src: "/connect/consent-3-continue.webp",
    width: 896,
    height: 555,
    alt: "Google's screen: Make sure you trust DataToRAG MCP, with Cancel and Continue",
    caption: "Then press Continue.",
  },
];

/** Index of the step that carries the "tick this first" mark. */
export const SELECT_ALL_STEP = 1;

/** Where the Select all row sits in that capture, in percent of the image,
 * measured off the crop. The mark is drawn over the image rather than into
 * it, so its words stay text and stay in the copy list below. */
export const SELECT_ALL_ROW = { top: 17, left: 4.3, width: 27.1, height: 13.6 };

/** The same page after Google came back having granted nothing (SCRUM-410).
 * It says what happened, names what to tick, and its one button tries
 * again. It replaced landing back on the dashboard under a banner, where the
 * instruction was a sentence and the retry was a small link. */
export const REFUSED_TITLE = "Google connected nothing";
export const REFUSED_EXPLANATION =
  "The checkboxes on Google's screen were left unticked, so no access was " +
  "granted. Nothing was connected and nothing was changed.";
export const REFUSED_INSTRUCTION =
  'Try again, and this time tick "Select all" on Google\'s screen before you continue there.';
export const REFUSED_SERVICES_LEAD = "Select all covers these, and each has its own box:";
export const REFUSED_CTA = "Try again";

export const ALL_INTERSTITIAL_COPY = [
  REFUSED_TITLE,
  REFUSED_EXPLANATION,
  REFUSED_INSTRUCTION,
  REFUSED_SERVICES_LEAD,
  REFUSED_CTA,
  INTERSTITIAL_TITLE,
  INTERSTITIAL_EXPLANATION,
  INTERSTITIAL_INSTRUCTION,
  INTERSTITIAL_ANNOTATION,
  INTERSTITIAL_SELECT_ALL,
  INTERSTITIAL_CTA,
  INTERSTITIAL_CANCEL,
  MODAL_DISMISS,
  ...CONSENT_STEPS.flatMap((step) => [step.alt, step.caption]),
];

/** The proceed URL: same route, `proceed=1`, the validated-downstream `next`
 * carried through encoded. Built here so route and page cannot drift.
 *
 * `carry` is the attribution snapshot the click put on the link, already
 * parsed to its known wire names by the route. It is read only on the
 * proceed leg, so the page has to hand it on or a connect made through the
 * page arrives with no source. */
export function googleConnectProceedUrl(
  next: string | null,
  retry = false,
  carry: Record<string, string> = {}
): string {
  const base = retry ? "/auth/google/connect?proceed=1&retry=1" : "/auth/google/connect?proceed=1";
  const withNext = next ? `${base}&next=${encodeURIComponent(next)}` : base;
  const extra = Object.entries(carry)
    .map(([name, value]) => `&${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("");
  return withNext + extra;
}

/** Where a refused connect is sent: this page, in its refused form, with the
 * return path carried through. */
export function googleConnectRefusedUrl(next: string | null): string {
  return next
    ? `/auth/google/connect?refused=1&next=${encodeURIComponent(next)}`
    : "/auth/google/connect?refused=1";
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One step as page markup. Every value here is a module constant, none is
 * user input; escaped anyway so the page has one rule. */
function renderStep(step: ConsentStep, index: number): string {
  const r = SELECT_ALL_ROW;
  const mark =
    index === SELECT_ALL_STEP
      ? `<span class="mark" style="top:${r.top}%;left:${r.left}%;width:${r.width}%;height:${r.height}%"></span>` +
        `<span class="callout" style="top:${r.top + r.height / 2}%;left:${r.left + r.width + 2}%">${INTERSTITIAL_ANNOTATION}</span>`
      : "";
  return `<li><p class="step-caption"><b>${index + 1}.</b>${escapeHtml(step.caption)}</p><div class="shot"><img src="${step.src}" width="${step.width}" height="${step.height}" alt="${escapeHtml(step.alt)}">${mark}</div></li>`;
}

/** The full page. Takes the raw `next` value and builds the proceed URL
 * itself, so the encoding is structural rather than a contract a future
 * caller could miss: the only user-influenced fragment in the HTML is
 * encodeURIComponent output, which cannot break out of a double-quoted
 * attribute. */
export function renderConnectInterstitial(
  next: string | null,
  refused?: {
    /** The service names to tick, from the one list the product asks for. */
    services: string[];
    /** Where "back" goes: the page the connect started from, carrying the
     * refusal so that page can still say what happened. Composed by the
     * caller from a validated path; escaped here regardless. */
    cancelHref: string;
  },
  carry: Record<string, string> = {}
): string {
  const proceedUrl = googleConnectProceedUrl(next, Boolean(refused), carry);
  const title = refused ? REFUSED_TITLE : INTERSTITIAL_TITLE;
  const explanation = refused ? REFUSED_EXPLANATION : INTERSTITIAL_EXPLANATION;
  const instruction = refused ? REFUSED_INSTRUCTION : INTERSTITIAL_INSTRUCTION;
  const cta = refused ? REFUSED_CTA : INTERSTITIAL_CTA;
  const cancelHref = refused ? escapeHtml(refused.cancelHref) : "/dashboard";
  const services = refused
    ? `<p class="services"><span>${REFUSED_SERVICES_LEAD}</span> ${refused.services.map(escapeHtml).join(", ")}.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Connect Google Workspace · DataToRAG</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --card: #ffffff;
    --border: #e7e5e4; --accent: #b45309; --accent-bg: #fffbeb;
    --accent-border: #fcd34d; --btn: #1c1917; --btn-fg: #fafaf9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c0a09; --fg: #fafaf9; --muted: #a8a29e; --card: #1c1917;
      --border: #292524; --accent: #fbbf24; --accent-bg: #292008;
      --accent-border: #92680c; --btn: #fafaf9; --btn-fg: #1c1917;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; min-height: 100vh; align-items: center; justify-content: center;
    padding: 24px;
  }
  main { max-width: 460px; width: 100%; }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 16px; padding: 28px;
  }
  h1 { font-size: 19px; margin: 0 0 10px; }
  p { margin: 0 0 14px; color: var(--muted); }
  .steps { list-style: none; margin: 18px 0; padding: 0; display: grid; gap: 16px; }
  .step-caption { font-size: 13px; color: var(--fg); margin: 0 0 6px; }
  .step-caption b { color: var(--muted); font-weight: 600; margin-right: 4px; }
  .shot {
    position: relative; background: #0e0e0e; border: 1px solid var(--border);
    border-radius: 12px; overflow: hidden; line-height: 0;
  }
  .shot img { width: 100%; height: auto; display: block; }
  .mark {
    position: absolute; border: 2px solid #fbbf24; border-radius: 8px;
  }
  .callout {
    position: absolute; transform: translateY(-50%); line-height: 1.4;
    padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600;
    color: #1c1917; background: #fbbf24; white-space: nowrap;
  }
  .instruction {
    color: var(--fg); background: var(--accent-bg);
    border: 1px solid var(--accent-border); border-radius: 10px;
    padding: 10px 14px; font-size: 14px; margin: 0 0 20px;
  }
  .cta {
    display: block; text-align: center; background: var(--btn);
    color: var(--btn-fg); text-decoration: none; font-weight: 600;
    border-radius: 10px; padding: 12px 16px; font-size: 15px;
  }
  .cancel {
    display: block; text-align: center; margin-top: 12px; font-size: 13px;
    color: var(--muted); text-decoration: none;
  }
  .cancel:hover, .cta:hover { opacity: 0.9; }
  .services { font-size: 13px; }
  .services span { color: var(--fg); }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>${title}</h1>
    <p>${explanation}</p>
    <ol class="steps">${CONSENT_STEPS.map((step, i) => renderStep(step, i)).join("")}</ol>
    ${services}
    <p class="instruction">${instruction}</p>
    <a class="cta" href="${proceedUrl}">${cta}</a>
    <a class="cancel" href="${cancelHref}">${INTERSTITIAL_CANCEL}</a>
  </div>
</main>
</body>
</html>`;
}
