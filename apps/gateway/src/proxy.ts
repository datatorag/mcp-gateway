import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PATHS = ["/dashboard"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PROTECTED_PATHS.some((p) => pathname.startsWith(p))) {
    const session = request.cookies.get("dtrmcp_session");
    if (!session?.value) {
      const loginUrl = new URL("/auth/login", request.url);
      // PATH AND QUERY (SCRUM-223). The campaign's deep link is
      // /dashboard/agent?skill=<slug>; carrying only the pathname landed a
      // signed-out click on a generic agent page after login, which is the
      // one outcome the funnel cannot survive. The value is re-validated at
      // every hop (resolveNextPath), so carrying the query adds no trust.
      loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
