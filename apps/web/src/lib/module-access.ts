import { fetchProcurementStats } from "./client";

/**
 * Operations module access on the web (R0-13g-OPS-SCOPE-COMMAND-PROCUREMENT,
 * owner ruling D-40).
 *
 * The server requires the existing 'operations' module scope on every
 * command-centre item route (/command/businesses/:id/...) and every procurement
 * route (/procurement/businesses/:id/...): read for a GET, write for every
 * mutation. OWNER and ADMIN hold operations admin by role default, STAFF read;
 * a member whose explicit scope map has no operations key, or says 'none', is
 * refused with 403 on all of them.
 *
 * The web cannot read a STAFF member's own scope map (GET
 * /identity/businesses/:id/team needs team read, which STAFF does not hold by
 * default), so it asks the server instead of re-deriving the rule: GET
 * procurement stats requires operations read and answers 403 to a member
 * without it. The server stays the enforcer; this decides only what to show.
 * An answer that is neither success nor 403 (offline, 5xx, no business
 * selected) is "unknown", and unknown shows the entry: hiding a door on a
 * network blip would be worse than a door the server then refuses.
 *
 * The cockpit (/app/command-center) is not gated: it is every member's home and
 * its snapshot is open to every member (business-command-center.controller.ts).
 */
export type OperationsAccess = "granted" | "denied" | "unknown";

/** Web routes whose every server call requires operations: hidden from a member the server refuses. */
export const OPERATIONS_GATED_HREFS: readonly string[] = ["/app/procurement"];

/** The access a probe answer stands for. */
export function operationsAccessFromResponse(res: { error: string | null; status?: number } | null | undefined): OperationsAccess {
  if (!res) return "unknown";
  if (res.error === null) return "granted";
  if (res.status === 403) return "denied";
  return "unknown";
}

/** Ask the server whether the signed-in member holds operations read in `businessId`. Never throws. */
export async function probeOperationsAccess(businessId: string): Promise<OperationsAccess> {
  try {
    return operationsAccessFromResponse(await fetchProcurementStats(businessId));
  } catch {
    return "unknown";
  }
}

/** Whether `href` is one of the operations-gated routes or below one. */
export function isOperationsGatedHref(href: string): boolean {
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return OPERATIONS_GATED_HREFS.some((gated) => path === gated || path.startsWith(`${gated}/`));
}

/** Whether an entry point to `href` is shown: hidden only when the server has refused this member operations. */
export function isHrefAvailable(href: string, access: OperationsAccess): boolean {
  return access !== "denied" || !isOperationsGatedHref(href);
}

/** The nav items (or any entry points with an href) a member with `access` is shown. */
export function filterByOperationsAccess<T extends { href: string }>(items: readonly T[], access: OperationsAccess): T[] {
  return items.filter((item) => isHrefAvailable(item.href, access));
}

/**
 * Whether the command-item and procurement mutations (complete, dismiss,
 * approve, create, issue a PO, ...) are offered. A read probe cannot tell read
 * from write, so only a refused member is known not to hold them; a read-only
 * member still gets the server's 403 on the action.
 */
export function canOfferOperationsActions(access: OperationsAccess): boolean {
  return access !== "denied";
}
