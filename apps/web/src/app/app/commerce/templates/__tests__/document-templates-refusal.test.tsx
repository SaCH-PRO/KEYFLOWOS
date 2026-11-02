/**
 * R0-09g-D11-DOCUMENT-TEMPLATES: the two screens that change the business's
 * default invoice and quote templates show a refused change as a refusal and
 * keep the stored template on screen.
 *
 * WHY this test exists: owner ruling D-11 makes the business profile, and so
 * Business.invoiceTemplate and quoteTemplate, OWNER only. Since R0-09g
 * PATCH /commerce/businesses/:businessId/document-templates answers a
 * non-owner (an ADMIN, or a STAFF member, whatever its revenue scope)
 * 403 { code: "BUSINESS_PROFILE_OWNER_ONLY", message: "Only the business
 * owner can change the document templates." }. apiPatch answers a 403 with
 * { data: null, error, status, rawError } instead of throwing. The Document
 * Templates page only raised a toast (nothing on the page itself) and the
 * billing form modal's template picker a generic "Failed to update template"
 * toast, so a refused member was never told why, and nothing on screen said
 * the change had not been made.
 *
 * Mounted: the real Document Templates page and the real BillingFormModal,
 * with the real client.ts fetchDocumentTemplates and setDocumentTemplate; only
 * the api module's apiGet/apiPatch are stubbed (the refusal is the exact shape
 * apiPatch produces from the production GlobalHttpExceptionFilter body), and
 * sonner's toast is a recorder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPatch: api.apiPatch };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: toasts.success, error: toasts.error, info: vi.fn(), warning: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce/templates",
  useSearchParams: () => new URLSearchParams(),
}));

import DocumentTemplatesPage from "../page";
import { BillingFormModal } from "../../components/billing-form-modal";

const BUSINESS = "biz_doc_templates_1";
const PATCH_PATH = `/commerce/businesses/${BUSINESS}/document-templates`;
const SERVER_REFUSAL = "Only the business owner can change the document templates.";
const OWNER_ONLY_FALLBACK = "Only the business owner can change the default document templates.";

type ApiResult = { data: unknown; error: string | null; status?: number; rawError?: Record<string, unknown> | null };

/** GET .../document-templates as the server answers it: the stored defaults are Classic. */
function storedTemplates() {
  const ids = ["classic", "modern", "minimal"] as const;
  const name = (id: string) => id[0].toUpperCase() + id.slice(1);
  return {
    templates: [
      ...ids.map((id) => ({ id, type: "invoice", name: name(id), isDefault: id === "classic" })),
      ...ids.map((id) => ({ id, type: "quote", name: name(id), isDefault: id === "classic" })),
    ],
    branding: {},
  };
}

