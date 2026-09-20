/**
 * What a non-admin actually receives from an admin surface (SCRUM-302),
 * measured against a running gateway rather than asserted.
 *
 * THIS SUITE CORRECTED THE DESIGN. The spec claimed the refusal would be
 * "byte-identical to the page a URL that does not exist gives, because it IS
 * that page". Measured on a production build, that is false and cannot be
 * made true: a URL matching no route is answered from Next's PRERENDERED
 * not-found (ETag, Content-Length, x-nextjs-prerender), while a `notFound()`
 * thrown while rendering is streamed at request time (Transfer-Encoding, a
 * font/style preload `link` header) inside Next's `__next_error__` document.
 * No arrangement of our code changes that: one is a static asset and the
 * other is a render.
 *
 * So the property this pins is the one that is true and that the brief
 * actually asked for:
 *
 *   - the STATUS is 404, never 401 and never 403;
 *   - the COPY is the app's own 404 page, the same words an absent URL gets;
 *   - nothing in the response names the admin surface, states a permission,
 *     or renders dashboard chrome;
 *   - the refusal looks like every other runtime not-found in the app (a
 *     missing blog post gives the same document shell);
 *   - and the headers that DO differ are pinned to an exact list, so a change
 *     that widens the difference fails here instead of passing quietly.
 *
 * An attacker who knows Next can still tell a runtime 404 from a prerendered
 * one and learn that `/dashboard/admin` is a route. That is written down in
 * the report rather than papered over. It is worth little: this repo is
 * public and the path is in it.
 *
 * Env-gated, reports as SKIPPED with nothing set, read-only.
 *
 *   ADMIN_E2E_URL           a running gateway. Runs the suite with a cookie
 *                           that is present but not a real session, which the
 *                           middleware passes and no user resolves from. The
 *                           guard calls notFound() for no-session and for
 *                           wrong-role two lines apart, so the RENDERING is
 *                           the same call either way; what this cannot show
 *                           is that the role branch is reached.
 *   + ADMIN_E2E_ADMIN_COOKIE, ADMIN_E2E_USER_COOKIE
 *                           dtrmcp_session values for a role=admin and a
 *                           role=user account. Adds the role cases. Needs
 *                           migration 0018 to have run on that gateway's
 *                           database.
 *
 * Measure against a PRODUCTION build: `pnpm build` then run `dist/server.js`.
 * A dev server answers both cases dynamically and hides the difference above.
 */

import { describe, expect, it } from "vitest";

const BASE = process.env.ADMIN_E2E_URL;
const ADMIN_COOKIE = process.env.ADMIN_E2E_ADMIN_COOKIE;
const USER_COOKIE = process.env.ADMIN_E2E_USER_COOKIE;

/** Present, so the middleware lets it past (it checks that the cookie exists,
 * not that it is valid), and worthless, so no user resolves from it. */
const INVALID_COOKIE = "not-a-real-session";

const stamp = Date.now();
const NO_SUCH_PATH = `/dashboard/no-such-page-${stamp}`;
const ABSENT_BLOG_POST = `/blog/no-such-post-${stamp}`;
const ADMIN_PATH = "/dashboard/admin";

/** A line only the app's own 404 page renders. */
const NOT_FOUND_COPY = "This page does not exist";
/** A string only the dashboard chrome renders, checked by its own control. */
const CHROME_MARKER = "MCP config";

/**
 * The headers that differ, and why each is a consequence of "streamed" versus
 * "prerendered" rather than of "admin". Pinned as an exact set: a header that
 * joins this list is a header nobody decided to leak.
 */
// `transfer-encoding` is set on the wire but the fetch API does not expose
// it, so the visible difference is the preload header alone.
const ADMIN_ONLY_HEADERS = ["link"];
const ABSENT_ONLY_HEADERS = [
  "etag",
  "x-nextjs-cache",
  "x-nextjs-prerender",
  "x-nextjs-stale-time",
];
/** Differs per response and says nothing about which page answered. */
const VOLATILE = new Set(["date", "keep-alive", "connection"]);

function headerMap(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of res.headers) {
    const key = k.toLowerCase();
    if (!VOLATILE.has(key)) out[key] = v;
  }
  return out;
}

async function get(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie: `dtrmcp_session=${cookie}` } : {},
    redirect: "manual",
  });
  return { res, body: await res.text() };
}

