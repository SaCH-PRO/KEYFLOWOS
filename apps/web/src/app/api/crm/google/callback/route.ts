import { getApiBase } from "@/lib/api-base";
import { NextRequest, NextResponse } from "next/server";

const API_BASE = getApiBase();

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

function getPublicOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  const explicit =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return request.nextUrl.origin;
}

function publicRedirect(path: string, request: NextRequest) {
  return NextResponse.redirect(`${getPublicOrigin(request)}${path}`);
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
      return publicRedirect("/app/profile?tab=documents&drive=error&reason=" + error, request);
    }
    if (!state || !code) {
      return publicRedirect("/app/profile?tab=documents&drive=error&reason=missing_params", request);
    }
    try {
      const backendUrl = `${API_BASE}/drive/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`;
      const res = await fetch(backendUrl, { redirect: "manual" });
      const location = res.headers.get("location");
      if (location && location.startsWith("/")) {
        return publicRedirect(location, request);
      }
      return publicRedirect("/app/profile?tab=documents&drive=success", request);
    } catch (err) {
      console.error("Drive callback proxy error:", err);
      return publicRedirect("/app/profile?tab=documents&drive=error&reason=proxy_error", request);
    }
  }

  if (error) {
    return publicRedirect("/app/network/contacts?google_error=" + error, request);
  }

  if (!state || !code) {
    return publicRedirect("/app/network/contacts?google_error=missing_params", request);
  }

  try {
    const backendUrl = `${API_BASE}/crm/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`;
    const res = await fetch(backendUrl, { redirect: "manual" });

    const location = res.headers.get("location");
    if (location && location.startsWith("/")) {
      return publicRedirect(location, request);
    }

    if (res.ok || res.status === 302 || res.status === 301) {
      const data = res.ok ? await res.json().catch(() => null) : null;
      const imported = data?.imported ?? "";
      return publicRedirect(`/app/network/contacts?google_success=true${imported ? `&imported=${imported}` : ""}`, request);
    }

    return publicRedirect("/app/network/contacts?google_error=import_failed", request);
  } catch (err) {
    console.error("Google Contacts callback proxy error:", err);
    return publicRedirect("/app/network/contacts?google_error=proxy_error", request);
  }
}
