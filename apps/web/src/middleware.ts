import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TOKEN_COOKIE = "kf_token";

/**
 * Edge gate for all `/app/*` routes.
 *
 * This is the fast-path: if the auth token cookie is missing, bounce the user
 * to the login page before the client bundle even loads. It intentionally does
 * NOT validate the token signature here (that would require a round-trip or a
 * full JWT verification library in the edge runtime); the client-side
 * `<RequireAuth>` component performs the real server validation on mount.
 */
export function middleware(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  if (token) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const from = encodeURIComponent(pathname + (request.nextUrl.search || ""));
  const loginUrl = new URL(`/auth/login?from=${from}`, request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/app/:path*"],
};
