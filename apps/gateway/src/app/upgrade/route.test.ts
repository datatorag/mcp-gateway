import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * This file exists because the first version of this route shipped broken and
 * the suite was silent about it.
 *
 * It built its target with `new URL("/pricing", request.url)`, which is correct
 * in development and wrong in production: the CDN terminates the public origin
 * upstream, so `request.url` is the INTERNAL address and the redirect resolved
 * to localhost. The "get more runs" control was a dead link the moment it went
 * live, and nothing failed — the handler returned a perfectly valid 307 to a
 * host no user can reach.
 *
 * A unit test that asserted "redirects to /pricing" would have passed on the
 * broken version too. So these assert the property that actually differed:
 * the target must not be absolute.
 */

describe("GET /upgrade", () => {
  it("redirects to the plans page", () => {
    const res = GET();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/pricing");
  });

  it("uses a RELATIVE target, so no origin can leak into it", () => {
    // The whole bug in one assertion. A relative target is resolved by the
    // browser against the address the user actually typed, so it cannot carry
    // an internal hostname and cannot depend on how many proxies sit in front
    // of this process.
    const location = GET().headers.get("location") ?? "";
    expect(location.startsWith("/")).toBe(true);
    expect(location).not.toMatch(/^https?:\/\//);
    expect(location).not.toContain("localhost");
  });

  it("takes no request-derived input at all", () => {
    // Nothing about the response may vary with the request. When this becomes
    // a real checkout redirect it will need an absolute external URL, and that
    // one must come from configured origin — never from `request.url`, for
    // exactly the reason above.
    expect(GET.length).toBe(0);
  });
});
