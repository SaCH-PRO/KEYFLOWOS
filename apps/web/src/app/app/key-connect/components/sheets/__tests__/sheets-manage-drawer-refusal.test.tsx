/**
 * SWEEP-P0-SCOPES round 1 class repair (finding RC-3, minor): the Key Connect inventory-sheet
 * drawer shows the server's refusal and keeps what the server still holds.
 *
 * The inventory-sheet writes (create, link, unlink, push, apply) need storefront write since this
 * packet. The CR-4 repair fixed the identical handlers in the marketplace inventory command centre,
 * but SheetsManageDrawer (Key Connect) kept ignoring every write's answer: on a 403 its unlink
 * cleared the linked sheet and showed "Link a sheet" with no message (the sheet is still linked on
 * the server), and push, link, create and apply said nothing.
 *
 * Required: a refused write shows the server's refusal and never shows the refused change; a write
 * the server applies shows it, as before.
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

import { SheetsManageDrawer } from "../sheets-manage-drawer";

const LINKED = { connected: true, linkedSheetId: "sheet_owner", linkedSheetName: "Owner Inventory Sheet", lastSyncAt: null };
const UNLINKED = { connected: true, linkedSheetId: null, linkedSheetName: null, lastSyncAt: null };
let status: Record<string, unknown> = LINKED;

/** The unlink control: the button that carries the Unlink icon (lucide renders it as svg.lucide-unlink). */
function unlinkButton(container: HTMLElement): HTMLElement {
  const button = container.querySelector("svg.lucide-unlink")?.closest("button");
  if (!button) throw new Error("no unlink button");
  return button as HTMLElement;
}

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  api.apiDelete.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  status = LINKED;
  api.apiGet.mockImplementation(async (path: string) =>
    path.includes("/inventory-sheet/status") ? { data: status, error: null } : { data: null, error: null },
  );
});
afterEach(() => cleanup());

describe("Key Connect sheets drawer: a refused write says why and changes nothing on screen", () => {
  it("[WEB-SHT-01] RED-BEFORE: a refused unlink shows the server's refusal and the sheet stays linked", async () => {
    api.apiDelete.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    const { container } = render(<SheetsManageDrawer businessId="biz_1" />);
    await screen.findByText("Owner Inventory Sheet");
    fireEvent.click(unlinkButton(container));
    await waitFor(() => expect(api.apiDelete).toHaveBeenCalledWith("/drive/businesses/biz_1/inventory-sheet/unlink"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(screen.getByText("Owner Inventory Sheet")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("[WEB-SHT-02] an unlink the server applies shows the sheet unlinked", async () => {
    api.apiDelete.mockResolvedValue({ data: { success: true }, error: null });
    const { container } = render(<SheetsManageDrawer businessId="biz_1" />);
    await screen.findByText("Owner Inventory Sheet");
    fireEvent.click(unlinkButton(container));
    await waitFor(() => expect(screen.queryByText("Owner Inventory Sheet")).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("[WEB-SHT-03] RED-BEFORE: a refused push to the sheet shows the server's refusal", async () => {
    api.apiPost.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    render(<SheetsManageDrawer businessId="biz_1" />);
    await screen.findByText("Owner Inventory Sheet");
    fireEvent.click(screen.getByRole("button", { name: /push to sheet/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith(expect.objectContaining({ path: "/drive/businesses/biz_1/inventory-sheet/push" })));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
  });

  it("[WEB-SHT-04] RED-BEFORE: a refused create or link of a sheet shows the server's refusal and leaves no sheet linked", async () => {
    status = UNLINKED;
    api.apiPost.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    render(<SheetsManageDrawer businessId="biz_1" />);
    fireEvent.click(await screen.findByRole("button", { name: /create new sheet/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith(expect.objectContaining({ path: "/drive/businesses/biz_1/inventory-sheet/create" })));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    toast.error.mockReset();
    fireEvent.click(screen.getByRole("button", { name: /link existing sheet/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste google sheets url/i), { target: { value: "https://docs.google.com/spreadsheets/d/sheet_9/edit" } });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith(expect.objectContaining({ path: "/drive/businesses/biz_1/inventory-sheet/link" })));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(screen.queryByText("Linked Sheet")).toBeNull();
  });
});
