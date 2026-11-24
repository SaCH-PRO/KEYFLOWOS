/**
 * SWP-INV-MATH (BUG-018, BUG-019; taxorder ruling D-164): every invoice and quote preview shows the total the server
 * will save, and clearing the tax rate removes the tax.
 *
 * At the base the full-page new and edit invoice forms took tax AFTER the discount (the server takes it on the
 * subtotal before the discount) and multiplied floats; the quote and composer builder (billing-form-modal) took the
 * right order but multiplied floats too; and the edit form sent no taxRate when the rate was cleared, so the server
 * kept the old rate.
 *
 * Journey D's quote: a TTD 800 cake and 24 cupcakes at 10, 12.5% tax, 10% off. Server: 1040 + 130 - 104 = 1066.00.
 * The forms showed 936 + 117 = 1053.00.
 *
 *   IFA-01  RED-BEFORE  new invoice: the summary's Total due is TTD 1,066.00 (was 1,053.00), tax TTD 130.00
 *   IFA-02  RED-BEFORE  new invoice: a line of 3 x 1.115 shows TTD 3.35 (the float product reads 3.34)
 *   IFA-03  RED-BEFORE  edit invoice: the preview total is TTD 1,066.00, and clearing the tax rate saves taxRate 0
 *   IFA-04  RED-BEFORE  the quote and composer builder: 3 x 1.115 totals TTD 3.35, and (review F2) its line row
 *                       reads TTD 3.35 too (the row multiplied floats: TTD 3.34)
 *   IFA-05  control     the builder's tax-before-discount total for journey D's quote is TTD 1,066.00, as before
 *   IFA-06  control     Release 0's case: 2 x 100 + 1 x 50 is TTD 250.00 on the new invoice page
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce/invoices/new",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "inv_math_1" }),
}));
const BIZ = "biz_v1math";
vi.mock("@/lib/workspace", () => ({
  refreshWorkspace: async () => "biz_v1math",
  getStoredBusinessId: () => "biz_v1math",
  getCachedBusiness: () => ({ id: "biz_v1math", currency: "TTD" }),
}));
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    fetchContacts: async () => ({ data: { contacts: [] }, error: null }),
    fetchProducts: async () => ({ data: [], error: null }),
  };
});
vi.mock("@/app/app/commerce/hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: { name: "Acme Bakery", primaryColor: "#F97316", secondaryColor: "#111" }, saveBranding: vi.fn(), savingBranding: false }),
}));

import NewInvoicePage from "../new/page";
import EditInvoicePage from "../[id]/edit/page";
import { BillingFormModal } from "../../components/billing-form-modal";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, statusText: "OK", json: async () => JSON.parse(text) as unknown, text: async () => text } as unknown as Response;
}

const STORED = {
  // SWP-INV-FORM-UX: an invoice is to someone (a save with no client is refused), so the stored draft names one.
  id: "inv_math_1", invoiceNumber: "INV-0001", status: "DRAFT", currency: "TTD", contactId: "ct_math", dueDate: null,
  items: [
    { id: "it1", description: "Wedding cake, 3 tier", quantity: 1, unitPrice: 800, total: 800 },
    { id: "it2", description: "Cupcakes", quantity: 24, unitPrice: 10, total: 240 },
  ],
  taxRate: 12.5, discountType: "PERCENT", discountValue: 10, notes: null,
};

type Call = { method: string; path: string; body: Record<string, unknown> | null };
function installServer() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    if (url.pathname === `/commerce/businesses/${BIZ}/invoices/inv_math_1`) return jsonResponse(200, method === "GET" ? STORED : { ...STORED });
    if (/template/i.test(url.pathname)) return jsonResponse(200, { templates: [], branding: {} });
    return jsonResponse(200, {});
  }));
  return { calls };
}

/** The new-invoice page's line rows: description, quantity and price inputs in order. */
async function fillLines(lines: Array<[string, string, string]>) {
  await screen.findByPlaceholderText("Item description");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    const desc = screen.getAllByPlaceholderText("Item description")[i]!;
    const qty = screen.getAllByRole("spinbutton").filter((el) => el.getAttribute("min") === "1")[i]!;
    const price = (Array.from(document.querySelectorAll('input[type="number"][step="0.01"]')) as HTMLInputElement[])[i]!;
    fireEvent.change(desc, { target: { value: lines[i]![0] } });
    fireEvent.change(qty, { target: { value: lines[i]![1] } });
    fireEvent.change(price, { target: { value: lines[i]![2] } });
  }
}

/** The Tax Rate input and the discount value input of the full-page forms. */
const taxInput = () => screen.getByText("Tax Rate (%)").parentElement!.querySelector("input") as HTMLInputElement;
const discountInput = () => screen.getByText("Discount").parentElement!.querySelector('input[type="number"]') as HTMLInputElement;
const totalDue = () => screen.getByText(/^Total due$/).parentElement!.textContent ?? "";

