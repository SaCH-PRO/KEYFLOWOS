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
 * procurement stats requires operations read, and ModuleScopeGuard refuses a
 * member without it with 403 "Insufficient permissions: operations requires
 * read access (you have none)". The server stays the enforcer; this decides
 * only what to show. Only that refusal is "denied". Any other answer (offline,
 * 5xx, no business selected, and every other 403, such as BusinessGuard's
 * transient "Unable to verify business access" / "Service unavailable" or its
 * "No access to this business" for a business that is no longer the member's)
 * says nothing about the member's operations level and is "unknown", and
 * unknown shows the entry: hiding a door on a network blip would be worse than
 * a door the server then refuses (W7-WEB-OPS-SCOPE review WOS-R1, D-40).
 *
 * The cockpit (/app/command-center) is not gated: it is every member's home and
 * its snapshot is open to every member (business-command-center.controller.ts).
 */
export type OperationsAccess = "granted" | "denied" | "unknown";

/**
 * W7-WEB-OPS-SCOPE (owner rulings D-40 and D-96; OPS-T02): the member's
 * 'operations' level in a business, as the server last stated it. Every
 * command-item route needs operations read to list and write for every action
 * (complete, approve, dismiss, execute, assign, snooze, reopen, discharge); a
 * read cannot tell read from write, so the level is "unknown" until a refusal
 * names it.
 */
export type OperationsLevel = "none" | "read" | "write" | "admin" | "unknown";

/** ModuleScopeGuard's refusal (apps/server core/auth/module-scope.guard.ts) for the operations module. */
const OPERATIONS_REFUSAL = /\boperations requires (?:none|read|write|admin) access \(you have (none|read|write|admin)\)/;

/**
 * The operations level a refused request names, or null when the answer is not ModuleScopeGuard's
 * operations refusal (success, another 403 such as BusinessGuard's "Unable to verify business
 * access", a 5xx): those say nothing about the member's level.
 */
export function operationsLevelFromAnswer(res: { error?: string | null; status?: number } | null | undefined): OperationsLevel | null {
  if (!res || res.status !== 403) return null;
  const named = OPERATIONS_REFUSAL.exec(res.error ?? "");
  return named ? (named[1] as OperationsLevel) : null;
}

/** Why a member at `level` cannot act on command items, or null when the actions are offered. */
export function commandActionsDisabledReason(level: OperationsLevel | undefined): string | null {
  if (level === "none") return "No operations access in this business: command items can't be viewed or acted on.";
  if (level === "read") return "View only: completing, approving or dismissing needs operations write access.";
  return null;
}

/** Web routes whose every server call requires operations: hidden from a member the server refuses. */
export const OPERATIONS_GATED_HREFS: readonly string[] = ["/app/procurement"];

/**
 * The access a probe answer stands for: success is granted; only ModuleScopeGuard's refusal naming
 * no operations access is denied (WOS-R1); anything else is unknown.
 */
export function operationsAccessFromResponse(res: { error: string | null; status?: number } | null | undefined): OperationsAccess {
  if (!res) return "unknown";
  if (res.error === null) return "granted";
  if (operationsLevelFromAnswer(res) === "none") return "denied";
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
