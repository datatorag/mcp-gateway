import { NextRequest, NextResponse } from "next/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { getEnv } from "@datatorag-mcp/config";
import { getSessionUserId } from "./session";
import { logAndGenericError } from "./errors";
import { db } from "./db";
import { isAdmin } from "@/gateway/admin";
import { dashboardApiLimiter } from "@/gateway/usage/rate-limit";

/**
 * The wrapper every admin JSON route goes through (SCRUM-302).
 *
 * NOT a layer on top of `withRoute`, and the reason is the ORDER of the
 * checks. `withRoute` rate-limits every signed-in user before the handler
 * runs, so an admin route built on it would answer a non-admin with 429 once
 * they went past the limit — a status that a path which does not exist never
 * gives, on paths only admin routes have. That difference names the path. So
 * the checks run session, role, cross-site, THEN the limiter, and only a real
 * admin can ever reach the limiter.
 *
 * Refusals call `notFound()`, which hands off to Next and renders the app's
 * own 404. Not an imitation of it: the same page, the same headers, because
 * it is the same code path a URL with no route takes. Measured on a running
 * gateway, an unknown `/api/*` path and a `notFound()` from a route handler
 * differ only in a per-request React token that also differs between two
 * requests to the same unknown path. `e2e/admin-404.e2e.test.ts` re-measures
 * it against a live server.
 *
 * Never 401 and never 403: both say "there is something here".
 *
 * Admin routes are COOKIE-ONLY. `getSessionUserId` reads `dtrmcp_session`
 * and nothing else, so an API key or an OAuth bearer in an `Authorization`
 * header authenticates nobody here, whatever it can open on `/mcp`.
 */
export function withAdminRoute<Ctx = unknown>(
  handler: (userId: string, req: NextRequest, ctx: Ctx) => Promise<Response>,
  opts?: { logContext?: string }
) {
  return async (req: NextRequest, ctx?: Ctx): Promise<Response> => {
    const userId = await getSessionUserId();
    if (!userId) notFound();

    if (!(await isAdmin(db, userId))) notFound();

    if (!sameOriginWrite(req)) notFound();

    const check = dashboardApiLimiter.check(userId);
    if (!check.ok) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(check.retryAfterMs / 1000)) },
        }
      );
    }

    try {
      return await handler(userId, req, ctx as Ctx);
    } catch (err) {
      // A handler's own notFound()/redirect() is control flow, not a fault:
      // without this it would be reported as a 500 and logged as an error.
      unstable_rethrow(err);
      return NextResponse.json(
        {
          error: logAndGenericError(
            opts?.logContext ?? "[api] unhandled admin route error",
            err
          ),
        },
        { status: 500 }
      );
    }
  };
}

/**
 * Cross-site protection for the state-changing methods.
 *
 * The session cookie is `SameSite=Lax`, which already keeps it off a
 * cross-site POST, and this does not lean on that alone: starting a test run
 * sends mail, so it is worth two independent barriers. A request that changes
 * state must carry an `Origin` equal to this gateway's own and a JSON content
 * type. A cross-origin form can send neither: forms cannot set a JSON content
 * type, and the browser sets `Origin` itself.
 *
 * The origin compared against is the CONFIGURED one, never the request's own
 * `Host` header, which a client controls.
 *
 * A missing `Origin` is refused too. Same-origin `fetch` from the dashboard
 * sends it; the callers that do not are non-browser clients, and those have
 * no session cookie to ride on in the first place.
 */
export function sameOriginWrite(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return true;

  const origin = req.headers.get("origin");
  if (!origin) return false;

  let expected: string;
  try {
    expected = new URL(getEnv().GATEWAY_BASE_URL).origin;
  } catch {
    return false;
  }
  if (origin !== expected) return false;

  const contentType = req.headers.get("content-type") ?? "";
  return contentType.split(";")[0].trim().toLowerCase() === "application/json";
}
