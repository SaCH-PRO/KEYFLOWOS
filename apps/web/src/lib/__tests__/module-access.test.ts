import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * R0-13g-OPS-SCOPE-COMMAND-PROCUREMENT (D-40): the web's operations access
 * helpers. The server refuses every procurement and command-centre item route
 * with 403 to a member without the 'operations' module scope
 * (apps/server/test/ops-scope-command-procurement.integration.test.ts); these
 * helpers turn the server's own answer to GET procurement stats into what the
 * web shows. Wiring them into the nav and the command cards is outside this
 * packet's write set (OPS-T02 in the server suite).
 */

const { fetchProcurementStats } = vi.hoisted(() => ({ fetchProcurementStats: vi.fn() }));
vi.mock("../client", () => ({ fetchProcurementStats }));

import {
  OPERATIONS_GATED_HREFS,
  canOfferOperationsActions,
  filterByOperationsAccess,
  isHrefAvailable,
  isOperationsGatedHref,
  operationsAccessFromResponse,
  probeOperationsAccess,
} from "../module-access";

beforeEach(() => {
  fetchProcurementStats.mockReset();
});

describe("operations access from the server's answer", () => {
  it("success is granted, 403 is denied, anything else is unknown", () => {
    expect(operationsAccessFromResponse({ error: null })).toBe("granted");
    expect(operationsAccessFromResponse({ error: "Insufficient permissions: operations requires read access (you have none)", status: 403 })).toBe("denied");
    for (const res of [{ error: "Unauthorized", status: 401 }, { error: "Internal server error", status: 500 }, { error: "Network error" }, null, undefined]) {
      expect(operationsAccessFromResponse(res as never), JSON.stringify(res)).toBe("unknown");
    }
  });

  it("probes GET procurement stats for the business and never throws", async () => {
    fetchProcurementStats.mockResolvedValueOnce({ data: { total: 0 }, error: null });
    await expect(probeOperationsAccess("biz_1")).resolves.toBe("granted");
    expect(fetchProcurementStats).toHaveBeenCalledWith("biz_1");

    fetchProcurementStats.mockResolvedValueOnce({ data: null, error: "Insufficient permissions", status: 403 });
    await expect(probeOperationsAccess("biz_1")).resolves.toBe("denied");

    fetchProcurementStats.mockRejectedValueOnce(new Error("offline"));
    await expect(probeOperationsAccess("biz_1")).resolves.toBe("unknown");
  });
});

describe("entry points", () => {
  it("gates /app/procurement and every page below it, and nothing else (the cockpit is every member's home)", () => {
    expect(OPERATIONS_GATED_HREFS).toEqual(["/app/procurement"]);
    for (const href of ["/app/procurement", "/app/procurement/", "/app/procurement/new", "/app/procurement/suppliers", "/app/procurement/pr_1?tab=po"]) {
      expect(isOperationsGatedHref(href), href).toBe(true);
    }
    for (const href of ["/app/command-center", "/app/command-center/ci_1", "/app/procurementx", "/app/crm", "/app"]) {
      expect(isOperationsGatedHref(href), href).toBe(false);
    }
  });

  it("hides a gated entry only when the server refused the member; granted and unknown show it", () => {
    const nav = [
      { label: "Purchasing", href: "/app/procurement" },
      { label: "Suppliers", href: "/app/procurement/suppliers" },
      { label: "Home", href: "/app/command-center" },
      { label: "Contacts", href: "/app/crm/contacts" },
    ];
    expect(filterByOperationsAccess(nav, "denied").map((i) => i.label)).toEqual(["Home", "Contacts"]);
    expect(filterByOperationsAccess(nav, "granted")).toEqual(nav);
    expect(filterByOperationsAccess(nav, "unknown")).toEqual(nav);
    expect(isHrefAvailable("/app/procurement", "denied")).toBe(false);
    expect(isHrefAvailable("/app/command-center", "denied")).toBe(true);
  });

  it("offers the operations actions unless the member was refused", () => {
    expect(canOfferOperationsActions("denied")).toBe(false);
    expect(canOfferOperationsActions("granted")).toBe(true);
    expect(canOfferOperationsActions("unknown")).toBe(true);
  });
});
