export const DEMO_MODE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true";

/**
 * R0-15d-WEB-BUSINESS-SCOPE-MOUNTS (M09). There is no default business. This
 * module used to export DEFAULT_BUSINESS_ID = NEXT_PUBLIC_DEMO_BUSINESS_ID ??
 * "biz_demo", and every business-scoped helper defaulted to it, so a caller
 * that forgot its businessId called the demo tenant: BusinessGuard refused a
 * real member (403, a screen that silently showed nothing) and let a
 * SUPER_ADMIN read and write the demo tenant instead of the selected one.
 *
 * A business-scoped helper now works in the business its caller names, else the
 * member's selected business (lib/client.ts selectedBusinessId), else in none:
 * it sends nothing and answers NO_BUSINESS_SELECTED (an ApiResult helper: it
 * resolves that answer, it never rejects) or throws NoBusinessSelectedError (a
 * helper that hands back a Response or throws its failures).
 */
export const NO_BUSINESS_SELECTED = "No business selected";

/**
 * What a helper names as its business when its caller named none and no
 * business is selected. Never sent: every business-scoped request is refused
 * before it leaves the browser once its URL names it (namesNoBusiness).
 */
export const UNSELECTED_BUSINESS = "__kf_no_business_selected__";

/**
 * A /businesses/ segment that names no business: the unselected marker, an
 * empty segment, or a missing value spelled out ("undefined", "null").
 */
const BUSINESSES = "/businesses/";
const UNBOUND_SEGMENT = new RegExp(`${BUSINESSES}(?:${UNSELECTED_BUSINESS}|undefined|null)?(?=[/?#]|$)`);
/** A businessId query parameter that names no business, spelled the same ways. */
const UNBOUND_QUERY = new RegExp(`[?&]businessId=(?:${UNSELECTED_BUSINESS}|undefined|null)?(?=[&#]|$)`);

/**
 * True when a request path or URL names no business, so it must not be sent:
 * its /businesses/ segment or its businessId query is unbound, or it carries
 * the unselected marker anywhere.
 */
export function namesNoBusiness(pathOrUrl: string): boolean {
  return pathOrUrl.includes(UNSELECTED_BUSINESS) || UNBOUND_SEGMENT.test(pathOrUrl) || UNBOUND_QUERY.test(pathOrUrl);
}

/** A business id that names no business: not a string, empty, spelled out ("undefined", "null"), or the unselected marker. */
function isUnboundBusinessId(value: unknown): boolean {
  return typeof value !== "string" || value === "" || value === "undefined" || value === "null" || value === UNSELECTED_BUSINESS;
}

/**
 * True when a request must not be sent because it names no business: its path
 * or URL names none (namesNoBusiness), or, on a route without a /businesses/
 * segment, its body carries the business (an own businessId, which
 * BusinessGuard reads from the body) and that business is unbound: null,
 * undefined, empty, spelled out, or the unselected marker (R0-15d review
 * SEC-R015d-2). A JSON string body is read as the server reads it; any other
 * body (FormData, none) carries no business. A body sent to a /businesses/:id
 * route is the caller's data, not the tenant, and is not judged.
 */
export function requestNamesNoBusiness(pathOrUrl: string, body?: unknown): boolean {
  if (namesNoBusiness(pathOrUrl)) return true;
  if (pathOrUrl.includes(BUSINESSES)) return false;
  let value = body;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!Object.prototype.hasOwnProperty.call(value, "businessId")) return false;
  return isUnboundBusinessId((value as { businessId: unknown }).businessId);
}

/** The ApiResult a business-scoped helper answers with instead of calling. */
export function noBusinessSelected(): { data: null; error: string } {
  return { data: null, error: NO_BUSINESS_SELECTED };
}

/** Thrown by a business-scoped helper that hands back a raw Response. */
export class NoBusinessSelectedError extends Error {
  constructor() {
    super(NO_BUSINESS_SELECTED);
    this.name = "NoBusinessSelectedError";
  }
}
