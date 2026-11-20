/**
 * FU-WA-CONTACT-PHONE review repair COR-WACP-1: Escape on the WhatsApp confirm
 * step closes the step alone, not the invoice detail modal it was opened from.
 *
 * The owner opens an invoice's details (BillingDetailModal), presses the
 * modal's 'Share via WhatsApp' for a customer with a phone and no WhatsApp
 * number, and the confirm step opens over the modal. Escape is meant to close
 * the step and save and open nothing. Both the step and the modal listen for
 * Escape; before this repair the modal heard the same Escape and closed too,
 * so the member lost the invoice they were sharing from.
 *
 * Mounted on the real InvoicesPanel and the real BillingDetailModal (wrapped
 * only to count its onClose calls), the real client and the real
 * lib/whatsapp.ts, with fetch stubbed at the network edge
 * (invoices-whatsapp-confirm.test.tsx's harness).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Contact, Invoice } from "@/lib/client";

const detail = vi.hoisted(() => ({ closes: 0 }));

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce/invoices",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => {} }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task_wa", markTaskCompleted: vi.fn() }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => null }));
vi.mock("../../components/tax-summary-panel", () => ({ TaxSummaryPanel: () => null }));
vi.mock("../../components/dunning-rules", () => ({ DunningRulesPanel: () => null }));
vi.mock("../../components/invoice-mobile-actions", () => ({ InvoiceMobileActions: () => null }));
// The real detail modal, with its onClose counted.
vi.mock("../../components/billing-detail-modal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/billing-detail-modal")>();
  const { createElement } = await import("react");
  type Props = Parameters<typeof actual.BillingDetailModal>[0];
  return {
    ...actual,
    BillingDetailModal: (props: Props) =>
      createElement(actual.BillingDetailModal, {
        ...props,
        onClose: () => {
          detail.closes += 1;
          props.onClose();
        },
      }),
  };
});
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return {
    ...actual,
    getStoredBusinessId: () => BIZ,
    getCachedBusiness: () => ({ id: BIZ, name: "Sweet Treats" }),
  };
});

import InvoicesPanel from "../invoices-panel";

const BIZ = "biz_wa_confirm_esc";
const TOKEN = "tok_wa_confirm_esc_0001";
const CONTACT_PATH = `/crm/businesses/${BIZ}/contacts/ct_rena`;
const DETAIL = '[role="dialog"][aria-labelledby="billing-detail-invoice-INV-0042"]';

function invoice(): Invoice {
  return {
    id: "inv_wa",
    invoiceNumber: "INV-0042",
    status: "SENT",
    total: 250,
    currency: "TTD",
    payments: [],
    issueDate: new Date().toISOString(),
    dueDate: null,
    contactId: "ct_rena",
    contact: { firstName: "Rena", lastName: "Ali", email: "rena@example.test" },
    items: [],
  } as unknown as Invoice;
}

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Error" : "OK",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

let customer: Contact;
let patches: Array<Record<string, unknown>> = [];
let windowOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  customer = { id: "ct_rena", firstName: "Rena", lastName: "Ali", email: "rena@example.test", phone: "+1 868 755 0145", whatsappNumber: null } as Contact;
  patches = [];
  detail.closes = 0;
  windowOpen = vi.fn(() => null);
  vi.stubGlobal("open", windowOpen);
  window.open = windowOpen as unknown as typeof window.open;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/invoices/inv_wa/payment-link`) {
        return jsonResponse(201, { id: "pl_1", token: TOKEN, url: `/pay/link/${TOKEN}`, expiresAt: null });
      }
      if (method === "GET" && url.pathname === CONTACT_PATH) {
        return jsonResponse(200, { contact: customer, events: [], notes: [], tasks: [] });
      }
      if (method === "PATCH" && url.pathname === CONTACT_PATH) {
        patches.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return jsonResponse(200, customer);
      }
      if (method === "GET" && url.pathname.endsWith("/document-templates")) {
        return jsonResponse(200, { templates: [], branding: {} });
      }
      return jsonResponse(200, {});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Panel() {
  const [invoices, setInvoices] = React.useState<Invoice[]>([invoice()]);
  const [products, setProducts] = React.useState<import("@/lib/client").Product[]>([]);
  return (
    <InvoicesPanel
      invoices={invoices}
      contacts={[]}
      products={products}
      businessId={BIZ}
      loading={false}
      setProducts={setProducts}
      setInvoices={setInvoices}
      gmailStatus={null}
      currency="TTD"
    />
  );
}

async function openDetail(): Promise<HTMLElement> {
  fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
  fireEvent.click(screen.getByText("View details"));
  return waitFor(() => {
    const dialog = document.querySelector<HTMLElement>(DETAIL);
    if (!dialog) throw new Error("the invoice detail modal is not open");
    return dialog;
  });
}

/** Presses Escape where the keyboard is: the focused element, as a real key press is. */
function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

describe("FU-WA-CONTACT-PHONE (COR-WACP-1): Escape on the confirm step opened from the invoice detail modal", () => {
  it("closes the step alone: the invoice detail stays open, nothing is saved and nothing opens", async () => {
    render(<Panel />);
    const modal = await openDetail();
    fireEvent.click(within(modal).getByTitle("Share via WhatsApp"));
    const step = await screen.findByRole("dialog", { name: /whatsapp number/i });
    expect(step).toBeTruthy();

    pressEscape();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
    expect(detail.closes).toBe(0);
    expect(document.querySelector(DETAIL)).not.toBeNull();
    expect(patches).toEqual([]);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("a second Escape, with the step gone, closes the invoice detail as before", async () => {
    render(<Panel />);
    const modal = await openDetail();
    fireEvent.click(within(modal).getByTitle("Share via WhatsApp"));
    await screen.findByRole("dialog", { name: /whatsapp number/i });

    pressEscape();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
    expect(detail.closes).toBe(0);

    pressEscape();
    expect(detail.closes).toBe(1);
  });
});
