import type { TestCase } from "../types";

/**
 * Every registered case (SCRUM-303).
 *
 * Phase 2 ships the engine with NO cases, deliberately: the engine is proven
 * against fake cases in its own tests, and a suite of real cases added in the
 * same change as the machinery that runs them makes a failure ambiguous
 * between the two. The first run against a real gateway therefore reports
 * every served tool as uncovered, which is the honest starting number.
 *
 * A case is added by writing its module under this directory and listing it
 * here. `registry.test.ts` asserts the list and the directory agree, so a
 * file that is never listed fails rather than silently not running.
 */
export const CASES: TestCase[] = [];
