"use client";

function withPort(origin: string, port: string): string {
  try {
    const url = new URL(origin);
    url.port = port;
    return url.toString().replace(/\/$/, "");
  } catch {
    return `http://localhost:${port}`;
  }
}

function normalizedOrigin(origin?: string): string | undefined {
  if (!origin) return undefined;
  return origin.replace(/\/$/, "");
}

export function getApiBase(explicitApiBase?: string, currentOrigin?: string): string {
  if (explicitApiBase) return explicitApiBase.replace(/\/$/, "");
  if (currentOrigin) return withPort(currentOrigin, "3001");
  return "http://localhost:3001";
}

export function getSiteUrl(explicitSiteUrl?: string, currentOrigin?: string): string {
  return normalizedOrigin(explicitSiteUrl) ?? normalizedOrigin(currentOrigin) ?? "http://localhost:5000";
}

export function getRuntimeSiteUrl(): string {
  if (typeof window === "undefined") {
    return getSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  }
  return getSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, window.location.origin);
}

export function getRuntimeApiBase(): string {
  if (typeof window === "undefined") {
    return getApiBase(process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL);
  }
  return getApiBase(process.env.NEXT_PUBLIC_API_BASE_URL, window.location.origin);
}

