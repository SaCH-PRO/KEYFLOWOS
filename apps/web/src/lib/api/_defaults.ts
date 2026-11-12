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
 * the unselected marker anywhere, or the path fetch would actually send does
 * not carry the business it names (wireChangesBusiness).
 */
export function namesNoBusiness(pathOrUrl: string): boolean {
  return (
    pathOrUrl.includes(UNSELECTED_BUSINESS) ||
    UNBOUND_SEGMENT.test(pathOrUrl) ||
    UNBOUND_QUERY.test(pathOrUrl) ||
    wireChangesBusiness(pathOrUrl)
  );
}

/*
 * FOLLOW3-D11 review SEC-D11-1. fetch does not send the path it is handed: it
 * sends the WHATWG-parsed URL, which drops tab, CR and LF anywhere, reads "\"
 * as "/", strips trailing spaces and control characters, and resolves ".",
 * "..", "%2e" (and its spellings) segments. A judgement of the written path
 * alone therefore let `contacts/.` reach the list route and `businesses/\t/`
 * or `businesses/..` leave with an empty or no business segment. The guards
 * below judge the path fetch will send as well as the one written. Percent-
 * encoding (a space sent as %20, é as %C3%A9) changes no segment and is not a
 * rewrite.
 */

/** Stands in for API_BASE: the transports send `${API_BASE}${path}`, and only the path is judged. */
const WIRE_ORIGIN = "http://kf.invalid";
const SCHEME_AND_AUTHORITY = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i;
/** Characters the URL parser never sends as written in a path: tab, LF and CR are dropped, "\" becomes "/". */
const REWRITTEN_CHARACTER = /[\t\n\r\\]/;

/** The path of a request path or URL as written: after any scheme and authority, before the query and fragment. */
function writtenPathname(pathOrUrl: string): string {
  return pathOrUrl.replace(SCHEME_AND_AUTHORITY, "").split(/[?#]/, 1)[0];
}

/** A path's segments, without the empty one before its leading "/". */
function segmentsOf(pathname: string): string[] {
  const segments = pathname.split("/");
  if (segments[0] === "") segments.shift();
  return segments;
}

/** A segment with its percent-escapes decoded where they decode (a malformed run is kept as written). */
function decodeEscapes(segment: string): string {
  return segment.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/** The written path's segments, escapes decoded. */
function writtenSegments(pathOrUrl: string): string[] {
  return segmentsOf(writtenPathname(pathOrUrl)).map(decodeEscapes);
}

/**
 * The segments of the path fetch sends for this request path or URL, escapes
 * decoded; null when no URL can be made of it (fetch then sends nothing).
 */
function wireSegments(pathOrUrl: string): string[] | null {
  try {
    const url = SCHEME_AND_AUTHORITY.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(`${WIRE_ORIGIN}${pathOrUrl}`);
    return segmentsOf(url.pathname).map(decodeEscapes);
  } catch {
    return null;
  }
}

/** The segment after the first "businesses" segment, or undefined when the path has none. */
function businessSegment(segments: string[]): string | undefined {
  const at = segments.indexOf("businesses");
  return at === -1 ? undefined : segments[at + 1];
}

/**
 * True when the written path names a business (a /businesses/ segment) and the
 * path fetch would send carries another business segment, or none: the
 * business segment is a dot segment or whitespace, holds "\", a tab or a line
 * break, or a later ".." climbs over it (`reserves/../../b2/...`).
 */
function wireChangesBusiness(pathOrUrl: string): boolean {
  const written = writtenSegments(pathOrUrl);
  if (!written.includes("businesses")) return false;
  const wire = wireSegments(pathOrUrl);
  if (wire === null) return false;
  return businessSegment(wire) !== businessSegment(written);
}

/**
 * True when fetch would send another path than the one written: a dot segment
 * (".", "..", "%2e", ...) is resolved, "\" is read as "/", a tab, CR or LF is
 * dropped, or trailing spaces or control characters are stripped. Only the path
 * is judged; percent-encoding is not a rewrite.
 */
export function rewrittenOnTheWire(pathOrUrl: string): boolean {
  const pathname = writtenPathname(pathOrUrl);
  if (pathname === "") return false;
  if (REWRITTEN_CHARACTER.test(pathname)) return true;
  const wire = wireSegments(pathOrUrl);
  if (wire === null) return false;
  const written = writtenSegments(pathOrUrl);
  return wire.length !== written.length || wire.some((segment, i) => segment !== written[i]);
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

/**
 * FOLLOW3-D11-WEB-API-EMPTY-SEGMENT. What the lib/api.ts transports answer for a
 * request whose path is missing an id other than the business: `contacts/${""}`
 * sent .../contacts/, which the server's non-strict routing serves from the list
 * route, so a detail read was answered with a list.
 */
export const MISSING_ID = "Missing id";

/** A segment that holds no id: empty, or a missing value spelled out. */
function isMissingSegment(segment: string): boolean {
  return segment === "" || segment === "undefined" || segment === "null";
}

/**
 * True when a request path or URL names a missing id: a path segment that is
 * empty ("//", or a trailing "/" before the query or fragment) or spelled out
 * ("undefined", "null"), or a path fetch would not send as written
 * (rewrittenOnTheWire: `contacts/.`, `contacts/%2e` and `contacts/ ` all leave
 * as `contacts/`). Only the path is read; the query and fragment are the
 * caller's data. No request path template in lib/** ends in "/", holds "//" or
 * is rewritten on the wire (the census in
 * lib/__tests__/api-empty-id-segment.test.ts).
 */
export function namesMissingId(pathOrUrl: string): boolean {
  const pathname = writtenPathname(pathOrUrl);
  if (pathname === "") return false;
  return segmentsOf(pathname).some(isMissingSegment) || rewrittenOnTheWire(pathOrUrl);
}

/** The ApiResult a transport answers with instead of sending a request that names a missing id. */
export function missingId(): { data: null; error: string } {
  return { data: null, error: MISSING_ID };
}

/**
 * Why a request must not be sent, as the ApiResult to answer instead, or null
 * to send it: it names no business (requestNamesNoBusiness), else it names a
 * missing id (namesMissingId). Both judge the path as written and as fetch
 * will send it (WHATWG-normalised), so a dot segment, "\", tab, line break or
 * trailing space cannot turn a refused shape into a sent one.
 */
export function unsendableRequest(pathOrUrl: string, body?: unknown): { data: null; error: string } | null {
  if (requestNamesNoBusiness(pathOrUrl, body)) return noBusinessSelected();
  if (namesMissingId(pathOrUrl)) return missingId();
  return null;
}

/** Thrown by a business-scoped helper that hands back a raw Response. */
export class NoBusinessSelectedError extends Error {
  constructor() {
    super(NO_BUSINESS_SELECTED);
    this.name = "NoBusinessSelectedError";
  }
}
