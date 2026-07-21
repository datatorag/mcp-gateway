import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "./session";
import { logAndGenericError } from "./errors";
import { dashboardApiLimiter } from "@/gateway/usage/rate-limit";

/**
 * The one wrapper every session-gated dashboard API route goes through:
 * session guard (401), per-user rate limit (429 + Retry-After), and a
 * catch-all that maps unhandled throws to a generic 500 so a raw
 * Error.message can never leak to a public client. Route params flow
 * through as `ctx` untouched for `[slug]`-style routes.
 *
 * Streaming routes (SSE) work too — the wrapper only awaits the handler's
 * Response; it doesn't buffer the body.
 */
export function withRoute<Ctx = unknown>(
  handler: (userId: string, req: NextRequest, ctx: Ctx) => Promise<Response>,
  opts?: { logContext?: string }
) {
  // ctx optional so routes without params typecheck against Next's
  // generated validator; at runtime Next always passes both.
  return async (req: NextRequest, ctx?: Ctx): Promise<Response> => {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const check = dashboardApiLimiter.check(userId);
    if (!check.ok) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(check.retryAfterMs / 1000)),
          },
        }
      );
    }
    try {
      return await handler(userId, req, ctx as Ctx);
    } catch (err) {
      return NextResponse.json(
        {
          error: logAndGenericError(
            opts?.logContext ?? "[api] unhandled route error",
            err
          ),
        },
        { status: 500 }
      );
    }
  };
}
