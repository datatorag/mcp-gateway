/**
 * The skill deep link, in a module with NO server-only imports (SCRUM-223).
 *
 * `lib/skills.ts` reads the catalogue from disk, so a client component that
 * imports it pulls filesystem code into the browser bundle and the page fails
 * to build. The two link builders are the only catalogue helpers the client
 * needs, so they live here and `lib/skills.ts` re-exports them for server
 * callers. One definition either way.
 */

/** The deep link: the agent, with this skill named by slug. Resolved
 * server-side by identifier, never by content (the SCRUM-118 rule). */
export function skillDeepLink(slug: string): string {
  return `/dashboard/agent?skill=${encodeURIComponent(slug)}`;
}

/** The sign-in link that lands on the deep link after login. The middleware
 * builds the same thing for a signed-out hit on the deep link itself; this is
 * for a caller that wants the login page as the first hop. */
export function signInAndRunHref(slug: string): string {
  return `/auth/login?next=${encodeURIComponent(skillDeepLink(slug))}`;
}
