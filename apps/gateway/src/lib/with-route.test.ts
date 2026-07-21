import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const getSessionUserId = vi.fn();
vi.mock("./session", () => ({
  getSessionUserId: () => getSessionUserId(),
}));

const check = vi.fn();
vi.mock("@/gateway/usage/rate-limit", () => ({
  dashboardApiLimiter: { check: (id: string) => check(id) },
}));

import { withRoute } from "./with-route";

const req = {} as NextRequest;

describe("withRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserId.mockResolvedValue("user-1");
    check.mockReturnValue({ ok: true });
  });

  it("401s with the standard envelope when there is no session", async () => {
    getSessionUserId.mockResolvedValue(null);
    const handler = vi.fn();
    const res = await withRoute(handler)(req, undefined);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("429s with Retry-After when the per-user limiter rejects", async () => {
    check.mockReturnValue({ ok: false, retryAfterMs: 3200 });
    const res = await withRoute(vi.fn())(req, undefined);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("4");
  });

  it("passes userId, request, and route context through to the handler", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("ok"));
    const ctx = { params: Promise.resolve({ slug: "gws" }) };
    await withRoute<typeof ctx>(handler)(req, ctx);
    expect(handler).toHaveBeenCalledWith("user-1", req, ctx);
    expect(check).toHaveBeenCalledWith("user-1");
  });

  it("maps an unhandled throw to a generic 500 — never the raw Error.message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await withRoute(async () => {
      throw new Error("pg: connection to 10.0.0.5 refused");
    })(req, undefined);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("10.0.0.5");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
