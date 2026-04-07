import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

function detectFlowFromState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64").toString("utf-8");
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot === -1) return null;
    const payload = decoded.substring(0, lastDot);
    const parsed = JSON.parse(payload);
    return parsed.flow || null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get("state");
  const code = searchParams.get("code");
  const scope = searchParams.get("scope");
  const error = searchParams.get("error");

  const flow = state ? detectFlowFromState(state) : null;

  if (flow === "drive") {
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
        const redirectUrl = location.startsWith("/") ? new URL(location, request.url) : new URL(location);
        return NextResponse.redirect(redirectUrl);
      }
      return NextResponse.redirect(new URL("/app/profile?tab=documents&drive=success", request.url));
    } catch (err) {
      console.error("Drive callback proxy error:", err);
      return NextResponse.redirect(new URL("/app/profile?tab=documents&drive=error&reason=proxy_error", request.url));
    }
  }

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