/** apiPatch's result for a 403 the production filter rendered (with `message`, or with a generic one). */
function forbidden(message: string | undefined): ApiResult {
  const body: Record<string, unknown> = {
    statusCode: 403, code: "BUSINESS_PROFILE_OWNER_ONLY", error: "Forbidden",
    timestamp: "2026-11-02T00:00:00.000Z", path: PATCH_PATH,
  };
  if (message !== undefined) body.message = message;
  // handleErrorResponse: message, else error, else statusText.
  return { data: null, error: message ?? "Forbidden", status: 403, rawError: body };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BUSINESS);
  api.apiGet.mockImplementation(async (path: string) => {
    if (path.endsWith("/document-templates")) return { data: storedTemplates(), error: null };
    return { data: null, error: null }; // the modal's business preview: not on this path
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// The Document Templates page (/app/commerce/templates)
// ---------------------------------------------------------------------------

/** The card of one template (the page labels each card "<Name> <type> template"). */
const card = (name: string, type: "invoice" | "quote") => screen.getByRole("group", { name: `${name} ${type} template` });

/** Mount the page and ask for Modern as the default invoice template. */
async function setModernInvoiceDefault() {
  render(<DocumentTemplatesPage />);
  await screen.findByRole("group", { name: "Modern invoice template" });
  fireEvent.click(within(card("Modern", "invoice")).getByRole("button", { name: "Set as default" }));
  await waitFor(() => expect(api.apiPatch).toHaveBeenCalled());
}

/** The stored template is what the page still shows: Classic is the invoice default, Modern still offers "Set as default". */
function expectStoredInvoiceDefaultShown() {
  expect(within(card("Classic", "invoice")).getByText("Default")).toBeInTheDocument();
  expect(within(card("Modern", "invoice")).queryByText("Default")).not.toBeInTheDocument();
  expect(within(card("Modern", "invoice")).getByRole("button", { name: "Set as default" })).toBeInTheDocument();
}

describe("document templates page: a refused change shows the refusal and keeps the stored template", () => {
  it("[R0-09g-W01] RED-BEFORE: 403 BUSINESS_PROFILE_OWNER_ONLY shows the server's refusal on the page; the stored default stays marked and no success is announced", async () => {
    api.apiPatch.mockResolvedValue(forbidden(SERVER_REFUSAL));
    await setModernInvoiceDefault();

    expect(api.apiPatch).toHaveBeenCalledWith(PATCH_PATH, { invoiceTemplate: "modern" });
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);
    expectStoredInvoiceDefaultShown();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("[R0-09g-W02] RED-BEFORE: a 403 with no usable message falls back to 'Only the business owner can change the default document templates.'", async () => {
    api.apiPatch.mockResolvedValue(forbidden(undefined));
    await setModernInvoiceDefault();

    expect(await screen.findByRole("alert")).toHaveTextContent(OWNER_ONLY_FALLBACK);
    expectStoredInvoiceDefaultShown();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("[R0-09g-W03] RED-BEFORE: Set as default stays offered after a refusal; trying again clears the old refusal while the second change is in flight, and a second refusal shows again", async () => {
    api.apiPatch.mockResolvedValueOnce(forbidden(SERVER_REFUSAL));
    await setModernInvoiceDefault();
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);

    let settle: (value: ApiResult) => void = () => {};
    api.apiPatch.mockImplementationOnce(() => new Promise<ApiResult>((resolve) => { settle = resolve; }));
    fireEvent.click(within(card("Modern", "invoice")).getByRole("button", { name: "Set as default" }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    settle(forbidden(SERVER_REFUSAL));
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);
    expectStoredInvoiceDefaultShown();
  });

  it("[R0-09g-W04] control: an accepted change marks the new default, announces it and shows no refusal", async () => {
    api.apiPatch.mockResolvedValue({ data: { success: true, invoiceTemplate: "modern" }, error: null });
    await setModernInvoiceDefault();

    await waitFor(() => expect(within(card("Modern", "invoice")).getByText("Default")).toBeInTheDocument());
    expect(within(card("Classic", "invoice")).queryByText("Default")).not.toBeInTheDocument();
    expect(within(card("Classic", "quote")).getByText("Default")).toBeInTheDocument();
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The billing form modal's Document Template picker (new invoice / quote)
// ---------------------------------------------------------------------------

const noop = () => {};

function renderModal() {
  return render(
    <BillingFormModal
      open
      onClose={noop}
      onSubmit={noop}
      docType="invoice"
      isEditing={false}
      contacts={[]}
      products={[]}
      contactId=""
      onContactChange={noop}
      dateValue=""
      onDateChange={noop}
      items={[]}
      onAddItem={noop}
      onRemoveItem={noop}
      onUpdateItem={noop}
      onSelectProduct={noop}
      taxRate=""
      onTaxRateChange={noop}
      discountType="PERCENT"
      onDiscountTypeChange={noop}
      discountValue=""
      onDiscountValueChange={noop}
      notes=""
      onNotesChange={noop}
      businessId={BUSINESS}
    />,
  );
}

/** The picker marks the stored (selected) template with the accent and every other one with the plain border. */
const UNSELECTED = "border-border/30";

/** Mount the modal, open the Document Template section and pick Modern. */
async function pickModernInModal() {
  renderModal();
  fireEvent.click(await screen.findByRole("button", { name: /Document Template/ }));
  // The stored default (Classic) is the selected one before anything is picked.
  await waitFor(() => expect(screen.getByRole("button", { name: "Classic" })).not.toHaveClass(UNSELECTED));
  fireEvent.click(screen.getByRole("button", { name: "Modern" }));
  await waitFor(() => expect(api.apiPatch).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Modern" })).not.toBeDisabled());
}

describe("billing form modal: a refused template change shows the refusal and keeps the stored template selected", () => {
  it("[R0-09g-M01] RED-BEFORE: 403 BUSINESS_PROFILE_OWNER_ONLY shows the server's refusal in the modal; Classic stays selected, and picking Modern again asks the server again", async () => {
    api.apiPatch.mockResolvedValue(forbidden(SERVER_REFUSAL));
    await pickModernInModal();

    expect(api.apiPatch).toHaveBeenCalledWith(PATCH_PATH, { invoiceTemplate: "modern" });
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);
    expect(screen.getByRole("button", { name: "Classic" })).not.toHaveClass(UNSELECTED);
    expect(screen.getByRole("button", { name: "Modern" })).toHaveClass(UNSELECTED);
    expect(toasts.success).not.toHaveBeenCalled();

    // Not recorded as the selection: the same pick is a new request, not a no-op.
    fireEvent.click(screen.getByRole("button", { name: "Modern" }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(2));
  });

  it("[R0-09g-M02] RED-BEFORE: a 403 with no usable message falls back to 'Only the business owner can change the default document templates.'", async () => {
    api.apiPatch.mockResolvedValue(forbidden(undefined));
    await pickModernInModal();

    expect(await screen.findByRole("alert")).toHaveTextContent(OWNER_ONLY_FALLBACK);
    expect(screen.getByRole("button", { name: "Classic" })).not.toHaveClass(UNSELECTED);
  });

  it("[R0-09g-M03] control: an accepted change selects Modern, announces it and shows no refusal", async () => {
    api.apiPatch.mockResolvedValue({ data: { success: true, invoiceTemplate: "modern" }, error: null });
    await pickModernInModal();

    await waitFor(() => expect(screen.getByRole("button", { name: "Modern" })).not.toHaveClass(UNSELECTED));
    expect(screen.getByRole("button", { name: "Classic" })).toHaveClass(UNSELECTED);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
