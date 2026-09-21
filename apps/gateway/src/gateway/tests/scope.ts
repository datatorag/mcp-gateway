import type { TestRunScope } from "@datatorag-mcp/db";
import { SCENARIOS, scenario } from "./scenarios";

/**
 * What a caller asked a run to cover, parsed ONCE (SCRUM-303).
 *
 * This module exists because the same defect was fixed three times and came
 * back under a fourth spelling each time. Two entry points, the admin route
 * and the `tests_run` tool, each hand-rolled this, each defaulted to
 * ACCEPT for anything they had not anticipated, and the two disagreed about
 * which inputs were refusable. The failures all had the same shape and the
 * same consequence:
 *
 *   an unregistered key  selected nothing -> ran green
 *   `case_ids: [10, 11]`  unusable elements -> scope {} -> ran all 55
 *   `case_ids: []`        empty list       -> scope {} -> ran all 55
 *   `case_ids: "A1"`      not an array     -> scope {} -> ran all 55
 *   `scenario: 7`         not a string     -> scope {} -> ran all 55
 *
 * Every one of them is A REQUEST THAT NARROWED BECOMING A RUN THAT WIDENED,
 * and the widened run sends real mail to the fixture inbox. None of them
 * looked like a failure: the run finished and reported no failures.
 *
 * So the rule here is not a list of spellings, it is a DEFAULT. Anything
 * that is not exactly what the schema declares is refused by name, INCLUDING
 * A FIELD NAME WE DO NOT KNOW. Ignoring unknown keys looks like tolerance
 * and is the same bug again: `{"caseIds": ["A1"]}`, the camelCase spelling
 * used everywhere else in this codebase, named one case and ran all 55.
 * A misspelled field is a caller who meant something, and guessing they
 * meant "everything" is never right.
 *
 * Both entry points call this and nothing else, so nothing in THEM can
 * drift apart again. What this cannot promise is the layer ABOVE it: the
 * MCP SDK rewrites the argument object before a handler sees it, and it
 * drops a literal `__proto__` key, so that one body is refused on the route
 * and accepted as "no scope" through the tool. The refusal below is
 * therefore load-bearing on the SDK preserving unknown keys, which is
 * pinned by a test that drives a real client rather than this function.
 */

export type ParsedScope =
  | { ok: true; scope: TestRunScope }
  | { ok: false; error: string };

/** Short enough to read, long enough to recognise your own typo in. */
function clip(value: string): string {
  return value.length > 64 ? `${value.slice(0, 64)}...` : value;
}

/** Absent and null both mean "not asked for". Anything else must be right. */
function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

export function parseScope(body: unknown): ParsedScope {
  if (absent(body)) return { ok: true, scope: {} };
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "The request body must be an object." };
  }
  const raw = body as { scenario?: unknown; case_ids?: unknown };

  /* A FIELD WE DO NOT KNOW IS A REFUSAL, NOT A SHRUG. `caseIds`, `case_id`,
   * `scenarios`, a typo: each named something, none was read, and the scope
   * came out empty, which means everything. */
  const known = new Set(["scenario", "case_ids"]);
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    /* NAMED, BUT BOUNDED IN BOTH DIRECTIONS. The whole list used to be
     * echoed back, and capping only the COUNT left the size unbounded: one
     * 5000-character key name still produced a 5000-character error, which
     * is what the cap exists to prevent. The text goes to the caller's own
     * response and nowhere else, so this is about an error being readable
     * rather than about anything being stored. The first few names, each
     * short, are what somebody needs to find their typo. */
    const shown = unknown
      .slice(0, 5)
      .map(clip)
      .join(", ");
    const rest = unknown.length > 5 ? ` and ${unknown.length - 5} more` : "";
    return {
      ok: false,
      error: `Unknown field${unknown.length > 1 ? "s" : ""}: ${shown}${rest}. Use scenario or case_ids.`,
    };
  }

  /* Read as OWN properties. The refusal above already works on own keys,
   * but these reads followed the prototype chain, so an object whose
   * prototype carried a `case_ids` would have been read from it. The
   * direction was narrowing and therefore harmless, which is exactly the
   * kind of "harmless today" that the rest of this file is about. */
  const own = (k: string): unknown =>
    Object.prototype.hasOwnProperty.call(raw, k) ? (raw as Record<string, unknown>)[k] : undefined;
  const scenarioValue = own("scenario");
  const caseIdsValue = own("case_ids");
  const wantsScenario = !absent(scenarioValue);
  const wantsCaseIds = !absent(caseIdsValue);
  if (wantsScenario && wantsCaseIds) {
    return { ok: false, error: "Pass scenario or case_ids, not both." };
  }

  const scope: TestRunScope = {};

  if (wantsScenario) {
    if (typeof scenarioValue !== "string") {
      return { ok: false, error: "scenario must be a string." };
    }
    // Against the REGISTRY, not a list of planned keys: an unregistered key
    // selects nothing, and a run of nothing reports no failures.
    if (!scenario(scenarioValue)) {
      return {
        ok: false,
        // Bounded for the same reason the field names are: it is a value
        // the caller chose, and it comes straight back at them.
        error: `No scenario named ${clip(scenarioValue)}. Known scenarios: ${SCENARIOS.map((s) => s.key).join(", ")}.`,
      };
    }
    scope.scenario = scenarioValue;
  }

  if (wantsCaseIds) {
    if (!Array.isArray(caseIdsValue)) {
      return { ok: false, error: "case_ids must be an array of strings." };
    }
    const bad = caseIdsValue.filter((id) => typeof id !== "string");
    if (bad.length > 0) {
      // Refused rather than filtered. Dropping the bad ones silently runs a
      // different set than the caller named and tells them nothing.
      return { ok: false, error: "case_ids must be an array of strings." };
    }
    /* KEPT EVEN WHEN EMPTY. An empty list is a caller who named no case,
     * which selects nothing and is refused downstream as an empty scope.
     * Omitting the field here would mean "everything", which is how a
     * request for zero cases became a run of all of them. */
    scope.caseIds = caseIdsValue as string[];
  }

  return { ok: true, scope };
}
