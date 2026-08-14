/**
 * Where a login lands, for every combination of flag and user.
 *
 * Pure and standalone so the whole table below can be pinned by a test without
 * standing up the OAuth callback around it.
 *
 * | AGENT_DEFAULT_VIEW | user      | destination                              |
 * |--------------------|-----------|------------------------------------------|
 * | on                 | new       | `/dashboard/agent?signup=1&welcome=1`    |
 * | on                 | returning | `/dashboard/agent?welcome=1`             |
 * | off                | new       | `/dashboard?signup=1`                    |
 * | off                | returning | `/dashboard`                             |
 *
 * ONE SWITCH. The flag decides the surface for everyone; it is not a
 * new-user-only setting. With it off, every destination is byte-identical to
 * what it was before the agent existed, which is what makes the flag a real
 * rollback rather than a partial one. (Per HQ decision, see SCRUM-70.)
 *
 * THE TWO PARAMS ARE NOT INTERCHANGEABLE, and each is a one-character mistake
 * with a silent consequence in the opposite direction:
 *
 * - `?signup=1` is the sole gate on the Google Ads signup conversion
 *   (`useSignupConversion` reads the PARAM, not the page). Putting it on the
 *   returning arm would report every login as a new signup.
 * - `?welcome=1` is the only way the agent route can tell "landed here" from
 *   "navigated here", and so the only thing that makes this redirect
 *   observable at all. Omitting it on the returning arm ships the change with
 *   no way to see whether it works.
 */
export function postLoginDestination(opts: {
  /** `AGENT_DEFAULT_VIEW === "on"`. */
  agentDefaultView: boolean;
  isNewUser: boolean;
  /** The RAW `next` value carried through the login flow (SCRUM-71) — the
   * route the user asked for before being bounced to login. Untrusted:
   * validated HERE, inside the only function that produces post-login
   * redirects, so no caller can forget the validation and hand an attacker a
   * post-login open redirect. Rejected or absent → the table below, exactly
   * as before; `next` is a case in FRONT of the table, not a change to it. */
  requestedPath?: unknown;
}): string {
  const { agentDefaultView, isNewUser } = opts;

  const next = resolveNextPath(opts.requestedPath);
  if (next !== null) {
    // The params ride along because their meaning is about the LOGIN, not the
    // route: a new user is a new user wherever they asked to land, and
    // signup=1 is the sole gate on the Ads signup conversion. welcome=1 only
    // attaches when the destination IS the agent — it is how that page tells
    // "landed here" from "navigated here", and putting it on other routes
    // would be a meaningless param nothing reads.
    const url = new URL(next, "http://placeholder.invalid");
    if (isNewUser) url.searchParams.set("signup", "1");
    if (
      url.pathname === "/dashboard/agent" ||
      url.pathname.startsWith("/dashboard/agent/")
    ) {
      url.searchParams.set("welcome", "1");
    }
    return url.pathname + url.search;
  }

  if (agentDefaultView) {
    return isNewUser
      ? "/dashboard/agent?signup=1&welcome=1"
      : "/dashboard/agent?welcome=1";
  }
  return isNewUser ? "/dashboard?signup=1" : "/dashboard";
}

/**
 * Validate a `next` value as a same-origin PATH, or return null.
 *
 * An unvalidated post-login redirect is a phishing primitive: the victim
 * authenticates against our genuine domain and we hand them to the attacker.
 * So this REJECTS AND FALLS BACK — it never sanitises, because a sanitiser is
 * a second parser that has to agree with every browser's, and the fallback
 * (the normal post-login destination) costs the user one click.
 *
 * Accepted: a path starting with a single "/", optionally carrying a query.
 * Rejected, each for a reason:
 * - anything not a plain non-empty string, or over 512 chars;
 * - no leading "/" (absolute URLs, `https://evil.com`, and anything
 *   percent-mangled into not-a-path);
 * - a second leading "/" or "\" (protocol-relative `//evil.com` and its
 *   backslash twin `/\evil.com` — browsers treat "\" as "/" in URLs);
 * - a "\" anywhere (same browser normalisation, later in the string);
 * - an encoded "/" or "\" anywhere (`%2f`, `%5c`): Express has already
 *   decoded once, so a survivor is a double-encoding trick aimed at whatever
 *   decodes next;
 * - control characters (header/URL injection).
 */
export function resolveNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return null;
  }
  if (!raw.startsWith("/")) return null;
  if (raw[1] === "/" || raw[1] === "\\") return null;
  if (raw.includes("\\")) return null;
  if (/%2f|%5c/i.test(raw)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}
