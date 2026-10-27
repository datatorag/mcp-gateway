import { randomBytes } from "node:crypto";
import { Router, type Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database, PendingConsentFlow } from "@datatorag-mcp/db";
import { oauthAuthorizationCodes, oauthConsents, oauthPendingConsents } from "@datatorag-mcp/db";
import { hashToken, safeStringEqual } from "@datatorag-mcp/auth";

/**
 * Consent for an MCP client (SCRUM-373).
 *
 * After Google sign-in the callback knows who the user is. A client this user
 * has approved before is issued a code at once; any other gets this page
 * first, naming the client and where it sends you, with Approve and Deny.
 * The answer is remembered per (user, client id), Approve only.
 *
 * The page answers for one pending row, bound to the browser by a one-time
 * nonce: its sha256 is on the row, the raw value is in an httpOnly, Secure
 * cookie scoped to /oauth/consent. The POST must be same-origin, must carry
 * that cookie, and spends the row whatever it answers. The page is a plain
 * Express page like the connect pages, never framed (the global
 * frame-ancestors 'none' applies).
 */

export const CONSENT_COOKIE = "mcp_consent_nonce";
export const CONSENT_PATH = "/oauth/consent";
const PENDING_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;

/** The page's words, in one place for review. */
export const CONSENT_COPY = {
  pageTitle: "Approve an app · DataToRAG",
  title: (name: string | null) => `Allow ${name ?? "an app"} to use DataToRAG?`,
  body: (name: string | null, email: string) =>
    `${name ?? "This app"} will be able to use the tools for the accounts you have connected, as ${email}.`,
  sendsTo: "Approving sends you back to",
  remembered: "If you approve, you won't be asked again for this app.",
  warning: "Only approve an app you just added yourself.",
  approve: "Approve",
  deny: "Deny",
  expired: "This approval has expired or was already used. Start the connection again from your app.",
  crossOrigin: "This approval has to come from the DataToRAG page.",
} as const;

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Where the code goes, as the host only. The URL parser gives an
 * internationalised name in its ASCII (punycode) form, so a lookalike cannot
 * pass for a familiar host. */
export function redirectHost(redirectUri: string): string {
  return new URL(redirectUri).hostname;
}

export function renderConsentPage(opts: {
  clientName: string | null;
  email: string;
  redirectUri: string;
  pendingId: string;
}): string {
  const host = redirectHost(opts.redirectUri);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(CONSENT_COPY.pageTitle)}</title>
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
  h1 { font-size: 18px; margin: 0 0 10px; overflow-wrap: anywhere; }
  p { margin: 0 0 14px; color: var(--muted); overflow-wrap: anywhere; }
  strong { color: var(--fg); }
  .warning { color: var(--fg); margin-bottom: 20px; }
  form { margin: 0 0 10px; }
  button {
    width: 100%; border-radius: 10px; padding: 12px 16px; font: inherit; font-weight: 600;
    cursor: pointer; border: 1px solid var(--btn);
  }
  .primary { background: var(--btn); color: var(--btn-fg); }
  .secondary { background: transparent; color: var(--fg); border-color: var(--border); }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>${escapeHtml(CONSENT_COPY.title(opts.clientName))}</h1>
    <p>${escapeHtml(CONSENT_COPY.body(opts.clientName, opts.email))}</p>
    <p>${escapeHtml(CONSENT_COPY.sendsTo)} <strong>${escapeHtml(host)}</strong>.</p>
    <p>${escapeHtml(CONSENT_COPY.remembered)}</p>
    <p class="warning">${escapeHtml(CONSENT_COPY.warning)}</p>
    <form method="post" action="${CONSENT_PATH}">
      <input type="hidden" name="pending" value="${escapeHtml(opts.pendingId)}">
      <input type="hidden" name="decision" value="approve">
      <button class="primary" type="submit">${escapeHtml(CONSENT_COPY.approve)}</button>
    </form>
    <form method="post" action="${CONSENT_PATH}">
      <input type="hidden" name="pending" value="${escapeHtml(opts.pendingId)}">
      <input type="hidden" name="decision" value="deny">
      <button class="secondary" type="submit">${escapeHtml(CONSENT_COPY.deny)}</button>
    </form>
  </div>
