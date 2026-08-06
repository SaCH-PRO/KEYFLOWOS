import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "kf_token";
const LOGIN_PATH = "/auth/login";

/**
 * Decode a base64url-encoded JWT segment. Edge middleware has atob but not
 * Buffer, so we do the base64url → base64 conversion manually.
 */
function base64UrlDecode(segment: string): string {
  const padding = "=".repeat((4 - (segment.length % 4)) % 4);
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/") + padding;
  return atob(base64);
}

/**
 * Lightweight sanity check on the session cookie. We cannot verify the
 * signature in the edge runtime without the Supabase JWT secret/JWKS, but
 * we can reject malformed or expired tokens immediately so users with stale
 * cookies are sent to sign-in instead of hitting API 401s.
 */
function isTokenExpiredOrInvalid(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    if (typeof payload.exp !== "number") return false; // no expiry = assume valid
    const now = Math.floor(Date.now() / 1000);
    return payload.exp < now - 60; // 60 second clock-skew leeway
  } catch {
    return true;
  }
}

/**
 * Navigation Overhaul Redirects
 *
 * Maps reorganized URLs to their new counterparts.
 * Only URLs that have been MOVED (not pages with real existing content) are redirected.
 */
const REDIRECTS: Record<string, string> = {
  // The /app/build/* tree was eleven ModuleShell pages — tab strips with no
  // content and no data source — and settings redirected into it. So
  // /app/settings/ai sent a 793-line AI preferences screen to a 25-line empty
  // frame, /app/settings/compliance sent 218 lines to another, and
  // /app/settings sent the whole area to a third.
  //
  // An earlier fix here removed the blanket prefix rule and kept these three
  // because their targets EXISTED. Existing was the wrong test: a shell passes
  // it. The tree is deleted and the redirects with it; the real screens live
  // under /app/settings and are served there.
  //
  // Money hub consolidation — finance merged into /app/money
  "/app/finance": "/app/money",
  "/app/finance/cashflow": "/app/money",
  "/app/accounting": "/app/money/books",
};
/**
 * Prefix redirects — only for paths that have truly moved.
 *
 * EMPTY, deliberately, and it should stay that way.
 *
 * It used to contain `"/app/settings/": "/app/build/system/"`. There are 21
 * screens under /app/settings and exactly five under /app/build/system, so
 * seventeen of them redirected to a URL with no page and returned a hard 404 —
 * including by typing the address, because middleware runs before routing.
 * 5,438 lines of finished settings code, unreachable by any means:
 *
 *   team 1014 · output-templates 680 · webhooks 626 · custom-fields 528
 *   ai-control 479 · notifications 466 · templates 314 · insights 225
 *   autonomy 213 · privacy 206 · conversion 168 · invite 161 · security 158
 *   catalog 103 · business 65 · billing 18 · profile 14
 *
 * Two of them were linked from the main nav — "Account" (/app/settings/profile)
 * and "Team" (/app/settings/team) — and "Account" is in the startup disclosure
 * allowlist, so a brand-new user clicking it landed on a 404.
 *
 * A prefix rule cannot express "these three moved and those seventeen did not",
 * which is exactly the shape of this migration. Per-path entries in REDIRECTS
 * can, and middleware-redirect-targets.spec.ts now asserts every destination
 * resolves to a real page — so a half-finished move fails a test instead of
 * deleting a third of the settings area.
 */
const PREFIX_REDIRECTS: Record<string, string> = {};

function getRedirect(pathname: string, search: string): string | null {
  const exactDest = REDIRECTS[pathname];
  if (exactDest) {
    return exactDest + search;
  }

  for (const [prefix, dest] of Object.entries(PREFIX_REDIRECTS)) {
    if (pathname.startsWith(prefix)) {
      const remainder = pathname.slice(prefix.length);
      return dest + remainder + search;
    }
  }

  return null;
}

/**
 * Edge middleware that gates `/app/*` routes and handles navigation redirects.
 *
 * Redirects run first (so moved URLs map to new URLs), then auth gating applies
 * to the destination.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Skip Next.js internal routes and known static assets. A broad `.` check
  // would let dotted application routes (e.g. /app/reports.v2) bypass auth,
  // so we only allow-list specific file extensions.
  const PUBLIC_FILE_EXTENSION = /\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|json|woff|woff2|ttf|otf|eot|mp4|webm|pdf)$/i;
  if (pathname.startsWith("/app/_next") || PUBLIC_FILE_EXTENSION.test(pathname)) {
    return NextResponse.next();
  }

  // 1. Navigation redirects (overhaul) — only for truly moved pages
  const redirectDest = getRedirect(pathname, search);
  if (redirectDest) {
    return NextResponse.redirect(new URL(redirectDest, req.url), 308);
  }

  // 2. Auth gating — all /app/* routes require authentication.
  // Onboarding is part of the authenticated app shell; sign-up/sign-in flows
  // redirect authenticated users into it.
  const tokenCookie = req.cookies.get(TOKEN_COOKIE)?.value;
  if (tokenCookie && !isTokenExpiredOrInvalid(tokenCookie)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = "";
  url.searchParams.set("from", pathname + (search || ""));
  const response = NextResponse.redirect(url);
  // Clear the stale/malformed cookie so the next request doesn't carry it.
  response.cookies.set(TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

export const config = {
  matcher: ["/app/:path*"],
};
