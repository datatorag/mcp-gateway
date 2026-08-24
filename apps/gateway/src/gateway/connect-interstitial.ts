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
 * prefers-color-scheme, system fonts, no dependency on the Next bundle. The
 * consent illustration is a deliberately schematic drawing, not a screenshot
 * of Google's UI — a mocked-up Google screen would be a fabricated asset that
 * drifts the first time Google repaints, and the two facts that matter (the
 * boxes come unticked; "Select all" fixes that in one tap) survive any
 * repaint of the real screen.
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

export const ALL_INTERSTITIAL_COPY = [
  INTERSTITIAL_TITLE,
  INTERSTITIAL_EXPLANATION,
  INTERSTITIAL_INSTRUCTION,
  INTERSTITIAL_ANNOTATION,
  INTERSTITIAL_SELECT_ALL,
  INTERSTITIAL_CTA,
  INTERSTITIAL_CANCEL,
];

/** The proceed URL: same route, `proceed=1`, the validated-downstream `next`
 * carried through encoded. Built here so route and page cannot drift. */
export function googleConnectProceedUrl(next: string | null): string {
  return next
    ? `/auth/google/connect?proceed=1&next=${encodeURIComponent(next)}`
    : "/auth/google/connect?proceed=1";
}

/** The full page. Takes the raw `next` value and builds the proceed URL
 * itself, so the encoding is structural rather than a contract a future
 * caller could miss: the only user-influenced fragment in the HTML is
 * encodeURIComponent output, which cannot break out of a double-quoted
 * attribute. */
export function renderConnectInterstitial(next: string | null): string {
  const proceedUrl = googleConnectProceedUrl(next);
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
  .consent {
    border: 1px solid var(--border); border-radius: 12px;
    padding: 14px 16px; margin: 18px 0; font-size: 13px;
  }
  .consent-title { color: var(--muted); margin-bottom: 10px; font-size: 12px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 5px 0; color: var(--muted); }
  .box {
    width: 16px; height: 16px; border: 2px solid var(--muted);
    border-radius: 4px; flex: none;
  }
  .row.select-all { color: var(--fg); font-weight: 600; }
  .row.select-all .box { border-color: var(--accent); }
  .callout {
    display: inline-block; margin-left: 6px; padding: 2px 8px;
    border-radius: 999px; font-size: 11px; font-weight: 600;
    color: var(--accent); background: var(--accent-bg);
    border: 1px solid var(--accent-border);
  }
  .dim { opacity: 0.65; }
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
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>${INTERSTITIAL_TITLE}</h1>
    <p>${INTERSTITIAL_EXPLANATION}</p>
    <div class="consent" aria-hidden="true">
      <div class="consent-title">On Google's screen you will see permission checkboxes:</div>
      <div class="row select-all"><span class="box"></span>${INTERSTITIAL_SELECT_ALL}<span class="callout">${INTERSTITIAL_ANNOTATION}</span></div>
      <div class="row dim"><span class="box"></span>Read, compose and send emails</div>
      <div class="row dim"><span class="box"></span>See and manage files in Drive</div>
      <div class="row dim"><span class="box"></span>See and edit calendar events</div>
      <div class="row dim"><span class="box"></span>&hellip; and the rest of the list</div>
    </div>
    <p class="instruction">${INTERSTITIAL_INSTRUCTION}</p>
    <a class="cta" href="${proceedUrl}">${INTERSTITIAL_CTA}</a>
    <a class="cancel" href="/dashboard">${INTERSTITIAL_CANCEL}</a>
  </div>
</main>
</body>
</html>`;
}
