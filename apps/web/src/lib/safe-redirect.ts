export const DEFAULT_APP_REDIRECT = "/app";

/**
 * Sanitize a `?from=` redirect value so it can only point to a same-origin
 * path under `/app`. Rejects protocols, hosts, scheme-relative URLs, and
 * fragments/query strings to avoid open-redirect injection.
 */
export function safeFromParam(
  raw: string | null | undefined,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): string {
  if (!raw) return DEFAULT_APP_REDIRECT;

  try {
    const url = new URL(raw, origin);

    if (url.origin !== origin) return DEFAULT_APP_REDIRECT;
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_APP_REDIRECT;
    }
    if (!url.pathname.startsWith("/app")) return DEFAULT_APP_REDIRECT;

    // Strip query and hash to prevent injection through those channels.
    return url.pathname;
  } catch {
    // Fall back to basic path validation for malformed URLs.
    if (!raw.startsWith("/") || raw.startsWith("//") || !raw.startsWith("/app")) {
      return DEFAULT_APP_REDIRECT;
    }
    return raw.split("?")[0].split("#")[0];
  }
}
