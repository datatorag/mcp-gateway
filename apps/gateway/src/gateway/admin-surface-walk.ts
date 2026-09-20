import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The rule that every admin surface is guarded, written as a walk over the
 * source tree rather than as a habit (SCRUM-302).
 *
 * Two surfaces, two different mechanisms, so two different checks:
 *
 * - PAGES need BOTH the layout guard and their own, and that is a measured
 *   requirement rather than belt and braces. A server layout and the page
 *   beneath it render CONCURRENTLY: when the layout threw notFound(), the
 *   page had already produced its markup, and Next shipped that markup inside
 *   the 404's streamed payload. A non-admin received the admin page's content
 *   with a 404 in front of it. So the layout is the net that catches a page
 *   which forgot, and the page's own `await requireAdminPage()` is the thing
 *   that stops it rendering. Either one alone is a hole.
 * - ROUTES have no layout. Each `route.ts` under `api/admin` is on its own,
 *   so every exported HTTP method has to be wrapped by `withAdminRoute`. This
 *   is the half that actually rots: it is one forgotten wrapper per file.
 *
 * Pure and parameterised by directory so the test can point it at fixture
 * trees that break each rule. A walker only ever run against the real tree
 * proves nothing about what it would catch.
 *
 * FILE MATCHING IS BY ROLE, NOT BY ONE SPELLING. An earlier version matched
 * the literal names `page.tsx` and `route.ts`, which left `page.jsx`,
 * `route.js` and a parallel-route `default.tsx` invisible to it — and since
 * `route-session-checks.test.ts` hands this module the whole admin subtree,
 * a file with any of those names would have been checked by nothing at all.
 * The repo only writes `.tsx`/`.ts` today, so this is about the next hole
 * rather than a present one.
 */

export type GuardViolation = { file: string; problem: string };

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Every extension Next will route from. */
/** Files that RENDER a segment: a page, and `default.tsx`, which is what a
 * parallel-route slot falls back to. Both put markup on screen, so both need
 * the guard. */
const RENDERS = /^(page|default)\.(tsx|ts|jsx|js|mjs)$/;
/** Files that ANSWER a request as JSON. */
const HANDLES = /^route\.(tsx|ts|jsx|js|mjs)$/;

/** Line and block comments removed, so prose quoting a guard never satisfies
 * a search for one. Same reasoning as `route-session-checks.test.ts`, and the
 * same honest limit: this is a regex, not a parser. It is aimed at omission,
 * not at an author working to defeat it. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, match: (entry: string) => boolean, prefix = ""): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...walk(full, match, rel));
    else if (match(entry)) out.push(rel);
  }
  return out.sort();
}

/** Every rendering file under `adminDir`, relative to it. */
export function findAdminPages(adminDir: string): string[] {
  return walk(adminDir, (e) => RENDERS.test(e));
}

/** Every request-handling file under `apiAdminDir`, relative to it. */
export function findAdminRoutes(apiAdminDir: string): string[] {
  return walk(apiAdminDir, (e) => HANDLES.test(e));
}

/** The admin layout, whatever extension it is written in. */
function readLayout(adminDir: string): string | null {
  for (const ext of ["tsx", "ts", "jsx", "js", "mjs"]) {
    try {
      return readFileSync(join(adminDir, `layout.${ext}`), "utf8");
    } catch {
      // try the next spelling
    }
  }
  return null;
}

/** The CALL, awaited. Importing the guard without invoking it, or naming it
 * in a comment, does not count. */
function awaitsGuard(source: string): boolean {
  return /await\s+requireAdminPage\s*\(/.test(stripComments(source));
}

/**
 * Violations of the page rule: the layout at the root of the admin subtree
 * must await the guard, AND so must every page under it. See the note at the
 * top of this file for why one without the other is a hole.
 */
export function checkAdminPages(adminDir: string): GuardViolation[] {
  const pages = findAdminPages(adminDir);
  if (pages.length === 0) return [];

  const out: GuardViolation[] = [];

  const layout = readLayout(adminDir);
  if (layout === null) {
    return [
      {
        file: "layout.tsx",
        problem:
          "no layout at the root of the admin subtree, so nothing catches a page that forgot its own guard",
      },
    ];
  }
  if (!awaitsGuard(layout)) {
    out.push({
      file: "layout.tsx",
      problem: "the admin layout does not await requireAdminPage()",
    });
  }

  for (const page of pages) {
    if (!awaitsGuard(readFileSync(join(adminDir, page), "utf8"))) {
      out.push({
        file: page,
        problem:
          "does not await requireAdminPage() itself; the layout guard alone does not stop a page rendering, and its markup ships inside the 404",
      });
    }
  }
  return out;
}

/**
 * Violations of the route rule: every exported HTTP method in every
 * `route.ts` under the admin API subtree is assigned from a `withAdminRoute(`
 * call. `withRoute` is named explicitly as wrong here rather than just
 * "unwrapped", because it is the plausible mistake: it is the wrapper every
 * other route in the app uses, and it answers 401 and 429 where an admin
 * route must answer 404.
 */
/**
 * Is this exported method wrapped, directly or through one local delegate?
 *
 * The delegate form is not a convenience: `withAdminRoute` takes its route
 * context optionally so that param-less routes typecheck, and Next's route
 * validator rejects that shape on a dynamic segment. So a `[id]` route has
 * to re-export with the context required, exactly as `/api/keys/[id]` does.
 *
 * The delegation is followed rather than waved through: the local name the
 * export forwards to must itself be assigned from `withAdminRoute(`, so an
 * export that forwards to a bare handler still fails.
 */
function methodIsGuarded(code: string, method: string): boolean {
  if (new RegExp(`export\\s+const\\s+${method}\\s*=\\s*withAdminRoute\\s*\\(`).test(code)) return true;

  const delegated = new RegExp(
    `export\\s+const\\s+${method}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*(\\w+)\\s*\\(`
  ).exec(code);
  if (!delegated) return false;

  const local = delegated[1];
  return new RegExp(`const\\s+${local}\\s*=\\s*withAdminRoute\\s*(?:<[^>]*>)?\\s*\\(`).test(code);
}

export function checkAdminRoutes(apiAdminDir: string): GuardViolation[] {
  const out: GuardViolation[] = [];
  for (const file of findAdminRoutes(apiAdminDir)) {
    const code = stripComments(readFileSync(join(apiAdminDir, file), "utf8"));
    const exported = HTTP_METHODS.filter((m) =>
      new RegExp(`export\\s+const\\s+${m}\\b`).test(code) ||
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(code)
    );
    if (exported.length === 0) {
      out.push({ file, problem: "exports no HTTP method; is it a route at all?" });
      continue;
    }
    for (const method of exported) {
      if (!methodIsGuarded(code, method)) {
        out.push({
          file,
          problem: `${method} is not exported as withAdminRoute(...): an admin route must refuse with the app's 404, which withRoute and a bare handler do not`,
        });
      }
    }
  }
  return out;
}
