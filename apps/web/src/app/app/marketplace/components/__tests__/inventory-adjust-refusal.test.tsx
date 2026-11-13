/**
 * SWEEP-P0-SCOPES (browser sweep BUG-015): the inventory command centre tells a member the server
 * refused a stock adjustment or transfer, and never shows a refused one as applied.
 *
 * The server now holds every stock and warehouse write to the storefront module's write scope
 * (apps/server marketplace.controller.ts); a member with storefront read gets 403 "Insufficient
 * permissions: storefront requires write access (you have read)". Before: handleAdjust and
 * handleTransfer ignored the answer of their POST, closed the modal and reloaded, so a refused
 * adjustment closed as if it had been applied, with no word.
 *
 * Required: a refused adjustment shows the server's refusal and keeps the modal open (nothing
 * reloaded as if applied); an applied one closes it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const REFUSAL = "Insufficient permissions: storefront requires write access (you have read)";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  getAuthHeaders: () => ({}),
  API_BASE: "http://api.test",
}));
vi.mock("@/lib/api", () => api);
vi.mock("@/lib/download", () => ({ saveAs: vi.fn() }));

import { InventoryCommandCenter } from "../inventory-command-center";

const WAREHOUSE = { id: "wh_1", name: "Main", type: "STORAGE", isActive: true } as never;
const PRODUCT = { id: "prod_1", name: "Widget", sku: "W-1", price: 10 } as never;
const STOCK = { id: "stock_1", productId: "prod_1", warehouseId: "wh_1", quantity: 10, reserved: 0, reorderAt: null, product: PRODUCT, warehouse: WAREHOUSE } as never;

function renderCentre() {
  render(
    <InventoryCommandCenter
      businessId="biz_1"
      basePath="/marketplace/businesses/biz_1"
      warehouses={[WAREHOUSE]}
      inventory={[STOCK]}
      products={[PRODUCT]}
      purchaseOrders={[]}
      onCreateWarehouse={vi.fn()}
      onEditWarehouse={vi.fn()}
      onDeleteWarehouse={vi.fn()}
      onAddInventory={vi.fn()}
      onCreatePO={vi.fn()}
      onEditPO={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
}

async function openAdjustAndApply() {
  fireEvent.click(screen.getByRole("button", { name: /stock grid/i }));
  fireEvent.click(await screen.findByRole("button", { name: /adjust/i }));
  await screen.findByText("Stock Adjustment");
  fireEvent.click(screen.getByRole("button", { name: "−" }));
  fireEvent.click(screen.getByRole("button", { name: /apply adjustment/i }));
}

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  api.apiDelete.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  api.apiGet.mockResolvedValue({ data: null, error: null });
});
afterEach(() => cleanup());

describe("inventory command centre: refused stock adjustment", () => {
  it("[WEB-INV-01] a refused adjustment shows the server's refusal and keeps the modal open", async () => {
    api.apiPost.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    renderCentre();
    await openAdjustAndApply();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(screen.getByText("Stock Adjustment")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("[WEB-INV-02] an applied adjustment closes the modal", async () => {
    api.apiPost.mockResolvedValue({ data: { id: "stock_1", quantity: 9 }, error: null });
    renderCentre();
    await openAdjustAndApply();
    await waitFor(() => expect(screen.queryByText("Stock Adjustment")).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/**
 * SWEEP-P0-SCOPES review repair (finding CR-4): the Drive inventory-sheet writes now need storefront
 * write too (unlink, push). A refused unlink kept the sheet linked on the server but cleared it on
 * the page; a refused push said nothing. Each now says the server's reason, and an unlink the
 * server refused leaves the sheet shown as linked.
 */
describe("inventory command centre: refused inventory-sheet writes (CR-4)", () => {
  const SHEET = { connected: true, linkedSheetId: "sheet_1", linkedSheetName: "Owner stock sheet", lastSyncAt: null };

  async function openSpreadsheets() {
    api.apiGet.mockImplementation(async (path: string) =>
      path.includes("/inventory-sheet/status") ? { data: SHEET, error: null } : { data: null, error: null },
    );
    renderCentre();
    fireEvent.click(screen.getByRole("button", { name: /spreadsheets/i }));
    await screen.findByText("Owner stock sheet");
  }

  it("[WEB-INV-03] RED-BEFORE: a refused unlink shows the server's refusal and keeps the sheet linked", async () => {
    api.apiDelete.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    await openSpreadsheets();
    const unlink = document.querySelector('svg[class*="lucide-unlink"]')!.closest("button") as HTMLElement;
    fireEvent.click(unlink);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(screen.getByText("Owner stock sheet")).toBeInTheDocument();
  });

  it("[WEB-INV-04] RED-BEFORE: a refused push to the sheet shows the server's refusal", async () => {
    api.apiPost.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    await openSpreadsheets();
    fireEvent.click(screen.getByRole("button", { name: /push to sheet/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
  });

  it("[WEB-INV-05] an unlink the server applies clears the linked sheet", async () => {
    api.apiDelete.mockResolvedValue({ data: { success: true }, error: null });
    await openSpreadsheets();
    const unlink = document.querySelector('svg[class*="lucide-unlink"]')!.closest("button") as HTMLElement;
    fireEvent.click(unlink);
    await waitFor(() => expect(screen.queryByText("Owner stock sheet")).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
  });
});
