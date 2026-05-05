import type { Request } from 'express';

export const VISITOR_COOKIE = 'kf_vid';

/**
 * Resolves the public visitor identifier for a request, preferring the
 * `x-visitor-id` header (used by SPA fetches), then the `kf_vid` cookie
 * (set by the storefront/track endpoint). Returns null when no value is
 * present so callers can decide whether to mint a new id.
 */
export function readVisitorIdFromRequest(req: Request | undefined | null): string | null {
  if (!req) return null;
  const headerVid = req.headers?.['x-visitor-id'];
  if (typeof headerVid === 'string' && headerVid.trim()) return headerVid.trim().slice(0, 100);
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === VISITOR_COOKIE) {
      const raw = rest.join('=').trim();
      if (!raw) return null;
      try {
        return decodeURIComponent(raw).slice(0, 100);
      } catch {
        return raw.slice(0, 100);
      }
    }
  }
  return null;
}
