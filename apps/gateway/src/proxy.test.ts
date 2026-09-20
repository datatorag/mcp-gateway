import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

/* SCRUM-223: the campaign's deep link is /dashboard/agent?skill=<slug>. A
 * signed-out click reaches this middleware first, and the whole funnel rests
 * on the bounce to login carrying the QUERY, not just the path: a `next` of
 * "/dashboard/agent" lands the user on a generic agent page after login and
 * the ad promised something the page did not do. */
describe("the dashboard gate carries the requested route into login", () => {
  it("keeps the query string in next for a signed-out request", () => {
    const res = proxy(
      new NextRequest("http://localhost/dashboard/agent?skill=morning-brief")
    );
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/login");
    expect(location.searchParams.get("next")).toBe(
      "/dashboard/agent?skill=morning-brief"
    );
  });

  it("carries a bare path unchanged", () => {
    const res = proxy(new NextRequest("http://localhost/dashboard/usage"));
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe(
      "/dashboard/usage"
    );
  });

  /* SCRUM-302: the admin subtree gets NO exception here, and that is the
   * decision, not an oversight. An earlier draft of the design had anonymous
   * requests fall through to a 404 so the path would not be confirmed by a
   * login bounce. It has the opposite effect: every other /dashboard path
   * bounces, so the one path that answers 404 is the one path worth probing.
   * These cases exist so that exception cannot be reintroduced quietly. */
  it.each([
    ["/dashboard/admin", "/dashboard/admin"],
    ["/dashboard/admin/tests", "/dashboard/admin/tests"],
    ["/dashboard/admin/tests/abc?filter=fail", "/dashboard/admin/tests/abc?filter=fail"],
  ])("bounces %s to login exactly as a sibling path does", (path, expected) => {
    const res = proxy(new NextRequest(`http://localhost${path}`));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/login");
    expect(location.searchParams.get("next")).toBe(expected);
  });

  it("answers an admin path and an ordinary one identically when signed out", () => {
    // The claim in full: not merely that both redirect, but that a prober
    // cannot tell the two apart from the response.
    const admin = proxy(new NextRequest("http://localhost/dashboard/admin"));
    const sibling = proxy(new NextRequest("http://localhost/dashboard/usage"));
    expect(admin.status).toBe(sibling.status);
    const a = new URL(admin.headers.get("location")!);
    const b = new URL(sibling.headers.get("location")!);
    expect(a.pathname).toBe(b.pathname);
    expect([...a.searchParams.keys()]).toEqual([...b.searchParams.keys()]);
  });

  it("lets a request with a session cookie through untouched", () => {
    const req = new NextRequest("http://localhost/dashboard/agent?skill=morning-brief", {
      headers: { cookie: "dtrmcp_session=abc" },
    });
    const res = proxy(req);
    expect(res.headers.get("location")).toBeNull();
  });
});