describe.skipIf(!BASE)("what a non-admin gets from /dashboard/admin (SCRUM-302)", () => {
  it("is a 404, the same status a URL with no route gives", async () => {
    const admin = await get(ADMIN_PATH, INVALID_COOKIE);
    const nothing = await get(NO_SUCH_PATH, INVALID_COOKIE);
    expect(admin.res.status).toBe(404);
    expect(admin.res.status).toBe(nothing.res.status);
  });

  it("renders the app's own 404 copy, not a bare error document", async () => {
    // Before this ticket the app had no not-found.tsx, so a thrown notFound()
    // produced Next's built-in fallback and an absent URL produced a
    // different page. Adding the root boundary converged the COPY, which is
    // the half a person sees.
    const admin = await get(ADMIN_PATH, INVALID_COOKIE);
    const nothing = await get(NO_SUCH_PATH, INVALID_COOKIE);
    expect(admin.body).toContain(NOT_FOUND_COPY);
    expect(nothing.body).toContain(NOT_FOUND_COPY);
  });

  it("says nothing about admin, permissions or roles", async () => {
    // The disclosure that would actually matter. The echoed request path is
    // excluded: Next puts the requested URL in the streamed payload, and it
    // is the caller's own input handed back, present for absent URLs too.
    const { body } = await get(ADMIN_PATH, INVALID_COOKIE);
    // The segment appears escaped inside the streamed payload, so both the
    // bare and the backslash-escaped spelling are normalised away.
    const withoutEchoedPath = body.replace(/\\?"admin\\?"/g, '"SEGMENT"');
    expect(withoutEchoedPath.toLowerCase()).not.toContain("admin");
    expect(body.toLowerCase()).not.toMatch(/forbidden"|not authori|permission|role/);
  });

  it("does not render the dashboard chrome", async () => {
    const { body } = await get(ADMIN_PATH, INVALID_COOKIE);
    expect(body).not.toContain(CHROME_MARKER);
  });

  it("looks like every other runtime not-found in the app", async () => {
    // A missing blog post is an ordinary "this resource is not here" answer
    // that no one considers sensitive. The admin refusal is the same shape,
    // so what a prober learns is "this is a dynamic route", not "this is the
    // admin area".
    const admin = await get(ADMIN_PATH, INVALID_COOKIE);
    const post = await get(ABSENT_BLOG_POST);
    expect(admin.res.status).toBe(post.res.status);
    expect(admin.body.slice(0, 60)).toBe(post.body.slice(0, 60));
  });

  it("differs from an absent URL in exactly the known, pinned ways", async () => {
    // The honest negative. These differences are prerendered-versus-streamed,
    // and the test exists so that the set cannot grow unnoticed.
    const admin = headerMap((await get(ADMIN_PATH, INVALID_COOKIE)).res);
    const nothing = headerMap((await get(NO_SUCH_PATH, INVALID_COOKIE)).res);

    expect(Object.keys(admin).filter((k) => !(k in nothing)).sort()).toEqual(ADMIN_ONLY_HEADERS);
    expect(Object.keys(nothing).filter((k) => !(k in admin)).sort()).toEqual(ABSENT_ONLY_HEADERS);

    // Everything they share must agree in value, content type and cache
    // directives included.
    for (const key of Object.keys(admin)) {
      if (key in nothing) expect([key, admin[key]]).toEqual([key, nothing[key]]);
    }
  });

  it("an anonymous request bounces to login exactly as a sibling path does", async () => {
    const admin = await get(ADMIN_PATH);
    const sibling = await get("/dashboard/usage");
    expect(admin.res.status).toBe(sibling.res.status);
    const a = new URL(admin.res.headers.get("location")!, BASE);
    const b = new URL(sibling.res.headers.get("location")!, BASE);
    expect(a.pathname).toBe("/auth/login");
    expect(a.pathname).toBe(b.pathname);
    expect([...a.searchParams.keys()]).toEqual([...b.searchParams.keys()]);
  });
});

describe.skipIf(!BASE || !ADMIN_COOKIE || !USER_COOKIE)(
  "and the role branch is the one being taken (SCRUM-302)",
  () => {
    it("a real signed-in non-admin gets that same 404", async () => {
      const { res, body } = await get(ADMIN_PATH, USER_COOKIE);
      expect(res.status).toBe(404);
      expect(body).toContain(NOT_FOUND_COPY);
    });

    it("an admin gets the page", async () => {
      // Guards every 404 case above against passing because the route is
      // broken for everybody, which would be the right answer for the wrong
      // reason.
      const { res, body } = await get(ADMIN_PATH, ADMIN_COOKIE);
      expect(res.status).toBe(200);
      expect(body).toContain("Admin");
    });

    it("CONTROL: the dashboard-chrome marker really is in a dashboard page", async () => {
      // Without this, "the 404 does not contain the chrome marker" passes for
      // a marker no page has rendered since somebody renamed a nav item.
      const { res, body } = await get("/dashboard/usage", ADMIN_COOKIE);
      expect(res.status).toBe(200);
      expect(body).toContain(CHROME_MARKER);
    });
  }
);
