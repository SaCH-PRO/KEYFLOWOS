/**
 * Runtime URL helpers.
 *
 * Centralizes the precedence order used to derive the public URLs the app
 * needs to embed in OAuth redirect URIs, email links, etc.
 *
 * Precedence (first non-empty wins):
 *   1. Explicit env var for the specific URL
 *      (`APP_URL`, `API_URL`, `OAUTH_REDIRECT_BASE`)
 *   2. The `PUBLIC_BASE_URL` umbrella var
 *   3. Sensible localhost fallback
 */

function trim(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  const v = s.trim();
  return v.length > 0 ? v : undefined;
}

function umbrellaBase(): string | undefined {
  return trim(process.env.PUBLIC_BASE_URL);
}

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/**
 * Public URL of the web frontend (Next.js app on :5000 in dev).
 * Used for redirect targets, email links, OAuth success/error redirects, etc.
 */
export function appUrl(): string {
  const explicit = trim(process.env.APP_URL) || trim(process.env.NEXT_PUBLIC_SITE_URL);
  return stripTrailingSlash(
    explicit ||
      umbrellaBase() ||
      "http://localhost:5000",
  );
}

/**
 * Public URL of the backend API (NestJS app on :3001 in dev).
 * Used for callback URLs hosted by the backend.
 */
export function apiUrl(): string {
  const explicit = trim(process.env.API_URL) || trim(process.env.NEXT_PUBLIC_API_BASE_URL);
  return stripTrailingSlash(
    explicit ||
      umbrellaBase() ||
      "http://localhost:3001",
  );
}

/**
 * Base URL OAuth providers should redirect back to after auth. By default
 * this is the same as `appUrl()` (the web app proxies the callback to the
 * API), but it can be overridden independently if redirects are routed to
 * a different host (e.g. an edge worker).
 */
export function oauthRedirectBase(): string {
  const explicit = trim(process.env.OAUTH_REDIRECT_BASE);
  return stripTrailingSlash(explicit || appUrl());
}

/**
 * Construct an absolute URL on the web app.
 */
export function appLink(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${appUrl()}${p}`;
}

/**
 * Construct an absolute URL on the API.
 */
export function apiLink(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${apiUrl()}${p}`;
}

/**
 * Construct an OAuth redirect URI. `path` is appended to `oauthRedirectBase()`.
 */
export function oauthRedirect(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${oauthRedirectBase()}${p}`;
}

/**
 * Returns the list of allowed CORS origins for the API based on the runtime
 * URL precedence above. Always includes localhost variants for local dev.
 */
export function allowedCorsOrigins(): string[] {
  const set = new Set<string>();
  for (const u of [
    trim(process.env.APP_URL),
    trim(process.env.NEXT_PUBLIC_SITE_URL),
    trim(process.env.PUBLIC_BASE_URL),
  ]) {
    if (u) set.add(stripTrailingSlash(u));
  }
  // Extra origins via comma-separated list.
  const extra = trim(process.env.CORS_ALLOWED_ORIGINS);
  if (extra) {
    for (const o of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
      set.add(stripTrailingSlash(o));
    }
  }
  // Local dev fallbacks.
  set.add("http://localhost:5000");
  set.add("http://localhost:3000");
  set.add("http://127.0.0.1:5000");
  return Array.from(set);
}
