import { getApiBase } from "@/lib/api-base";
import { NextRequest, NextResponse } from "next/server";

const API_BASE = getApiBase();

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get("state");
  const code = searchParams.get("code");
  const scope = searchParams.get("scope");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/app/profile?tab=documents&drive=error&reason=" + error, request.url));
  }

  if (!state || !code) {
    return NextResponse.redirect(new URL("/app/profile?tab=documents&drive=error&reason=missing_params", request.url));
  }

  try {
    const backendUrl = `${API_BASE}/drive/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`;
    const res = await fetch(backendUrl, { redirect: "manual" });

    const location = res.headers.get("location");
    if (location) {
      // SECURITY: only follow redirects that point back at our own origin —
      // an attacker-controlled backend must not be able to redirect users to
      // arbitrary external URLs (ported from develop 1c7e6f93).
      const appOrigin = new URL(request.url).origin;
      const redirectUrl = location.startsWith("/")
        ? new URL(location, request.url)
        : new URL(location);
      if (redirectUrl.origin !== appOrigin) {
        return NextResponse.redirect(
          new URL("/app/profile?tab=documents&drive=error&reason=invalid_redirect", request.url),
        );
      }
      return NextResponse.redirect(redirectUrl);
    }

    return NextResponse.redirect(new URL("/app/profile?tab=documents&drive=success", request.url));
  } catch (err) {
    console.error("Drive callback proxy error:", err);
    return NextResponse.redirect(new URL("/app/profile?tab=documents&drive=error&reason=proxy_error", request.url));
  }
}
