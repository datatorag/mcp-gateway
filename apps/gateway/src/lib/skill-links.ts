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

/** Connector display name to the service id the connect flow and the
 * connections table use. One mapping, next to `connectorsFor`, so the three
 * surfaces that ask "does this user have what this skill needs" agree. */
const SERVICE_ID_BY_CONNECTOR: Record<string, string> = {
  "Google Workspace": "google-workspace",
  Atlassian: "atlassian",
};

/** The service ids a skill needs connected, in `connectorsFor` order. */
export function servicesFor(skill: { tools: string[] }): string[] {
  return connectorsFor(skill.tools)
    .map((name) => SERVICE_ID_BY_CONNECTOR[name])
    .filter((id): id is string => typeof id === "string");
}


/** Which connectors a tool set touches, from the tool-name prefix the
 * plugins already namespace by. */
export function connectorsFor(tools: string[]): string[] {
  const out = new Set<string>();
  for (const tool of tools) {
    if (/^(gmail|calendar|drive|sheets|docs|slides|contacts|tasks|gws)_/.test(tool)) {
      out.add("Google Workspace");
    } else if (/^(jira|confluence)_/.test(tool)) {
      out.add("Atlassian");
    }
  }
  return [...out];
}
