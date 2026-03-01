import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get("state");
  const code = searchParams.get("code");
  const scope = searchParams.get("scope");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/app/crm/pipeline?google_error=" + error, request.url));
  }

  if (!state || !code) {
    return NextResponse.redirect(new URL("/app/crm/pipeline?google_error=missing_params", request.url));
  }

  try {
    const backendUrl = `${API_BASE}/crm/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`;
    const res = await fetch(backendUrl, { redirect: "manual" });

    const location = res.headers.get("location");
    if (location) {
      const redirectUrl = location.startsWith("/") ? new URL(location, request.url) : new URL(location);
      return NextResponse.redirect(redirectUrl);
    }

    return NextResponse.redirect(new URL("/app/crm/pipeline?google_success=true", request.url));
  } catch (err) {
    console.error("Google Contacts callback proxy error:", err);
    return NextResponse.redirect(new URL("/app/crm/pipeline?google_error=proxy_error", request.url));
  }
}
