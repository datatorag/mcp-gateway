/**
 * The admin-surface walk (SCRUM-302), proven against trees that BREAK each
 * rule as well as the real one.
 *
 * A walker only ever pointed at the real source tree is the classic green
 * test that checks nothing: it passes identically whether it is enforcing the
 * rule or silently matching no files at all. So every rule here is shown
 * failing on a fixture first.
 *
 * Fixtures are built in a temp directory rather than committed. A fixture
 * `page.tsx` or `route.ts` under `src/app` would not be a fixture, it would
 * be a live route.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkAdminPages,
  checkAdminRoutes,
  findAdminPages,
  findAdminRoutes,
} from "./admin-surface-walk";

const made: string[] = [];

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "admin-walk-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

const GUARDED_LAYOUT = `import { requireAdminPage } from "@/gateway/admin-page";
export default async function L({ children }) { await requireAdminPage(); return children; }`;

const GUARDED_PAGE = `import { requireAdminPage } from "@/gateway/admin-page";
export default async function P() { await requireAdminPage(); return null; }`;
const UNGUARDED_PAGE = "export default function P() { return null; }";

describe("the page rule", () => {
  it("passes when the layout and every page await the guard, however deep", () => {
    const root = tree({
      "layout.tsx": GUARDED_LAYOUT,
      "page.tsx": GUARDED_PAGE,
      "tests/page.tsx": GUARDED_PAGE,
      "tests/[runId]/page.tsx": GUARDED_PAGE,
    });
    expect(findAdminPages(root)).toHaveLength(3);
    expect(checkAdminPages(root)).toEqual([]);
  });

  it("fails a page that leans on the layout alone", () => {
    // Measured, not theoretical: a layout and the page beneath it render
    // concurrently, so the page's markup was already in the 404's payload by
    // the time the layout's notFound() landed.
    const root = tree({
      "layout.tsx": GUARDED_LAYOUT,
      "page.tsx": GUARDED_PAGE,
      "tests/page.tsx": UNGUARDED_PAGE,
    });
    const [v] = checkAdminPages(root);
    expect(v.file).toBe("tests/page.tsx");
    expect(v.problem).toContain("does not await requireAdminPage() itself");
  });

  it("fails a page that only mentions the guard in a comment", () => {
    const root = tree({
      "layout.tsx": GUARDED_LAYOUT,
      "page.tsx": `// guarded: await requireAdminPage() runs in the layout
export default function P() { return null; }`,
    });
    expect(checkAdminPages(root)[0].problem).toContain("does not await requireAdminPage() itself");
  });

  it("fails when the layout is missing", () => {
    const root = tree({ "page.tsx": GUARDED_PAGE });
    expect(checkAdminPages(root)[0].problem).toContain("no layout at the root");
  });

  it("fails when the layout imports the guard but never calls it", () => {
    const root = tree({
      "layout.tsx": `import { requireAdminPage } from "@/gateway/admin-page";
export default async function L({ children }) { return children; }`,
      "page.tsx": GUARDED_PAGE,
    });
    expect(checkAdminPages(root)[0].problem).toContain("does not await requireAdminPage");
  });

  it("fails when the layout only MENTIONS the guard in a comment", () => {
    // The likeliest way this rots: someone pastes a neighbouring file for its
    // shape, keeps the explanation, and drops the call.
    const root = tree({
      "layout.tsx": `// guarded by await requireAdminPage() in this layout
/* await requireAdminPage(); */
export default async function L({ children }) { return children; }`,
      "page.tsx": GUARDED_PAGE,
    });
    expect(checkAdminPages(root)[0].problem).toContain("does not await requireAdminPage");
  });

  it.each(["page.jsx", "page.js", "default.tsx"])(
    "sees %s too, so no spelling of a rendering file escapes the rule",
    (filename) => {
      // The hole this closes: the walker used to match the literal name
      // page.tsx, and the dashboard session test hands it the whole admin
      // subtree, so a file with any other routable name was checked by
      // nothing at all.
      const root = tree({
        "layout.tsx": GUARDED_LAYOUT,
        "page.tsx": GUARDED_PAGE,
        [`slot/${filename}`]: UNGUARDED_PAGE,
      });
      expect(findAdminPages(root)).toContain(`slot/${filename}`);
      expect(checkAdminPages(root)[0].file).toBe(`slot/${filename}`);
    }
  );

  it("finds the layout whatever extension it is written in", () => {
    const root = tree({ "layout.jsx": GUARDED_LAYOUT, "page.tsx": GUARDED_PAGE });
    expect(checkAdminPages(root)).toEqual([]);
  });

  it("says nothing about a subtree with no pages yet", () => {
    expect(checkAdminPages(tree({}))).toEqual([]);
  });
});

describe("the route rule", () => {
  const WRAPPED = `import { withAdminRoute } from "@/lib/with-admin-route";
