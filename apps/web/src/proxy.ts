import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "kf_token";
const LOGIN_PATH = "/auth/login";

/**
 * Navigation Overhaul Redirects
 *
 * Maps reorganized URLs to their new counterparts.
 * Only URLs that have been MOVED (not pages with real existing content) are redirected.
 */
const REDIRECTS: Record<string, string> = {
  // Settings reorganized into Build > System
  "/app/settings": "/app/build/system/workspace",
  // Money hub consolidation — finance merged into /app/money
  "/app/finance": "/app/money",
  "/app/finance/cashflow": "/app/money",
  "/app/accounting": "/app/money/books",
};

/**
 * Prefix redirects — only for paths that have truly moved.
 */
const PREFIX_REDIRECTS: Record<string, string> = {
  "/app/settings/": "/app/build/system/",
};

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
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Skip Next.js internal routes and static files
  if (pathname.startsWith("/app/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // 1. Navigation redirects (overhaul) — only for truly moved pages
  const redirectDest = getRedirect(pathname, search);
  if (redirectDest) {
    return NextResponse.redirect(new URL(redirectDest, req.url), 301);
  }

  // 2. Auth gating
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
  matcher: ["/app/:path*"],
};
