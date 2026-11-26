/**
 * The admin session's token, as the web sees it. Edge-safe: no window, no Buffer
 * (atob only), so both the edge middleware and the browser use it.
 *
 * buildAdminToken (apps/server/src/core/auth/admin-token.util.ts) issues
 * `header.payload.signature` with payload.type "admin" and payload.exp in
 * MILLISECONDS (Date.now() + 24h). The HMAC cannot be checked here (the secret
 * stays on the server), so a usable shape grants nothing: it only decides
 * whether the admin shell is served (middleware.ts) and whether the Owner
 * Console link is offered (useAppLayout). Every admin read still goes to the
 * API, where AuthGuard + AdminGuard decide.
 */
export const ADMIN_LOGIN_PATH = "/admin/login";

function base64UrlDecode(segment: string): string {
  const padding = "=".repeat((4 - (segment.length % 4)) % 4);
  return atob(segment.replace(/-/g, "+").replace(/_/g, "/") + padding);
}

/** Three parts, payload.type "admin", a numeric payload.exp (ms) still ahead of `now`. */
export function isAdminTokenUsable(token: string | null | undefined, now: number = Date.now()): boolean {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    if (payload.type !== "admin") return false;
    return typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

/** /admin/login or /admin/login/: the one admin page served without an admin session. */
export function isAdminLoginPath(pathname: string): boolean {
  return pathname === ADMIN_LOGIN_PATH || pathname === `${ADMIN_LOGIN_PATH}/`;
}