beforeEach(() => {
  window.localStorage.setItem("kf_token", "token-v1math");
  nav.push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SWP-INV-MATH: the preview total is the total the server saves", () => {
  it("IFA-01 RED-BEFORE: new invoice, journey D's quote: Total due TTD 1,066.00 and tax TTD 130.00", async () => {
    installServer();
    render(<NewInvoicePage />);
    await fillLines([["Wedding cake, 3 tier", "1", "800"], ["Cupcakes", "24", "10"]]);
    fireEvent.change(taxInput(), { target: { value: "12.5" } });
    fireEvent.change(discountInput(), { target: { value: "10" } });
    await waitFor(() => expect(totalDue()).toContain("TTD 1,066.00"));
    const summary = screen.getByText("Summary").parentElement!;
    expect(within(summary).getByText("TTD 130.00")).toBeInTheDocument();
    expect(within(summary).getByText("-TTD 104.00")).toBeInTheDocument();
  });

  it("IFA-02 RED-BEFORE: new invoice, a line of 3 x 1.115 shows and totals TTD 3.35", async () => {
    installServer();
    render(<NewInvoicePage />);
    await fillLines([["Ribbon", "3", "1.115"]]);
    await waitFor(() => expect(totalDue()).toContain("TTD 3.35"));
    expect(screen.queryAllByText("TTD 3.34")).toEqual([]);
  });

  it("IFA-03 RED-BEFORE: edit invoice previews TTD 1,066.00, and clearing the tax rate saves taxRate 0", async () => {
    const server = installServer();
    render(<EditInvoicePage />);
    await waitFor(() => expect(taxInput().value).toBe("12.5"));
    await waitFor(() => expect(totalDue()).toContain("TTD 1,066.00"));
    fireEvent.change(taxInput(), { target: { value: "" } });
    await waitFor(() => expect(totalDue()).toContain("TTD 936.00"));
    // The page offers Save Changes at the top and the bottom; either saves.
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]!);
    await waitFor(() => expect(server.calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    const body = server.calls.find((c) => c.method === "PATCH")!.body!;
    expect(body).toHaveProperty("taxRate", 0);
  });

  const builder = (items: Array<{ quantity: string; unitPrice: string; description: string }>, taxRate: string, discountValue: string) => (
    <BillingFormModal
      open onClose={vi.fn()} onSubmit={vi.fn()} docType="quote" isEditing={false} contacts={[]} products={[]} currency="TTD"
      contactId="" onContactChange={vi.fn()} dateValue="" onDateChange={vi.fn()}
      items={items.map((it, i) => ({ id: `l${i}`, productId: "", ...it }))}
      onAddItem={vi.fn()} onRemoveItem={vi.fn()} onUpdateItem={vi.fn()} onSelectProduct={vi.fn()}
      taxRate={taxRate} onTaxRateChange={vi.fn()} discountType="PERCENT" onDiscountTypeChange={vi.fn()}
      discountValue={discountValue} onDiscountValueChange={vi.fn()} notes="" onNotesChange={vi.fn()} businessId={BIZ}
    />
  );
  const builderTotal = () => screen.getByText(/^Total$/).parentElement!.textContent ?? "";

  it("IFA-04 RED-BEFORE: the quote and composer builder totals 3 x 1.115 as TTD 3.35", async () => {
    installServer();
    render(builder([{ description: "Ribbon", quantity: "3", unitPrice: "1.115" }], "", ""));
    expect(builderTotal()).toContain("TTD 3.35");
    // The line row's own "Subtotal:" (form-line-items-section) reads the same amount.
    const row = screen.getAllByText(/^Subtotal:/).map((el) => (el.textContent ?? "").replace(/\s+/g, " "));
    expect(row).toEqual(["Subtotal: TTD 3.35"]);
  });

  it("IFA-05 control: the builder's total for journey D's quote is TTD 1,066.00", async () => {
    installServer();
    render(builder([{ description: "Wedding cake, 3 tier", quantity: "1", unitPrice: "800" }, { description: "Cupcakes", quantity: "24", unitPrice: "10" }], "12.5", "10"));
    expect(builderTotal()).toContain("TTD 1,066.00");
  });

  it("IFA-06 control: Release 0's case, 2 x 100 + 1 x 50, is TTD 250.00 on the new invoice page", async () => {
    installServer();
    render(<NewInvoicePage />);
    await fillLines([["Consultation", "2", "100"], ["Follow-up", "1", "50"]]);
    await waitFor(() => expect(totalDue()).toContain("TTD 250.00"));
  });
});
