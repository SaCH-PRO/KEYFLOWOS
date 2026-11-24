/**
 * SWP-INV-FORM-UX (BUG-090, BUG-092, BUG-093; BUG-052 in the browser half, e2e/sweep-invoice-form.spec.ts): the
 * full-page invoice forms ask for a client in plain words, say when the invoice to edit does not exist, and offer no
 * template picker that does nothing.
 *
 * At the base:
 *   - Save Draft with no client sent the create anyway, with no contactId, and the member got the server's error or a
 *     client-less draft (BUG-090);
 *   - /app/commerce/invoices/<missing or foreign id>/edit showed an empty, editable form with Save Changes (BUG-092);
 *   - the new-invoice page offered a Classic / Modern / Minimal picker whose choice went nowhere (BUG-093; templates
 *     live in Settings > Documents & messages).
 *
 *   FUX-01  RED-BEFORE  new invoice, no client: Save Draft and Save & Send say "Choose a client" and send nothing
 *   FUX-02  RED-BEFORE  edit invoice, client cleared: Save Changes says "Choose a client" and sends nothing
 *   FUX-03  RED-BEFORE  edit of a missing invoice (404): the "Invoice not found" heading, no form, no Save Changes
 *   FUX-04  RED-BEFORE  neither form offers a template picker
 *   FUX-05  control     Release 0's controls on the new page stay: the heading, 'Select a client...', Add item, the
 *                       'Item description' placeholder, two number inputs per line, Save Draft
 *   FUX-06  control     with a client chosen, Save Draft creates the invoice with that contact
 *
 * Review round 1 (security MINOR-1, correctness F4 and F5):
 *   FUX-07  RED-BEFORE  a load that fails for another reason than 404 (a 500, a refusal, the network) is not "Invoice
 *                       not found": it says "Couldn't load this invoice", offers Try again, and shows no form; Try
 *                       again loads the invoice
 *   FUX-08  hardening   Save & Send alone, with no client, shows the message (FUX-01 saw it from Save Draft first)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
const nav = vi.hoisted(() => ({ push: vi.fn(), id: "inv_fux_1" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce/invoices/new",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: nav.id }),
}));
const BIZ = "biz_fux";
vi.mock("@/lib/workspace", () => ({
  refreshWorkspace: async () => "biz_fux",
  getStoredBusinessId: () => "biz_fux",
  getCachedBusiness: () => ({ id: "biz_fux", currency: "TTD" }),
}));
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    fetchContacts: async () => ({ data: { contacts: [{ id: "ct_fux", firstName: "Kezia", lastName: "Baptiste", email: "kezia@example.test" }] }, error: null }),
    fetchProducts: async () => ({ data: [], error: null }),
  };
});

import NewInvoicePage from "../new/page";
import EditInvoicePage from "../[id]/edit/page";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, statusText: status < 400 ? "OK" : "Not Found", json: async () => JSON.parse(text) as unknown, text: async () => text } as unknown as Response;
}

const STORED = {
  id: "inv_fux_1", invoiceNumber: "INV-0009", status: "DRAFT", currency: "TTD", contactId: "ct_fux", dueDate: null,
  items: [{ id: "it1", description: "Consulting", quantity: 2, unitPrice: 100, total: 200 }],
  taxRate: 0, discountType: null, discountValue: null, notes: null,
};

type Call = { method: string; path: string; body: Record<string, unknown> | null };
function installServer(opts: { missing?: boolean; failing?: number[] } = {}) {
  const calls: Call[] = [];
  const failing = [...(opts.failing ?? [])];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    if (url.pathname === `/commerce/businesses/${BIZ}/invoices/inv_fux_1`) {
      if (opts.missing) return jsonResponse(404, { statusCode: 404, message: "Invoice not found" });
      const status = failing.shift();
      if (status) return jsonResponse(status, { statusCode: status, message: "Internal server error" });
      return jsonResponse(200, STORED);
    }
    if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/invoices`) return jsonResponse(201, { ...STORED, id: "inv_new" });
    return jsonResponse(200, {});
  }));
  return { calls, writes: () => calls.filter((c) => c.method !== "GET") };
}

/** Fill the first line of the new-invoice page. */
async function fillFirstLine(description: string, qty: string, price: string) {
  const desc = await screen.findByPlaceholderText("Item description");
  fireEvent.change(desc, { target: { value: description } });
  const qtyInput = screen.getAllByRole("spinbutton").filter((el) => el.getAttribute("min") === "1")[0]!;
  const priceInput = (Array.from(document.querySelectorAll('input[type="number"][step="0.01"]')) as HTMLInputElement[])[0]!;
  fireEvent.change(qtyInput, { target: { value: qty } });
  fireEvent.change(priceInput, { target: { value: price } });
}