export const GET = withAdminRoute(async () => Response.json({}));`;

  it("passes when every exported method is wrapped", () => {
    const root = tree({
      "runs/route.ts": `import { withAdminRoute } from "@/lib/with-admin-route";
export const GET = withAdminRoute(async () => Response.json({}));
export const POST = withAdminRoute(async () => Response.json({}));`,
    });
    expect(findAdminRoutes(root)).toEqual(["runs/route.ts"]);
    expect(checkAdminRoutes(root)).toEqual([]);
  });

  it("fails on the plausible mistake: withRoute, the wrapper every other route uses", () => {
    const root = tree({
      "runs/route.ts": `import { withRoute } from "@/lib/with-route";
export const GET = withRoute(async () => Response.json({}));`,
    });
    const [v] = checkAdminRoutes(root);
    expect(v.file).toBe("runs/route.ts");
    expect(v.problem).toContain("GET is not exported as withAdminRoute");
  });

  it("fails on a bare exported handler", () => {
    const root = tree({
      "runs/route.ts": "export async function POST() { return Response.json({}); }",
    });
    expect(checkAdminRoutes(root)[0].problem).toContain("POST is not exported as withAdminRoute");
  });

  it("catches the second method when only the first is wrapped", () => {
    // One file, two exports, one forgotten: the exact shape of this rot.
    const root = tree({
      "runs/route.ts": `${WRAPPED}
export async function DELETE() { return Response.json({}); }`,
    });
    const problems = checkAdminRoutes(root).map((v) => v.problem);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("DELETE");
  });

  it("fails a route.ts that exports no method at all", () => {
    const root = tree({ "runs/route.ts": "const unused = 1;" });
    expect(checkAdminRoutes(root)[0].problem).toContain("exports no HTTP method");
  });

  it("is not fooled by a wrapper named only in a comment", () => {
    const root = tree({
      "runs/route.ts": `// export const GET = withAdminRoute(handler)
export async function GET() { return Response.json({}); }`,
    });
    expect(checkAdminRoutes(root)[0].problem).toContain("GET is not exported as withAdminRoute");
  });

  it.each(["route.js", "route.jsx"])("sees %s too", (filename) => {
    const root = tree({ [`runs/${filename}`]: "export async function GET() { return Response.json({}); }" });
    expect(findAdminRoutes(root)).toEqual([`runs/${filename}`]);
    expect(checkAdminRoutes(root)[0].problem).toContain("GET is not exported as withAdminRoute");
  });

  it("says nothing when there are no admin routes yet", () => {
    // True in SCRUM-302 and the reason the fixtures above exist: this rule
    // would otherwise be unproven until SCRUM-303 writes the first route.
    expect(checkAdminRoutes(tree({}))).toEqual([]);
  });
});

describe("the real source tree", () => {
  const adminPages = join(import.meta.dirname, "../app/dashboard/admin");
  const adminApi = join(import.meta.dirname, "../app/api/admin");

  it("has the admin page subtree, and it is guarded", () => {
    expect(findAdminPages(adminPages).length).toBeGreaterThan(0);
    expect(checkAdminPages(adminPages)).toEqual([]);
  });

  it("has no unguarded admin route", () => {
    expect(checkAdminRoutes(adminApi)).toEqual([]);
  });
});
