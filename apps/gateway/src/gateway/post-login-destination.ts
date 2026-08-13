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
}): string {
  const { agentDefaultView, isNewUser } = opts;
  if (agentDefaultView) {
    return isNewUser
      ? "/dashboard/agent?signup=1&welcome=1"
      : "/dashboard/agent?welcome=1";
  }
  return isNewUser ? "/dashboard?signup=1" : "/dashboard";
}
