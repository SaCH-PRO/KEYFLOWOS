/**
 * SWEEP-P0-SCOPES round 2 class repair (CW-3): the Business Profile drawer reads the server's
 * answer when it sets the active location.
 *
 * The server now holds POST /connect/businesses/:b/business-profile/active-location to the Google
 * owner rule (D-99: 403 GOOGLE_CONNECT_OWNER_ONLY), since it moves the account and location the
 * owner's Google tokens act on. Before: handleSetActive ignored the answer, so a refused set said
 * "Active location set" and marked the location active.
 *
 * Required: a refused set shows the server's refusal, says nothing was set, and leaves the location
 * that was active marked active; an accepted set marks the new location active.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const REFUSAL = "Only the business owner can connect, sync or disconnect Google services for this business.";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPostSimple: vi.fn(), apiDelete: vi.fn() }));
vi.mock("@/lib/api", () => api);

import { BusinessProfileManageDrawer } from "../business-profile-manage-drawer";

const LOCATIONS = [
  { name: "locations/loc_a", title: "Store A" },
  { name: "locations/loc_b", title: "Store B" },
];

/** The location card that shows `title`. */
const cardOf = (title: string) => screen.getByText(title).closest("button") as HTMLElement;

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPostSimple.mockReset();
  api.apiDelete.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  api.apiGet.mockImplementation(async (url: string) => {
    if (url.includes("/business-profile/accounts")) return { data: { accounts: [{ name: "accounts/acct_owner_1", accountName: "Owner" }] }, error: null, status: 200 };
    if (url.includes("/business-profile/locations")) return { data: { locations: LOCATIONS }, error: null, status: 200 };
    return { data: {}, error: null, status: 200 };
  });
});
afterEach(() => cleanup());

describe("Business Profile drawer: setting the active location", () => {
  it("[WEB-BP-01] a refused set shows the server's refusal, never 'Active location set', and the location that was active stays active", async () => {
    api.apiPostSimple.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    render(<BusinessProfileManageDrawer businessId="biz_1" />);
    await screen.findByText("Store B");
    await waitFor(() => expect(cardOf("Store A").textContent).toContain("Active"));
    fireEvent.click(cardOf("Store B"));
    await waitFor(() => expect(api.apiPostSimple).toHaveBeenCalledWith("/connect/businesses/biz_1/business-profile/active-location", { accountId: "acct_owner_1", locationId: "loc_b" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(toast.success).not.toHaveBeenCalled();
    expect(cardOf("Store A").textContent).toContain("Active");
    expect(cardOf("Store B").textContent).not.toContain("Active");
  });

  it("[WEB-BP-02] an accepted set marks the new location active and says so", async () => {
    api.apiPostSimple.mockResolvedValue({ data: { accountId: "acct_owner_1", locationId: "loc_b" }, error: null, status: 201 });
    render(<BusinessProfileManageDrawer businessId="biz_1" />);
    await screen.findByText("Store B");
    fireEvent.click(cardOf("Store B"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Active location set: Store B"));
    await waitFor(() => expect(cardOf("Store B").textContent).toContain("Active"));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