</main>
</body>
</html>`;
}

/** Whether this user has approved this client before. */
export async function hasConsent(db: Database, userId: string, clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: oauthConsents.id })
    .from(oauthConsents)
    .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)))
    .limit(1);
  return !!row;
}

/** Issue an authorization code for a validated flow and return the URL to
 * send the browser to. The one place a code is minted: the callback for a
 * remembered client, the consent POST on Approve. */
export async function issueAuthorizationCode(
  db: Database,
  userId: string,
  flow: PendingConsentFlow
): Promise<string> {
  const authCode = randomBytes(32).toString("base64url");
  await db.insert(oauthAuthorizationCodes).values({
    code: authCode,
    // SCRUM-443: the hash beside the raw value, as every code insert writes.
    codeHash: hashToken(authCode),
    clientId: flow.clientId,
    userId,
    redirectUri: flow.redirectUri,
    codeChallenge: flow.codeChallenge,
    codeChallengeMethod: flow.codeChallengeMethod,
    scope: flow.scope,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  const url = new URL(flow.redirectUri);
  url.searchParams.set("code", authCode);
  if (flow.state) url.searchParams.set("state", flow.state);
  return url.toString();
}

/** Park the flow, set the one-time cookie, and render the page. */
export async function startConsent(
  db: Database,
  res: Response,
  opts: { userId: string; email: string; clientName: string | null; flow: PendingConsentFlow }
): Promise<void> {
  const nonce = randomBytes(32).toString("base64url");
  const [pending] = await db
    .insert(oauthPendingConsents)
    .values({
      nonceHash: hashToken(nonce),
      userId: opts.userId,
      flow: opts.flow,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    })
    .returning({ id: oauthPendingConsents.id });
  res.cookie(CONSENT_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: CONSENT_PATH,
    maxAge: PENDING_TTL_MS,
  });
  res.setHeader("Cache-Control", "no-store");
  res
    .status(200)
    .type("html")
    .send(
      renderConsentPage({
        clientName: opts.clientName,
        email: opts.email,
        redirectUri: opts.flow.redirectUri,
        pendingId: pending!.id,
      })
    );
}

/** Same-origin only. A request with neither header is refused: a browser
 * sends at least one on a form POST, so their absence is not a browser. */
export function isSameOrigin(
  headers: { origin?: string | string[]; "sec-fetch-site"?: string | string[] },
  baseUrl: string
): boolean {
  const origin = typeof headers.origin === "string" ? headers.origin : undefined;
  const site = typeof headers["sec-fetch-site"] === "string" ? headers["sec-fetch-site"] : undefined;
  if (origin !== undefined) return origin === new URL(baseUrl).origin;
  if (site !== undefined) return site === "same-origin";
  return false;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createConsentRouter(db: Database, config: { baseUrl: string }): Router {
  const router = Router();

  router.post(CONSENT_PATH, async (req, res) => {
    // One use: the cookie is cleared on every answer, whatever it is.
    const nonce = req.cookies?.[CONSENT_COOKIE] as string | undefined;
    res.clearCookie(CONSENT_COOKIE, { path: CONSENT_PATH, httpOnly: true, secure: true, sameSite: "lax" });
    res.setHeader("Cache-Control", "no-store");

    if (!isSameOrigin(req.headers, config.baseUrl)) {
      res.status(403).type("text").send(CONSENT_COPY.crossOrigin);
      return;
    }

    const pendingId = typeof req.body?.pending === "string" ? req.body.pending : "";
    const decision = req.body?.decision;
    if (!nonce || !UUID.test(pendingId) || (decision !== "approve" && decision !== "deny")) {
      res.status(400).type("text").send(CONSENT_COPY.expired);
      return;
    }

    const [row] = await db
      .select({
        nonceHash: oauthPendingConsents.nonceHash,
        userId: oauthPendingConsents.userId,
        flow: oauthPendingConsents.flow,
      })
      .from(oauthPendingConsents)
      .where(eq(oauthPendingConsents.id, pendingId))
      .limit(1);
    if (!row || !safeStringEqual(hashToken(nonce), row.nonceHash)) {
      res.status(400).type("text").send(CONSENT_COPY.expired);
      return;
    }

    // The claim: unused and unexpired, spent in the same statement, so two
    // answers to one page cannot both issue a code.
    const claimed = await db
      .update(oauthPendingConsents)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(oauthPendingConsents.id, pendingId),
          isNull(oauthPendingConsents.usedAt),
          gt(oauthPendingConsents.expiresAt, new Date())
        )
      )
      .returning({ id: oauthPendingConsents.id });
    if (claimed.length === 0) {
      res.status(400).type("text").send(CONSENT_COPY.expired);
      return;
    }

    const flow = row.flow;
    if (decision === "deny") {
      // RFC 6749 section 4.1.2.1. Nothing is recorded.
      const url = new URL(flow.redirectUri);
      url.searchParams.set("error", "access_denied");
      if (flow.state) url.searchParams.set("state", flow.state);
      res.redirect(303, url.toString());
      return;
    }

    await db
      .insert(oauthConsents)
      .values({ userId: row.userId, clientId: flow.clientId })
      .onConflictDoNothing();
    res.redirect(303, await issueAuthorizationCode(db, row.userId, flow));
  });

  return router;
}
