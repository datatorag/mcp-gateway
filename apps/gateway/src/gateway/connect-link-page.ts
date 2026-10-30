/**
 * The pages a connect link shows (SCRUM-466). Self-contained like the
 * duplicate page: plain HTML from Express, light and dark, no script, no
 * Next bundle. Google's link page is the consent interstitial itself, with
 * its button posting to the link (see `renderConnectInterstitial`).
 *
 * Nothing here names a DataToRAG account beyond the masked sign-in email of
 * the account a link was made for.
 */
import type { DuplicateProvider } from "./connect-duplicate";

/** What the account is called on these pages, per provider. */
const ACCOUNT_NOUN: Record<DuplicateProvider, string> = {
  "google-workspace": "Google account",
  atlassian: "Atlassian account",
  notion: "Notion workspace",
};

/** The pages' words, in one place for review. */
export const CONNECT_LINK_COPY = {
  title: (service: string) => `Connect ${service} to DataToRAG`,
  lead: (masked: string) => `It will be added to the DataToRAG account signed in as ${masked}.`,
  cta: (provider: string) => `Continue to ${provider}`,
  expiredTitle: "This link has expired",
  expiredBody: "Ask your assistant to connect again.",
  otherAccountTitle: "This link was made for a different DataToRAG account",
  otherAccountBody: "It is not the one signed in here. Sign out, then open the link again.",
  signOut: "Sign out",
  confirmTitle: (noun: string) => `Your ${noun} was not connected yet`,
  confirmBody:
    "DataToRAG needs to confirm it is you. Sign in, and the connect picks up where it left off.",
  confirmCta: "Sign in to continue",
  doneTitle: (service: string) => `${service} is connected`,
  doneBody: "Go back to your assistant, it can use it now.",
  partialTitle: (service: string) => `${service} is connected, with some access missing`,
  partialBody: (missing: string) =>
    `Not allowed on the consent screen: ${missing}. Ask your assistant to connect again and tick every box.`,
  failedTitle: "That did not connect",
  failedBody: "Ask your assistant to connect again.",
} as const;

/** The provider's own name on the button. */
const PROVIDER_NAME: Record<DuplicateProvider, string> = {
  "google-workspace": "Google",
  atlassian: "Atlassian",
  notion: "Notion",
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · DataToRAG</title>
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
  p:last-child { margin-bottom: 0; }
  form { margin: 0; }
  button, .button {
    display: block; width: 100%; text-align: center; text-decoration: none;
    border-radius: 10px; padding: 12px 16px; font: inherit; font-weight: 600;
    cursor: pointer; border: 1px solid var(--btn); background: var(--btn); color: var(--btn-fg);
  }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </div>
</main>
</body>
</html>`;
}

/** Atlassian's and Notion's link page: who it is for, and one button that
 * posts to the link. Google's is the consent interstitial. */
export function renderConnectLinkPage(opts: {
  provider: DuplicateProvider;
  service: string;
  maskedSignIn: string;
  action: string;
}): string {
  return page(
    CONNECT_LINK_COPY.title(opts.service),
    `<p>${escapeHtml(CONNECT_LINK_COPY.lead(opts.maskedSignIn))}</p>
    <form method="post" action="${escapeHtml(opts.action)}">
      <button type="submit">${escapeHtml(CONNECT_LINK_COPY.cta(PROVIDER_NAME[opts.provider]))}</button>
    </form>`
  );
}

/** An expired, spent or unknown link: the three are not told apart. */
export function renderConnectLinkExpired(): string {
  return page(CONNECT_LINK_COPY.expiredTitle, `<p>${escapeHtml(CONNECT_LINK_COPY.expiredBody)}</p>`);
}

/** The browser is signed in as a different DataToRAG user. */
export function renderConnectLinkOtherAccount(): string {
  return page(
    CONNECT_LINK_COPY.otherAccountTitle,
    `<p>${escapeHtml(CONNECT_LINK_COPY.otherAccountBody)}</p>
    <form method="post" action="/auth/logout">
      <button type="submit">${escapeHtml(CONNECT_LINK_COPY.signOut)}</button>
    </form>`
  );
}

/** A connect from a browser with no session whose provider account is not
 * the link user's sign-in email: nothing was stored, sign in first. */
export function renderConnectLinkConfirm(opts: { provider: DuplicateProvider; signInHref: string }): string {
  return page(
    CONNECT_LINK_COPY.confirmTitle(ACCOUNT_NOUN[opts.provider]),
    `<p>${escapeHtml(CONNECT_LINK_COPY.confirmBody)}</p>
    <a class="button" href="${escapeHtml(opts.signInHref)}">${escapeHtml(CONNECT_LINK_COPY.confirmCta)}</a>`
  );
}

/** Where a link-started connect ends: back to the conversation. `missing`
 * names what a partial Google grant left out. */
export function renderConnectDone(service: string | null, missing: string[] = []): string {
  if (service === null) {
    return page(CONNECT_LINK_COPY.failedTitle, `<p>${escapeHtml(CONNECT_LINK_COPY.failedBody)}</p>`);
  }
  if (missing.length > 0) {
    return page(
      CONNECT_LINK_COPY.partialTitle(service),
      `<p>${escapeHtml(CONNECT_LINK_COPY.partialBody(missing.join(", ")))}</p>`
    );
  }
  return page(CONNECT_LINK_COPY.doneTitle(service), `<p>${escapeHtml(CONNECT_LINK_COPY.doneBody)}</p>`);
}
