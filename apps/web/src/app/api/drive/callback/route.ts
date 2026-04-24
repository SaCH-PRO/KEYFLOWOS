import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

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
      const appOrigin = new URL(request.url).origin;
      const redirectUrl = location.startsWith("/")
        ? new URL(location, request.url)
        : new URL(location);
      if (redirectUrl.origin !== appOrigin) {
        return NextResponse.redirect(new URL("/app/profile?tab=documents&drive=error&reason=invalid_redirect", request.url));
      }
      return NextResponse.redirect(redirectUrl);
    }

    return NextResponse.redirect(new URL("/app/profile?tab=documents&drive=success", request.url));
  } catch (err) {
    console.error("Drive callback proxy error:", err);
    return NextResponse.redirect(new URL("/app/profile?tab=documents&drive=error&reason=proxy_error", request.url));
  }
}
