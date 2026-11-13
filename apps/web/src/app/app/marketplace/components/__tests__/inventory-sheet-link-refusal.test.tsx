/**
 * SWEEP-P0-SCOPES second review repair (finding CRV-2, minor): linking an existing Google Sheet as
 * the inventory sheet says why when the server refuses it.
 *
 * POST /drive/businesses/:b/inventory-sheet/link needs storefront write in this packet (it was
 * membership-only). The repair's CR-4 made unlink, push, apply and create on this sheet show the
 * server's refusal, but not link: onLinkSheet chained the POST into a status reload and dropped its
 * error, so a refused link said nothing.
 *
 * Required: a refused link shows the server's refusal; a link the server applies shows the sheet.
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

const UNLINKED = { connected: true, linkedSheetId: null, linkedSheetName: null, lastSyncAt: null };
const LINKED = { connected: true, linkedSheetId: "sheet_9", linkedSheetName: "Staff stock sheet", lastSyncAt: null };

let status: Record<string, unknown> = UNLINKED;

function renderCentre() {
  render(
    <InventoryCommandCenter
      businessId="biz_1"
      basePath="/marketplace/businesses/biz_1"
      warehouses={[]}
      inventory={[]}
      products={[]}
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

async function linkSheet() {
  renderCentre();
  fireEvent.click(screen.getByRole("button", { name: /spreadsheets/i }));
  fireEvent.click(await screen.findByRole("button", { name: /link existing sheet/i }));
  fireEvent.change(screen.getByPlaceholderText(/paste google sheets url/i), { target: { value: "https://docs.google.com/spreadsheets/d/sheet_9/edit" } });
  fireEvent.click(screen.getByRole("button", { name: /^link$/i }));
}

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  status = UNLINKED;
  api.apiGet.mockImplementation(async (path: string) =>
    path.includes("/inventory-sheet/status") ? { data: status, error: null } : { data: null, error: null },
  );
});
afterEach(() => cleanup());

describe("inventory command centre: linking an existing sheet", () => {
  it("[WEB-INV-06] RED-BEFORE: a refused link shows the server's refusal and leaves the sheet unlinked", async () => {
    api.apiPost.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    await linkSheet();
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith(expect.objectContaining({ path: "/drive/businesses/biz_1/inventory-sheet/link" })));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(screen.queryByText("Staff stock sheet")).toBeNull();
  });

  it("[WEB-INV-07] a link the server applies shows the linked sheet", async () => {
    api.apiPost.mockImplementation(async () => {
      status = LINKED;
      return { data: { success: true }, error: null };
    });
    await linkSheet();
    await screen.findByText("Staff stock sheet");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
