/**
 * W6-TRASH-MODULE-SCOPE (owner ruling D-95) — the Trash page shows a refused
 * restore or permanent delete and keeps the row.
 *
 * WHY: handleRestore and handleDelete awaited restoreTrashItem /
 * permanentDeleteTrashItem and dropped the row without reading the ApiResult's
 * error, so a refusal (D-95: 403 '<module> requires write access', a 404
 * 'Trashed <model> not found', a 409 for a model that can only be restored)
 * looked like success: the row vanished and came back on the next load. The
 * page now shows the server's message and keeps the row; only a call that
 * succeeded drops it. The server half is
 * apps/server/test/d46-commerce-writes.integration.test.ts D95-H01..H05.
 *
 * Also pinned: a refused listing (D-95: 403 '<module> requires read access')
 * shows its message rather than "Trash is empty", and a row listed under a
 * model filter (the server's ?model= rows carry no _model) is restored as that
 * model, not as 'item' (which the server answers 400 'not trashable').
 *
 * Mounted on the real TrashPage; the client calls and the workspace are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const BUSINESS = "biz_trash_d95";
const REFUSED = "Insufficient permissions: crm requires write access (you have read)";

const fetchTrashItems = vi.fn();
const restoreTrashItem = vi.fn();
const permanentDeleteTrashItem = vi.fn();

vi.mock("@/lib/workspace", () => ({
  refreshWorkspace: vi.fn(async () => BUSINESS),
  getStoredBusinessId: () => BUSINESS,
}));
vi.mock("@/lib/client", () => ({
  fetchTrashItems: (...args: unknown[]) => fetchTrashItems(...args),
  restoreTrashItem: (...args: unknown[]) => restoreTrashItem(...args),
  permanentDeleteTrashItem: (...args: unknown[]) => permanentDeleteTrashItem(...args),
}));

import TrashPage from "../page";

const CONTACT = { id: "contact_d95", _model: "contact", firstName: "Ada Trashed", businessId: BUSINESS, deletedAt: "2026-11-01T00:00:00.000Z" };
const STAFF = { id: "staff_d95", _model: "staffMember", name: "Ben Trashed", businessId: BUSINESS, deletedAt: "2026-11-02T00:00:00.000Z" };

function listing(items: Array<Record<string, unknown>>) {
  return { data: { items, total: items.length }, error: null };
}

async function mounted() {
  render(<TrashPage />);
  await screen.findByText("Ada Trashed");
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("div.flex.items-center") as HTMLElement | null;
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("W6-TRASH-MODULE-SCOPE (D-95): the Trash page shows a refused restore or delete and keeps the row", () => {
  beforeEach(() => {
    fetchTrashItems.mockReset();
    restoreTrashItem.mockReset();
    permanentDeleteTrashItem.mockReset();
    fetchTrashItems.mockImplementation(async () => listing([CONTACT, STAFF]));
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("D95-W01 (D-95): a restore the server refuses (403 'crm requires write access') shows the server's message and keeps the row and the count", async () => {
    restoreTrashItem.mockResolvedValue({ data: null, error: REFUSED });
    await mounted();
    fireEvent.click(within(rowOf("Ada Trashed")).getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(restoreTrashItem).toHaveBeenCalledWith(BUSINESS, "contact", CONTACT.id));
    // RED-BEFORE: no message; the row dropped and the count went to 1 although nothing was restored.
    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSED);
    expect(screen.getByText("Ada Trashed")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });

  it("D95-W02 (D-95): a permanent delete the server refuses (409, the record can only be restored) shows the server's message and keeps the row", async () => {
    const conflict = "Permanent delete is not available for a trashed contact: it can only be restored";
    permanentDeleteTrashItem.mockResolvedValue({ data: null, error: conflict });
    await mounted();
    fireEvent.click(within(rowOf("Ada Trashed")).getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(permanentDeleteTrashItem).toHaveBeenCalledWith(BUSINESS, "contact", CONTACT.id));
    // RED-BEFORE: no message; the row dropped.
    expect(await screen.findByRole("alert")).toHaveTextContent(conflict);
    expect(screen.getByText("Ada Trashed")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });

  it("D95-W03 control: a restore and a permanent delete that succeed drop their rows, and no error shows", async () => {
    restoreTrashItem.mockResolvedValue({ data: { restored: true, model: "contact", id: CONTACT.id }, error: null });
    permanentDeleteTrashItem.mockResolvedValue({ data: { deleted: true, model: "staffMember", id: STAFF.id }, error: null });
    await mounted();
    fireEvent.click(within(rowOf("Ada Trashed")).getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(screen.queryByText("Ada Trashed")).not.toBeInTheDocument());
    fireEvent.click(within(rowOf("Ben Trashed")).getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("Ben Trashed")).not.toBeInTheDocument());
    expect(screen.getByText("0 items")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("D95-W04 (D-95): a listing the server refuses (403 'crm requires read access') shows the server's message, not 'Trash is empty'", async () => {
    const readRefused = "Insufficient permissions: crm requires read access (you have none)";
    fetchTrashItems.mockImplementation(async (_b: string, params?: { model?: string }) =>
      params?.model === "contact" ? { data: { items: [], total: 0 }, error: readRefused } : listing([CONTACT, STAFF]),
    );
    await mounted();
    fireEvent.click(screen.getByRole("button", { name: "Contacts" }));
    // RED-BEFORE: "Trash is empty." and no message.
    expect(await screen.findByRole("alert")).toHaveTextContent(readRefused);
    expect(screen.queryByText("Trash is empty.")).not.toBeInTheDocument();
  });

  it("D95-W05: under a model filter (rows without _model) Restore names the filtered model, not 'item'", async () => {
    const { _model: _omit, ...bare } = CONTACT;
    fetchTrashItems.mockImplementation(async (_b: string, params?: { model?: string }) =>
      params?.model === "contact" ? listing([bare]) : listing([CONTACT, STAFF]),
    );
    restoreTrashItem.mockResolvedValue({ data: { restored: true, model: "contact", id: CONTACT.id }, error: null });
    await mounted();
    fireEvent.click(screen.getByRole("button", { name: "Contacts" }));
    await waitFor(() => expect(fetchTrashItems).toHaveBeenCalledWith(BUSINESS, expect.objectContaining({ model: "contact" })));
    await waitFor(() => expect(screen.queryByText("Ben Trashed")).not.toBeInTheDocument());
    fireEvent.click(within(rowOf("Ada Trashed")).getByRole("button", { name: /restore/i }));
    // RED-BEFORE: restoreTrashItem(BUSINESS, 'item', id), which the server answers 400 'not trashable'.
    await waitFor(() => expect(restoreTrashItem).toHaveBeenCalledWith(BUSINESS, "contact", CONTACT.id));
  });
});
