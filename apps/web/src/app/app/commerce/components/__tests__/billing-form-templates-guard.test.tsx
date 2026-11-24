/**
 * FU-BILLING-TEMPLATES-GUARD (board P13; from wave 3m's reviews): the invoice and quote sheet opens whatever the
 * document-templates read answers.
 *
 * billing-form-modal.tsx read `res.data.templates.filter(...)` with no guard, so an answer that carries no templates
 * list (an older server, a business with none stored, a partial answer) threw a TypeError inside the sheet's open
 * effect: an unhandled rejection, and the template default was never set. commerce/templates/page.tsx already reads the
 * same field as `res.data.templates ?? []`.
 *
 *   BFT-01  RED-BEFORE  an answer with no templates list: no TypeError, the sheet stays usable
 *   BFT-02  RED-BEFORE  an answer whose templates is null: no TypeError
 *   BFT-03  control     an answer with templates: the sheet opens as before
 *   BFT-04  control     no list and no branding template: the default is Classic (as the server answers today)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const templates = vi.hoisted(() => ({ answer: { data: { templates: [], branding: {} } as unknown, error: null as string | null } }));
const fetchSpy = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("../../hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: { name: "Acme Bakery", primaryColor: "#F97316", secondaryColor: "#111" }, saveBranding: vi.fn(), savingBranding: false }),
}));
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    fetchDocumentTemplates: fetchSpy.mockImplementation(async () => templates.answer),
  };
});

import { BillingFormModal } from "../billing-form-modal";

function renderSheet() {
  return render(
    <BillingFormModal
      open
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      docType="invoice"
      isEditing={false}
      contacts={[]}
      products={[]}
      currency="TTD"
      contactId=""
      onContactChange={vi.fn()}
      dateValue=""
      onDateChange={vi.fn()}
      items={[{ id: "i1", productId: "", description: "Cake", quantity: "1", unitPrice: "100" }]}
      onAddItem={vi.fn()}
      onRemoveItem={vi.fn()}
      onUpdateItem={vi.fn()}
      onSelectProduct={vi.fn()}
      taxRate=""
      onTaxRateChange={vi.fn()}
      discountType="PERCENT"
      onDiscountTypeChange={vi.fn()}
      discountValue=""
      onDiscountValueChange={vi.fn()}
      notes=""
      onNotesChange={vi.fn()}
      businessId="biz_p13"
    />,
  );
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled.length = 0;
  fetchSpy.mockClear();
  process.on("unhandledRejection", onUnhandled);
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  cleanup();
});

/** The preview's chosen template: the one template button carrying the check mark. */
async function chosenTemplate(): Promise<string> {
  await screen.findByRole("heading", { name: /^preview/i });
  const marked = screen
    .getAllByRole("button", { name: /^(classic|modern|minimal)$/i })
    .filter((b) => b.querySelector("svg"));
  expect(marked, "exactly one template is chosen").toHaveLength(1);
  return (marked[0].textContent ?? "").trim();
}

/** Lets the open effect's read settle, and any rejection it raised be reported. */
async function settle() {
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
}

describe("FU-BILLING-TEMPLATES-GUARD: the sheet opens whatever the templates read answers", () => {
  it("BFT-01 RED-BEFORE: an answer with no templates list raises no TypeError, and the sheet stays usable", async () => {
    templates.answer = { data: { branding: { invoiceTemplate: "modern" } }, error: null };
    renderSheet();
    await settle();
    expect(unhandled.map(String)).toEqual([]);
    expect(screen.getByRole("dialog", { name: /new invoice|create invoice|invoice/i })).toBeInTheDocument();
    // The default still comes from the branding when no list came (reviews' minor): the preview opens on it.
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(await chosenTemplate()).toMatch(/modern/i);
  });

  it("BFT-04 control: with no list and no branding template, the preview opens on Classic", async () => {
    templates.answer = { data: { branding: {} }, error: null };
    renderSheet();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(await chosenTemplate()).toMatch(/classic/i);
  });

  it("BFT-02 RED-BEFORE: an answer whose templates is null raises no TypeError", async () => {
    templates.answer = { data: { templates: null, branding: {} }, error: null };
    renderSheet();
    await settle();
    expect(unhandled.map(String)).toEqual([]);
  });

  it("BFT-03 control: an answer with templates opens the sheet as before", async () => {
    templates.answer = {
      data: { templates: [{ id: "minimal", name: "Minimal", type: "invoice", isDefault: true }], branding: {} },
      error: null,
    };
    renderSheet();
    await settle();
    expect(unhandled.map(String)).toEqual([]);
    expect(screen.getByRole("dialog", { name: /invoice/i })).toBeInTheDocument();
  });
});
