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
/** What Continue sends after a stop (SCRUM-234): a fixed text per slug, so
 * the chat route can recognise it beside the slug as a skill run and keep the
 * no-gates policy. It resumes; it never restarts from the seed. */
export function skillContinueMessage(slug: string): string {
  return (
    `Continue the skill run for ${slug}. Pick up from your last completed step, ` +
    "do not restart from the beginning, stay within its own rails, and report " +
    "what you did at the end."
  );
}

/** When a run started and where the user is (SCRUM-242). `zone` is an IANA
 * name the caller has already validated, or null when nobody knows it. */
export type RunClock = { now: Date; zone: string | null };

/** The local wall clock of `now` in `zone` as `{ weekday, date, time }`. */
function localParts(now: Date, zone: string): { weekday: string; date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    weekday: "long",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** The one line that tells a run what day it is (SCRUM-242).
 *
 * A skill run has no clock: no tool returns the time, and the system prompt
 * carries no date on purpose, because it is the cached prefix of every call
 * and a timestamp there would break the cache on every turn. The run message
 * is per run and uncached already, so the clock ends it. The first live run
 * without this line inferred the date from mail timestamps, got tomorrow,
 * and re-read every calendar for the wrong day. */
export function runClockLine(clock: RunClock): string {
  const iso = clock.now.toISOString().replace(/\.\d{3}Z$/, "Z");
  if (clock.zone) {
    const local = localParts(clock.now, clock.zone);
    return (
      `Run started ${iso}. The user's time zone is ${clock.zone}, where it is ` +
      `${local.weekday} ${local.date} ${local.time}; that is today. Take every "today" and ` +
      `"tomorrow" in the skill from this line, never from a mail or event timestamp.`
    );
  }
  const utcDate = iso.slice(0, 10);
  return (
    `Run started ${iso}. The user's time zone is not known: take today as ${utcDate} (UTC) ` +
    "unless a calendar you read shows a different local date, and never take the date from " +
    "a mail timestamp."
  );
}

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
