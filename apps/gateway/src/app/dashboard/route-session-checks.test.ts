/**
 * Does every dashboard route that renders something check the session?
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. The middleware gates `/dashboard/*` on
 * the session cookie being PRESENT rather than valid, so a made-up non-empty
 * value walks past it and the per-page checks are what actually protect these
 * routes. That makes "which routes check?" a security question with a
 * different answer every time someone adds a page.
 *
 * It was answered wrong three times in a row while this branch was written:
 * a commit message claimed four routes were consistent, a review found a fifth
 * that was unchecked, enumerating found a sixth as well, and a code comment
 * shipped repeating the original wrong count. Every one of those was a person
 * asserting a property of a SET without listing the set. So the list is
 * computed here instead of remembered anywhere.
 *
 * A new dashboard page now fails this test until it either checks the session
 * or is added to EXEMPT with a reason. That is the point: the default for a
 * new route is protected, and the exception has to be argued for.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DASHBOARD_DIR = join(import.meta.dirname, ".");

/** Routes that legitimately do not resolve a session, with the reason.
 *
 * Only a route that renders NOTHING belongs here. A route that returns markup
 * to an unauthenticated visitor does not, however harmless the markup looks
 * today, because "harmless" is a property of the current contents rather than
 * of the route. */
const EXEMPT: Record<string, string> = {
  "connections/page.tsx":
    "Body is a bare redirect to /dashboard, which checks. No render path, no data access.",
};

/** Source with comments removed.
 *
 * NOT COSMETIC. Every checked page in this directory carries a comment block
 * explaining the check, and those comments quote `getSessionUserId()` and
 * `redirect("/auth/login")` verbatim. A substring search over raw source
 * therefore passes on a page that copied the EXPLANATION and not the CALL,
 * which is the single most likely way a new route arrives unprotected: someone
 * pastes a neighbouring page as a starting point. The guard would have been
 * satisfied by its own documentation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every `page.tsx` under this directory, relative to it. */
function findPages(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findPages(full, prefix ? `${prefix}/${entry}` : entry));
    } else if (entry === "page.tsx") {
      out.push(prefix ? `${prefix}/${entry}` : entry);
    }
  }
  return out.sort();
}

const pages = findPages(DASHBOARD_DIR);

describe("dashboard routes resolve the session for themselves", () => {
  it("finds the routes at all", () => {
    // A walker that silently matches nothing would make every assertion below
    // vacuously true, which is the failure mode this whole file exists to
    // prevent. Assert the search works before trusting what it reports.
    expect(pages.length).toBeGreaterThan(4);
    expect(pages).toContain("page.tsx");
    expect(pages).toContain("agent/page.tsx");
  });

  it.each(pages)("%s checks the session, or is a declared exception", (page) => {
    const code = stripComments(readFileSync(join(DASHBOARD_DIR, page), "utf8"));
    // The CALL, not the words. `await getSessionUserId()` has to be invoked and
    // its result has to gate a redirect, so quoting the pattern in prose does
    // not satisfy it and neither does importing the helper and ignoring it.
    const checks =
      /await\s+getSessionUserId\s*\(/.test(code) &&
      /if\s*\(\s*!\s*\w+\s*\)\s*redirect\(\s*["']\/auth\/login["']\s*\)/.test(code);
    if (EXEMPT[page]) {
      // An exemption that has quietly started rendering is worse than no
      // exemption, because the list says it was considered. Checked against
      // comment-stripped source so a `<` in prose cannot trip it.
      expect(
        code.includes("<"),
        `${page} is exempt as a non-rendering redirect but now returns markup; re-check it`
      ).toBe(false);
      return;
    }
    expect(
      checks,
      `${page} renders without resolving a session. The middleware only checks that the ` +
        `session cookie is PRESENT, not that it is valid, so this route is reachable with a ` +
        `forged cookie. Add getSessionUserId() + redirect("/auth/login"), or add it to EXEMPT ` +
        `with a reason if it genuinely renders nothing.`
    ).toBe(true);
  });

  it("is not satisfied by a page that only TALKS about checking", () => {
    // The hazard this guard nearly shipped with. Every checked page carries a
    // comment quoting the exact call, so a route pasted from a neighbour and
    // then stripped of its logic would have passed a substring search. Pinned
    // with a synthetic source rather than a real file, so it keeps testing the
    // detector even after every page in the tree is correct.
    const commentOnly = `
      /** Calls getSessionUserId() and does redirect("/auth/login") when absent. */
      // const userId = await getSessionUserId();
      export default function Page() { return <div/>; }
    `;
    const code = stripComments(commentOnly);
    expect(code).not.toContain("getSessionUserId");
    expect(/await\s+getSessionUserId\s*\(/.test(code)).toBe(false);

    // ...and that a real check still matches, so the tightening did not just
    // make the guard reject everything.
    const real = stripComments(`
      export default async function Page() {
        const userId = await getSessionUserId();
        if (!userId) redirect("/auth/login");
        return <div/>;
      }
    `);
    expect(/await\s+getSessionUserId\s*\(/.test(real)).toBe(true);
    expect(
      /if\s*\(\s*!\s*\w+\s*\)\s*redirect\(\s*["']\/auth\/login["']\s*\)/.test(real)
    ).toBe(true);
  });

  it("has no stale exemptions", () => {
    // An exemption for a route that no longer exists reads as coverage for
    // something nobody is checking.
    for (const page of Object.keys(EXEMPT)) {
      expect(pages, `EXEMPT lists ${page}, which no longer exists`).toContain(page);
    }
  });
});
