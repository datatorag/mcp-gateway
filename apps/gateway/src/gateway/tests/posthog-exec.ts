/** What every runner call to PostHog's `exec` gives as its `context`
 * (SCRUM-511): PostHog asks for a few words on why, with no personal
 * details. One value, so a case cannot put anything else there. */
export const POSTHOG_EXEC_CONTEXT = "an automated read-only smoke test";
