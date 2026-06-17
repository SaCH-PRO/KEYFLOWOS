import { getApiBase } from "@/lib/api-base";
import { NextRequest, NextResponse } from "next/server";

const API_BASE = getApiBase();

function getAppUrl(request: NextRequest): string {
  const canonical = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (canonical) return canonical.replace(/\/$/, "");
  // Fallback to the incoming origin, but force localhost so 0.0.0.0 does
  // not leak into browser-facing redirects.
  const incoming = new URL(request.url);
  if (incoming.hostname === "0.0.0.0") {
    incoming.hostname = "localhost";
  }
  return incoming.origin;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get("state");
  const code = searchParams.get("code");
  const scope = searchParams.get("scope");
  const error = searchParams.get("error");
  const appUrl = getAppUrl(request);

  if (error) {
    return NextResponse.redirect(new URL("/app/key-connect?drive=error&reason=" + error, appUrl));
  }

  if (!state || !code) {
    return NextResponse.redirect(new URL("/app/key-connect?drive=error&reason=missing_params", appUrl));
  }

  try {
    const apiBase = API_BASE.startsWith("/")
      ? new URL(API_BASE, appUrl).toString()
      : API_BASE;
    const backendUrl = `${apiBase}/drive/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`;
    const res = await fetch(backendUrl, { redirect: "manual" });

    const location = res.headers.get("location");
    if (location) {
      // SECURITY: only follow redirects that point back at our own origin —
      // an attacker-controlled backend must not be able to redirect users to
      // arbitrary external URLs (ported from develop 1c7e6f93).
      const appOrigin = new URL(appUrl).origin;
      const redirectUrl = location.startsWith("/")
        ? new URL(location, appUrl)
        : new URL(location);
      if (redirectUrl.origin !== appOrigin) {
        return NextResponse.redirect(
          new URL("/app/key-connect?drive=error&reason=invalid_redirect", appUrl),
        );
      }
      return NextResponse.redirect(redirectUrl);
    }

    return NextResponse.redirect(new URL("/app/key-connect?drive=success", appUrl));
  } catch (err) {
    console.error("Drive callback proxy error:", err);
    return NextResponse.redirect(new URL("/app/key-connect?drive=error&reason=proxy_error", appUrl));
  }
}