const clientSelect = () => screen.getByDisplayValue(/Select a client|Kezia/) as HTMLSelectElement;

beforeEach(() => {
  window.localStorage.setItem("kf_token", "token-fux");
  window.sessionStorage.clear();
  nav.push.mockReset();
  nav.id = "inv_fux_1";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SWP-INV-FORM-UX: the invoice forms", () => {
  it("FUX-01 RED-BEFORE: new invoice with no client: Save Draft and Save & Send say 'Choose a client' and send nothing", async () => {
    const server = installServer();
    render(<NewInvoicePage />);
    await fillFirstLine("Consulting", "2", "100");
    fireEvent.click(screen.getByRole("button", { name: /save draft/i }));
    expect(await screen.findByText(/choose a client/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /save & send/i })[0]!);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.writes()).toEqual([]);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("FUX-02 RED-BEFORE: edit invoice with the client cleared: Save Changes says 'Choose a client' and sends nothing", async () => {
    const server = installServer();
    render(<EditInvoicePage />);
    await waitFor(() => expect(clientSelect().value).toBe("ct_fux"));
    fireEvent.change(clientSelect(), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]!);
    expect(await screen.findByText(/choose a client/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.writes()).toEqual([]);
  });

  it("FUX-03 RED-BEFORE: edit of a missing invoice shows 'Invoice not found' and no form or Save Changes", async () => {
    nav.id = "inv_fux_1";
    const server = installServer({ missing: true });
    render(<EditInvoicePage />);
    expect(await screen.findByRole("heading", { name: "Invoice not found" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(screen.queryByText("Line Items")).toBeNull();
    expect(screen.getByRole("button", { name: /back to invoices/i })).toBeInTheDocument();
    expect(server.writes()).toEqual([]);
  });

  it("FUX-04 RED-BEFORE: neither form offers a template picker", async () => {
    installServer();
    render(<NewInvoicePage />);
    await screen.findByPlaceholderText("Item description");
    for (const name of ["Classic", "Modern", "Minimal"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Template" })).toBeNull();
    cleanup();
    render(<EditInvoicePage />);
    await waitFor(() => expect(clientSelect().value).toBe("ct_fux"));
    for (const name of ["Classic", "Modern", "Minimal"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("FUX-05 control: Release 0's controls on the new-invoice page stay", async () => {
    installServer();
    render(<NewInvoicePage />);
    expect(await screen.findByRole("heading", { name: "New Invoice" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Select a client..." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add item/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Item description")).toBeInTheDocument();
    const firstLine = screen.getByPlaceholderText("Item description").closest(".grid") as HTMLElement;
    expect(firstLine.querySelectorAll('input[type="number"]')).toHaveLength(2);
    expect(screen.getByRole("button", { name: /save draft/i })).toBeInTheDocument();
  });

  it("FUX-06 control: with a client chosen, Save Draft creates the invoice with that contact", async () => {
    const server = installServer();
    render(<NewInvoicePage />);
    await fillFirstLine("Consulting", "2", "100");
    fireEvent.change(clientSelect(), { target: { value: "ct_fux" } });
    fireEvent.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    expect(server.writes()[0]!.body).toMatchObject({ contactId: "ct_fux" });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/app/commerce/invoices/inv_new"));
  });

  it("FUX-07 RED-BEFORE: a failed load that is not a 404 says it could not load, offers Try again, and Try again loads the invoice", async () => {
    const server = installServer({ failing: [500] });
    render(<EditInvoicePage />);
    expect(await screen.findByRole("heading", { name: /couldn.t load this invoice/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Invoice not found" })).toBeNull();
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(clientSelect().value).toBe("ct_fux"));
    expect(screen.getAllByRole("button", { name: /save changes/i }).length).toBeGreaterThan(0);
    expect(server.writes()).toEqual([]);
  });

  it("FUX-08 hardening: Save & Send alone, with no client, says 'Choose a client' and sends nothing", async () => {
    const server = installServer();
    render(<NewInvoicePage />);
    await fillFirstLine("Consulting", "2", "100");
    fireEvent.click(screen.getAllByRole("button", { name: /save & send/i })[0]!);
    expect(await screen.findByText(/choose a client/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.writes()).toEqual([]);
  });
});
