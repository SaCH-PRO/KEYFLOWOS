/**
 * WEDGE-WA-INBOUND-CAPTURE review round 2 (security NEW-1), the recurring schedule form's wiring: editing a saved
 * schedule passes savedRecord to its customer field (recurring-panel.tsx savedRecord={!!editingId}), so a schedule whose
 * customer is not in the loaded list keeps that customer when the by-id read is refused (a member with revenue write and
 * no crm read is answered 403), instead of clearing it and stopping Save at "Contact is required".
 *
 *   RSC-01 Edit on a saved schedule whose customer is not loaded, the read answers 403: the field says the customer
 *          stays chosen, and Update Schedule does not stop at "Contact is required".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce",
  useSearchParams: () => new URLSearchParams(),
}));

import RecurringPanel from "../recurring-panel";

const BIZ = "biz_rsc";
const SAVED_CONTACT = "c_rsc_saved";

const fetchMock = vi.fn();
const byIdReads = () =>
  fetchMock.mock.calls.filter(([url]) => new URL(String(url), "http://localhost").pathname === `/crm/businesses/${BIZ}/contacts/${SAVED_CONTACT}`);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  window.localStorage.setItem("kf_token", "token-rsc");
  window.localStorage.setItem("kf_business_id", BIZ);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const path = new URL(String(url), "http://localhost").pathname;
    if (path === `/commerce/businesses/${BIZ}/recurring-invoices`) {
      return json(200, [
        {
          id: "rec_1",
          name: "Monthly retainer",
          description: null,
          frequency: "MONTHLY",
          amount: 500,
          currency: "TTD",
          startDate: "2026-11-01T00:00:00.000Z",
          nextRunDate: "2026-12-01T00:00:00.000Z",
          status: "ACTIVE",
          generatedCount: 1,
          contactId: SAVED_CONTACT,
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      ]);
    }
    if (path === `/crm/businesses/${BIZ}/contacts/${SAVED_CONTACT}`) {
      return json(403, { statusCode: 403, message: "Insufficient permissions: crm requires read access (you have none)", error: "Forbidden" });
    }
    return json(200, []);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("security NEW-1: an edited schedule keeps its customer through a refused read", () => {
  it("RSC-01 the customer stays chosen, and Update Schedule does not stop at 'Contact is required'", async () => {
    render(<RecurringPanel businessId={BIZ} contacts={[]} products={[]} />);
    fireEvent.click(await screen.findByTitle("Edit", {}, { timeout: 5_000 }));
    expect(await screen.findByText(/can.t see this customer/i, {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(byIdReads().length).toBeGreaterThan(0);
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    fireEvent.click(screen.getByRole("button", { name: /update schedule/i }));
    expect(await screen.findByText(/at least one line item is required/i)).toBeInTheDocument();
    expect(screen.queryByText(/contact is required/i)).toBeNull();
  }, 20_000);
});
