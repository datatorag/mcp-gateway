import { NextResponse } from "next/server";
import { getSessionUserId } from "./session";
import { dashboardApiLimiter } from "@/gateway/usage/rate-limit";

export function withRateLimit(
  handler: (userId: string, req: Request) => Promise<Response>
) {
  return async (req: Request): Promise<Response> => {
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
    return handler(userId, req);
  };
}
