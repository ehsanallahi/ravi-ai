import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic redirect only: sends visitors without a session cookie to /login. It does NOT
 * authorize anything. Every page and action re-validates the session and membership on the
 * server (see server/tenancy), so a forged cookie gets no data.
 */
export function proxy(request: NextRequest) {
  const hasCookie = Boolean(getSessionCookie(request, { cookiePrefix: "ravi" }));
  if (!hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/o/:path*", "/dashboard", "/account/:path*"],
};
