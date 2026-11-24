/**
 * MOUNT-QUOTES, review round 1 (F2a): the document builder shows its Notes
 * when they matter.
 *
 * The builder's sections open with Details and Items only; Notes is collapsed
 * until its header is clicked. Journey D's D2 opens Edit on a draft quote that
 * carries deposit terms and fills the notes field straight away (as the
 * owner would: the terms are the point of the edit); with the section
 * collapsed there is no notes field to fill.
 *
 * THE RULE: the Notes section opens with the sheet when the sheet is editing
 * an existing document or the document already has notes; a new, empty
 * document keeps it collapsed as before.
 *
 *   BFN-01  RED-BEFORE  editing a quote with notes: the notes field is on screen with the notes
 *   BFN-02  RED-BEFORE  a new quote prefilled with notes (Duplicate): the notes field is on screen
 *   BFN-03  control     a new, empty quote: Notes stays collapsed until its header is clicked
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("../../hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: { name: "Acme Bakery", primaryColor: "#F97316", secondaryColor: "#111" }, saveBranding: vi.fn(), savingBranding: false }),
}));
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return { ...actual, fetchDocumentTemplates: vi.fn(async () => ({ data: { templates: [], branding: {} }, error: null })) };
});

import { BillingFormModal } from "../billing-form-modal";

function renderSheet(props: { isEditing: boolean; notes: string }) {
  return render(
    <BillingFormModal
      open
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      docType="quote"
      isEditing={props.isEditing}
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
      taxRate="12.5"
      onTaxRateChange={vi.fn()}
      discountType="PERCENT"
      onDiscountTypeChange={vi.fn()}
      discountValue=""
      onDiscountValueChange={vi.fn()}
      notes={props.notes}
      onNotesChange={vi.fn()}
      businessId="biz_v1mq"
    />,
  );
}

const notesField = () => screen.queryByPlaceholderText(/add notes to this quote/i) as HTMLTextAreaElement | null;

afterEach(cleanup);

describe("MOUNT-QUOTES: the builder's Notes section opens when the notes matter", () => {
  it("BFN-01 RED-BEFORE: editing a quote with notes shows the notes field with the notes", () => {
    renderSheet({ isEditing: true, notes: "50% deposit to confirm the date" });
    expect(screen.getByRole("dialog", { name: /edit quote/i })).toBeInTheDocument();
    expect(notesField()).not.toBeNull();
    expect(notesField()!.value).toBe("50% deposit to confirm the date");
  });

  it("BFN-02 RED-BEFORE: a new quote prefilled with notes (a duplicate) shows the notes field", () => {
    renderSheet({ isEditing: false, notes: "50% deposit to confirm the date" });
    expect(notesField()).not.toBeNull();
  });

  it("BFN-03 control: a new, empty quote keeps Notes collapsed until its header is clicked", () => {
    renderSheet({ isEditing: false, notes: "" });
    expect(notesField()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^notes$/i }));
    expect(notesField()).not.toBeNull();
  });
});
