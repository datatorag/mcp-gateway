/**
 * Where a "get started" click goes (SCRUM-408): straight to Google sign-in.
 *
 * There used to be a page in between, with one button on it that did the
 * same thing. Every visitor paid a second click for it and some did not make
 * it. Calls to action now start sign-in themselves, and `/auth/login` is only
 * where a sign-in that did not finish, or a session that lapsed, comes back
 * to.
 *
 * No imports, so client and server components can both use it.
 *
 * `/auth/google` is an Express route that answers with a redirect to Google
 * and sets cookies on the way. LINK TO IT WITH A PLAIN ANCHOR, never
 * `next/link`: a prefetch would start a sign-in nobody asked for on every
 * render. `CtaLink` picks the right element when the href is not known until
 * runtime.
 */
export const SIGN_IN_PATH = "/auth/google";

/** The sign-in link, optionally returning to `next` afterwards. `next` is a
 * same-origin path; the route validates it again and ignores anything else. */
export function signInHref(next?: string | null): string {
  return next ? `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}` : SIGN_IN_PATH;
}

/** Whether an href starts a server-side auth flow, and so must not be
 * prefetched or client-routed. */
export function isAuthFlowHref(href: string): boolean {
  return href === "/auth" || href.startsWith("/auth/");
}
