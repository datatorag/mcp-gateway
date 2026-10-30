/**
 * The page a connect lands on when the account is already connected to
 * another DataToRAG user (SCRUM-363). Self-contained like the consent
 * interstitial: plain HTML from Express, light and dark, no Next bundle.
 *
 * It names the other DataToRAG user only by their MASKED sign-in email,
 * already masked by `connectedElsewhere`. Its two buttons are form POSTs,
 * so neither is a link anything else can carry:
 * - "Sign in with the other account" ends this session and starts sign-in,
 *   so the user picks that login in Google's chooser;
 * - "Connect it here anyway" arms a one-shot acknowledgement bound to the
 *   next connect's nonce, and restarts the connect.
 * Back returns to where the connect started, with
 * `connect_error=connected_elsewhere`, composed by the caller through
 * `postConnectDestination`.
 */

export type DuplicateProvider = "google-workspace" | "atlassian" | "notion";

/** Where each provider's connect starts, past Google's interstitial: the
 * duplicate page's restart and a connect link (SCRUM-466) both hand over
 * here, after their own page has been shown. */
export const CONNECT_START: Record<DuplicateProvider, string> = {
  "google-workspace": "/auth/google/connect?proceed=1",
  atlassian: "/auth/atlassian/connect",
  notion: "/auth/notion/connect",
};

export const isDuplicateProvider = (v: unknown): v is DuplicateProvider =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(CONNECT_START, v);

/** What the account is called on the page, per provider. */
const ACCOUNT_NOUN: Record<DuplicateProvider, string> = {
  "google-workspace": "Google account",
  atlassian: "Atlassian account",
  notion: "Notion workspace",
};

/** The page's words, in one place for review. */
export const DUPLICATE_COPY = {
  title: (noun: string, masked: string) =>
    `This ${noun} is already connected to another DataToRAG account (${masked}).`,
  explanation:
    "Usage and your plan follow the DataToRAG account you sign in with. If you meant to use that one, sign in with it instead.",
  signInOther: "Sign in with the other account",
  connectAnyway: "Connect it here anyway",
  back: "Back",
} as const;

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderConnectDuplicate(opts: {
  provider: DuplicateProvider;
  /** Already masked by `connectedElsewhere`. Escaped here regardless. */
  maskedSignIn: string;
  /** From `postConnectDestination`, never a raw `next`. */
  backHref: string;
  /** The validated path the connect was asked to return to, or null. */
  next: string | null;
}): string {
  const noun = ACCOUNT_NOUN[opts.provider];
  const anyway = new URLSearchParams({ provider: opts.provider });
  if (opts.next) anyway.set("next", opts.next);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Already connected · DataToRAG</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --card: #ffffff;
    --border: #e7e5e4; --btn: #1c1917; --btn-fg: #fafaf9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c0a09; --fg: #fafaf9; --muted: #a8a29e; --card: #1c1917;
      --border: #292524; --btn: #fafaf9; --btn-fg: #1c1917;
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
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 28px; }
  h1 { font-size: 18px; margin: 0 0 10px; }
  p { margin: 0 0 20px; color: var(--muted); }
  form { margin: 0 0 10px; }
  button {
    width: 100%; border-radius: 10px; padding: 12px 16px; font: inherit; font-weight: 600;
    cursor: pointer; border: 1px solid var(--btn);
  }
  .primary { background: var(--btn); color: var(--btn-fg); }
  .secondary { background: transparent; color: var(--fg); border-color: var(--border); }
  .back { display: block; text-align: center; margin-top: 12px; font-size: 13px; color: var(--muted); text-decoration: none; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>${escapeHtml(DUPLICATE_COPY.title(noun, opts.maskedSignIn))}</h1>
    <p>${escapeHtml(DUPLICATE_COPY.explanation)}</p>
    <form method="post" action="/auth/connect/switch-account">
      <button class="primary" type="submit">${escapeHtml(DUPLICATE_COPY.signInOther)}</button>
    </form>
    <form method="post" action="/auth/connect/anyway?${escapeHtml(anyway.toString())}">
      <button class="secondary" type="submit">${escapeHtml(DUPLICATE_COPY.connectAnyway)}</button>
    </form>
    <a class="back" href="${escapeHtml(opts.backHref)}">${escapeHtml(DUPLICATE_COPY.back)}</a>
  </div>
</main>
</body>
</html>`;
}
