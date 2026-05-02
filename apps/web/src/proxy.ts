import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "kf_token";
const LOGIN_PATH = "/auth/login";

/**
 * Edge middleware that gates `/app/*` routes. This is the *fast-path*
 * defence — purely a presence check on the `kf_token` cookie. No JWT
 * verification happens here; the authoritative check is the second-line
 * <RequireAuth> client provider, which calls `/identity/me` and reacts
 * to a real 401 from the API.
 *
 * The cookie is written by `setStoredToken()` in `apps/web/src/lib/workspace.ts`
 * alongside the localStorage write that the fetch wrappers actually use for
 * the Authorization header.
 *
 * If the cookie is absent the user is redirected to `/auth/login?from=<path>`
 * so they land back on the same screen after signing in.
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (req.cookies.get(TOKEN_COOKIE)?.value) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = "";
  url.searchParams.set("from", pathname + (search || ""));
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/app/:path*",
  ],
};
