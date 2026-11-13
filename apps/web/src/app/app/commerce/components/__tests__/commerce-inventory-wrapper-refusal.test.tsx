/**
 * SWEEP-P0-SCOPES second review repair (finding CRV-3, minor): Commerce > Inventory never closes a
 * warehouse or stock form the server refused as if it were saved, and says why a refused warehouse
 * delete did nothing.
 *
 * This packet gated the warehouse and stock writes to storefront write (POST/PATCH/DELETE
 * .../warehouses, POST .../inventory; membership-only at base). A member with storefront read gets
 * 403 "Insufficient permissions: storefront requires write access (you have read)". handleSave awaited
 * apiPost/apiPatch, ignored the answer, closed the modal and reloaded; handleDeleteWarehouse the same:
 * the warehouse was missing (or still there) and nothing said why. pkt/PR195-JOURNAL-SCOPE answers the
 * purchase-order edit only; these branches were left as they were.
 *
 * Required: a refused save keeps the form open with the server's refusal in it; a refused delete
 * says the server's refusal on the page; a save the server applies closes the form.
 *
 * InventoryCommandCenter is a stub that offers the wrapper's own callbacks (the claim is the
 * wrapper's handling of the answer); the api client is a mock answering as the real one does
 * ({ data: null, error, status } for a refusal, no throw).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const REFUSAL = "Insufficient permissions: storefront requires write access (you have read)";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() }));
vi.mock("@/lib/api", () => api);
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("../../../marketplace/components/inventory-command-center", () => ({
  InventoryCommandCenter: (props: { onCreateWarehouse: () => void; onDeleteWarehouse: (id: string) => void; onAddInventory: () => void }) => (
    <div>
      <button onClick={props.onCreateWarehouse}>stub: new warehouse</button>
      <button onClick={() => props.onDeleteWarehouse("wh_1")}>stub: delete warehouse</button>
      <button onClick={props.onAddInventory}>stub: add stock</button>
    </div>
  ),
}));

import { CommerceInventoryWrapper } from "../commerce-inventory-wrapper";

const REFUSED = { data: null, error: REFUSAL, status: 403 };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.apiGet.mockResolvedValue({ data: [], error: null });
});
afterEach(() => cleanup());

describe("Commerce > Inventory: refused warehouse and stock writes", () => {
  it("[WEB-CINV-01] RED-BEFORE: a refused new warehouse keeps the form open with the server's refusal", async () => {
    api.apiPost.mockResolvedValue(REFUSED);
    render(<CommerceInventoryWrapper businessId="biz_1" />);
    fireEvent.click(screen.getByText("stub: new warehouse"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith(expect.objectContaining({ path: "/marketplace/businesses/biz_1/warehouses" })));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(REFUSAL);
    expect(screen.getByText(/new warehouse$/i, { selector: "h3" })).toBeInTheDocument();
  });

  it("[WEB-CINV-02] RED-BEFORE: a refused stock line keeps the form open with the server's refusal", async () => {
    api.apiPost.mockResolvedValue(REFUSED);
    render(<CommerceInventoryWrapper businessId="biz_1" />);
    fireEvent.click(screen.getByText("stub: add stock"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith(expect.objectContaining({ path: "/marketplace/businesses/biz_1/inventory" })));
    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSAL);
    expect(screen.getByText(/new inventory$/i, { selector: "h3" })).toBeInTheDocument();
  });

  it("[WEB-CINV-03] RED-BEFORE: a refused warehouse delete says the server's refusal", async () => {
    api.apiDelete.mockResolvedValue(REFUSED);
    render(<CommerceInventoryWrapper businessId="biz_1" />);
    fireEvent.click(screen.getByText("stub: delete warehouse"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.apiDelete).toHaveBeenCalledWith("/marketplace/businesses/biz_1/warehouses/wh_1"));
    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSAL);
  });

  it("[WEB-CINV-04] a warehouse the server saves closes the form", async () => {
    api.apiPost.mockResolvedValue({ data: { id: "wh_2" }, error: null });
    render(<CommerceInventoryWrapper businessId="biz_1" />);
    fireEvent.click(screen.getByText("stub: new warehouse"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText(/new warehouse$/i, { selector: "h3" })).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
