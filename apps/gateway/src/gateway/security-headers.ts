import type { NextFunction, Request, Response } from "express";

/**
 * Anti-framing headers, on every response this server sends.
 *
 * WHY THIS EXISTS. The dashboard renders tool-approval prompts: the dialog
 * where a user authorises the agent to send a mail, write a doc, delete an
 * issue. An approval gate that can be framed is a decoration, because the
 * classic clickjacking attack is exactly this shape — put our page in a
 * transparent iframe over the attacker's own button and let the user click
 * "Approve" believing they clicked something else. Nothing about the prompt's
 * own logic can defend against it; the browser has to refuse to frame us.
 *
 * WHY BOTH HEADERS. `frame-ancestors` is the modern control and the only one
 * that is actually specified; browsers that understand it ignore
 * `X-Frame-Options` entirely. XFO stays as the legacy fallback, and it is
 * genuinely useful here for a second reason: it is an INDEPENDENT header, so
 * a future Content-Security-Policy added elsewhere for scripts or styles
 * cannot silently take frame protection with it when it replaces ours.
 *
 * WHY 'none' AND NOT 'self'. There is no embed case anywhere on this site. We
 * embed a third-party badge widget, which is the opposite direction and
 * unaffected. `'self'` would permit our own pages to frame each other, which
 * buys nothing and leaves a same-origin path open for any future HTML
 * injection to exploit. Narrow it only when a real embed requirement turns
 * up, and treat that as a decision worth recording rather than a tweak.
 *
 * WHY EVERY RESPONSE, WITH NO PATH EXCEPTIONS. A branch here is a thing to
 * get wrong later, and the cost of sending these on `/mcp` or `/health` is
 * two headers nobody reads. Unconditional means there is no "was this route
 * covered?" question to answer during the next review.
 */

/** The CSP we send. Deliberately frame-ancestors ONLY: a CSP is a set of
 * independent directives, so this restricts framing and says nothing about
 * scripts, styles or connections. Adding more directives here is a much
 * larger change with real breakage potential and must not be smuggled in on
 * the back of this one. */
export const FRAME_CSP = "frame-ancestors 'none'";

/** The legacy equivalent. `DENY` rather than `SAMEORIGIN` for the same
 * reason the CSP says `'none'`. */
export const FRAME_OPTIONS = "DENY";

/**
 * Express middleware. Mount this FIRST, before any router that can produce a
 * response, so that no route can return before the headers are attached.
 */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader("Content-Security-Policy", FRAME_CSP);
  res.setHeader("X-Frame-Options", FRAME_OPTIONS);
  next();
}
