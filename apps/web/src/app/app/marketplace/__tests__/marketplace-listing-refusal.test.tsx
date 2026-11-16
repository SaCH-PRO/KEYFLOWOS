/**
 * SWEEP-P0-SCOPES second review repair (finding CRV-3, minor): the Marketplace page never closes a
 * listing form the server refused as if it were saved, and says why a refused listing delete did
 * nothing.
 *
 * The listing writes need storefront write in this packet (membership-only at base). handleSave
 * awaited the write, reloaded only on res.data and closed the modal whatever the answer; handleDelete
 * awaited the delete, ignored the answer and reloaded. A refused save or delete said nothing. (The
 * page's warehouse and stock branches are the same code: no tab of this page reaches them, the
 * inventory tab moved to /app/inventory, so their behaviour is pinned through the Commerce wrapper.)
 * pkt/PR195-JOURNAL-SCOPE answers the purchase-order edit only.
 *
 * Required: a refused save keeps the form open with the server's refusal in it; a refused delete
 * says the server's refusal on the page; a save the server applies closes the form.
 *
 * The listings tab is a stub that offers the page's own callbacks; the feature-flag gate renders its
 * children; the api client is a mock answering as the real one does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const REFUSAL = "Insufficient permissions: storefront requires write access (you have read)";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/marketplace",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() }));
vi.mock("@/lib/api", () => api);
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/lib/workspace", async (orig) => ({ ...(await orig<object>()), getStoredBusinessId: () => "biz_1" }));
vi.mock("@/components/dormant-route", () => ({ DormantRoute: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../components/commerce-catalog-tab", () => ({ CommerceCatalogTab: () => <div>stub: catalog</div> }));
vi.mock("../components/commerce-listings-tab", () => ({
  CommerceListingsTab: (props: { onCreateListing: () => void; onDelete: (id: string) => void }) => (
    <div>
      <button onClick={props.onCreateListing}>stub: new listing</button>
      <button onClick={() => props.onDelete("l1")}>stub: delete listing</button>
    </div>
  ),
}));

import MarketplacePage from "../page";

const REFUSED = { data: null, error: REFUSAL, status: 403 };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.apiGet.mockResolvedValue({ data: [], error: null });
});
afterEach(() => cleanup());

async function openListings() {
  render(<MarketplacePage />);
  fireEvent.click(await screen.findByRole("tab", { name: /listings/i }));
  await screen.findByText("stub: new listing");
}

describe("Marketplace: refused listing writes", () => {
  it("[WEB-MKT-01] RED-BEFORE: a refused new listing keeps the form open with the server's refusal", async () => {
    api.apiPost.mockResolvedValue(REFUSED);
    await openListings();
    fireEvent.click(screen.getByText("stub: new listing"));
    fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith(expect.objectContaining({ path: "/marketplace/businesses/biz_1/listings" })));
    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSAL);
    expect(screen.getByText("Create listing")).toBeInTheDocument();
  });

  it("[WEB-MKT-02] RED-BEFORE: a refused listing delete says the server's refusal", async () => {
    api.apiDelete.mockResolvedValue(REFUSED);
    await openListings();
    fireEvent.click(screen.getByText("stub: delete listing"));
    await waitFor(() => expect(api.apiDelete).toHaveBeenCalledWith("/marketplace/businesses/biz_1/listings/l1"));
    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSAL);
  });

  it("[WEB-MKT-03] a listing the server saves closes the form", async () => {
    api.apiPost.mockResolvedValue({ data: { id: "l2" }, error: null });
    await openListings();
    fireEvent.click(screen.getByText("stub: new listing"));
    fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByText("Create listing")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
