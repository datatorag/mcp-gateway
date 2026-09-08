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

  it("lets a request with a session cookie through untouched", () => {
    const req = new NextRequest("http://localhost/dashboard/agent?skill=morning-brief", {
      headers: { cookie: "dtrmcp_session=abc" },
    });
    const res = proxy(req);
    expect(res.headers.get("location")).toBeNull();
  });
});
