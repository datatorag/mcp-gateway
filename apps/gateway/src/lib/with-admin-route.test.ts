/**
 * `withAdminRoute` (SCRUM-302). The claims under test are all about what a
 * caller who should not be here can LEARN, so most of these assert the shape
 * of a refusal rather than that one happened.
 *
 * The refusal is Next's own not-found, thrown, not a hand-built 404 body. A
 * constructed body would have to be kept byte-identical to the app's real 404
 * by hand forever; throwing hands the job to the framework, so the two cannot
 * drift. `e2e/admin-404.e2e.test.ts` measures that they are in fact identical
 * on a live server, which is the half a unit test cannot see.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const getSessionUserId = vi.fn();
vi.mock("./session", () => ({ getSessionUserId: () => getSessionUserId() }));

const isAdmin = vi.fn();
vi.mock("@/gateway/admin", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));

vi.mock("./db", () => ({ db: {} }));

vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ GATEWAY_BASE_URL: "https://gateway.example" }),
}));

import { withAdminRoute, sameOriginWrite } from "./with-admin-route";

/** The digest Next itself matches on to render the not-found page. */
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

async function expectNotFound(run: () => Promise<Response>): Promise<void> {
  let thrown: unknown;
  let returned: Response | undefined;
  try {
    returned = await run();
  } catch (err) {
    thrown = err;
  }
  // A returned Response would mean the wrapper built its own 404, which is
  // the thing this design refuses to do.
  expect(returned, "refused by returning a response instead of Next's not-found").toBeUndefined();
  expect((thrown as { digest?: string })?.digest).toBe(NOT_FOUND_DIGEST);
}

function req(init?: { method?: string; origin?: string | null; contentType?: string | null }): NextRequest {
  const headers = new Headers();
  if (init?.origin) headers.set("origin", init.origin);
  if (init?.contentType) headers.set("content-type", init.contentType);
  return { method: init?.method ?? "GET", headers } as unknown as NextRequest;
}

const ok = async () => new Response("handler ran", { status: 200 });

let userSeq = 0;
/** A fresh id per test: the rate limiter is a real module singleton keyed by
 * user, so a shared id would leak one test's requests into the next. */
function freshUser(): string {
  return `user-${++userSeq}-${Math.random().toString(36).slice(2)}`;
}

beforeEach(() => {
  getSessionUserId.mockReset();
  isAdmin.mockReset();
});

describe("withAdminRoute refuses with the app's own 404", () => {
  it("no session: not-found, and the handler never runs", async () => {
    getSessionUserId.mockResolvedValue(null);
    const handler = vi.fn(ok);
    await expectNotFound(() => withAdminRoute(handler)(req()));
    expect(handler).not.toHaveBeenCalled();
    // It must not even ask about the role: there is nobody to ask about.
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("signed in, role user: not-found, and the handler never runs", async () => {
    getSessionUserId.mockResolvedValue(freshUser());
    isAdmin.mockResolvedValue(false);
    const handler = vi.fn(ok);
    await expectNotFound(() => withAdminRoute(handler)(req()));
    expect(handler).not.toHaveBeenCalled();
  });

  it("an admin gets through", async () => {
    getSessionUserId.mockResolvedValue(freshUser());
    isAdmin.mockResolvedValue(true);
    const res = await withAdminRoute(ok)(req());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("handler ran");
  });

  it("authenticates by cookie only: an Authorization bearer is nobody here", async () => {
    // getSessionUserId reads dtrmcp_session and nothing else, so a live API
    // key that opens /mcp resolves to no user at all on this surface. The
    // header is set to prove the wrapper does not consult it.
    getSessionUserId.mockResolvedValue(null);
    const headers = new Headers({ authorization: "Bearer dtr_live_key_value" });
    const request = { method: "GET", headers } as unknown as NextRequest;
    await expectNotFound(() => withAdminRoute(ok)(request));
  });
});

describe("the rate limiter is behind the role check", () => {
  it("a non-admin past the limit still gets not-found, never 429", async () => {
    // The whole point: a 429 on a path only admin routes have would say the
    // path exists. Well past the limit of 120 in the window.
    const userId = freshUser();
    getSessionUserId.mockResolvedValue(userId);
    isAdmin.mockResolvedValue(false);
    const route = withAdminRoute(ok);
    for (let i = 0; i < 200; i++) {
      await expectNotFound(() => route(req()));
    }
  });

  it("an admin past the limit gets 429 with Retry-After", async () => {
    getSessionUserId.mockResolvedValue(freshUser());
    isAdmin.mockResolvedValue(true);
    const route = withAdminRoute(ok);
    let limited: Response | undefined;
    for (let i = 0; i < 200; i++) {
      const res = await route(req());
      if (res.status === 429) {
        limited = res;
        break;
      }
    }
    expect(limited, "an admin was never rate limited").toBeDefined();
    expect(limited!.headers.get("Retry-After")).toMatch(/^\d+$/);
  });
});

describe("cross-site writes", () => {
  const good = { method: "POST", origin: "https://gateway.example", contentType: "application/json" };

  beforeEach(() => {
    getSessionUserId.mockResolvedValue(freshUser());
    isAdmin.mockResolvedValue(true);
  });

  it("a same-origin JSON POST from an admin goes through", async () => {
    const res = await withAdminRoute(ok)(req(good));
    expect(res.status).toBe(200);
  });

  it.each([
    ["a foreign origin", { ...good, origin: "https://evil.example" }],
    ["no origin at all", { ...good, origin: null }],
    ["a form content type a cross-site form can actually send", { ...good, contentType: "application/x-www-form-urlencoded" }],
    ["text/plain, the other content type a simple request may carry", { ...good, contentType: "text/plain" }],
    ["no content type", { ...good, contentType: null }],
  ])("%s: not-found, and the handler never runs", async (_label, init) => {
    const handler = vi.fn(ok);
    await expectNotFound(() => withAdminRoute(handler)(req(init)));
    expect(handler).not.toHaveBeenCalled();
  });

  it("a JSON content type with a charset parameter is still JSON", async () => {
    const res = await withAdminRoute(ok)(req({ ...good, contentType: "application/json; charset=utf-8" }));
    expect(res.status).toBe(200);
  });

  it("GET and HEAD carry no origin requirement", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await withAdminRoute(ok)(req({ method }));
      expect(res.status).toBe(200);
    }
  });

  it("the origin compared against is the configured one, not the request's own Host", async () => {
    // A Host header is client-controlled, so trusting it would make the check
    // decorative. sameOriginWrite reads only the config and the Origin header.
    const headers = new Headers({
      origin: "https://evil.example",
      "content-type": "application/json",
      host: "evil.example",
    });
    expect(sameOriginWrite({ method: "POST", headers } as unknown as NextRequest)).toBe(false);
  });
});

describe("a handler's own control flow and faults", () => {
  beforeEach(() => {
    getSessionUserId.mockResolvedValue(freshUser());
    isAdmin.mockResolvedValue(true);
  });

  it("a notFound() thrown by the handler is control flow, not a 500", async () => {
    const { notFound } = await import("next/navigation");
    await expectNotFound(() => withAdminRoute(async () => notFound())(req()));
  });

  it("a real throw becomes a generic 500 that does not echo the message", async () => {
    const secret = "connect ECONNREFUSED 10.0.0.5:5432";
    const res = await withAdminRoute(async () => {
      throw new Error(secret);
    })(req());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(secret);
  });
});
