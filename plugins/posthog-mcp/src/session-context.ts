/**
 * What a session is handed by the gateway (SCRUM-471): the user's PostHog
 * access token in `X-User-Token`, the regional host in `X-PostHog-Host`, and
 * the one project the connection was granted in `X-PostHog-Project`.
 *
 * The host is where the token is sent, so it must equal one of the two
 * regional hosts exactly; a project is digits. A session that fails either
 * check gets no client, and every call says why, before any request is made.
 */

export const POSTHOG_HOSTS = ["https://us.posthog.com", "https://eu.posthog.com"] as const;

export type SessionContext =
  | { ok: true; host: string; project: string; token: string }
  | { ok: false; refusal: string };

type Headers = Record<string, string | string[] | undefined>;

function one(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The host when it is exactly one of the regional hosts, a trailing slash
 * aside. Exact equality, not a parse or a prefix: a path, a port, a user part
 * or another host that merely starts the same way is refused. */
export function allowedHost(raw: string | undefined): string | null {
  if (!raw) return null;
  const host = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return (POSTHOG_HOSTS as readonly string[]).includes(host) ? host : null;
}

export function sessionContext(headers: Headers): SessionContext {
  const token = one(headers, "x-user-token");
  if (!token) {
    return {
      ok: false,
      refusal:
        "No PostHog access token reached this call. The gateway sends the connected project's token with each " +
        "session; the gateway's connect tool shows whether PostHog is connected.",
    };
  }
  const host = allowedHost(one(headers, "x-posthog-host"));
  if (!host) {
    return { ok: false, refusal: "The gateway did not name a PostHog region this server accepts, so nothing was sent." };
  }
  const project = one(headers, "x-posthog-project");
  if (!project || !/^[1-9]\d{0,15}$/.test(project)) {
    return {
      ok: false,
      refusal:
        "This PostHog connection names no project. Reconnect PostHog and choose one project on PostHog's consent " +
        "screen; the gateway's connect tool gives the link.",
    };
  }
  return { ok: true, host, project, token };
}
