import type { CaseContext } from "./types";

/**
 * The Jira project the suite works in, from the fixture, held to a key's
 * shape (SCRUM-303).
 *
 * It was the literal "SCRUM" in three cases, which is the team's real board:
 * every issue C11 created burned a number there and was announced in the
 * team's channel. The project now comes from the mapping, and because it is
 * spliced into JQL it is checked to be a project key first, so a mistyped
 * mapping fails here rather than becoming a different query.
 */
export function jiraProjectKey(ctx: Pick<CaseContext, "fixture">): string {
  const key = ctx.fixture("jiraProject");
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(key)) {
    throw new Error("the mapped jiraProject is not shaped like a Jira project key, so no query is built from it");
  }
  return key;
}
