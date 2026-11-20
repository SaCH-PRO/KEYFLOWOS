/**
 * FU-WA-CONTACT-PHONE review repair COR-WACP-1: Escape on the WhatsApp confirm
 * step closes the step alone, not the quote detail modal it was opened from.
 *
 * The owner opens a quote's details (BillingDetailModal), presses the modal's
 * 'Share via WhatsApp' for a customer with a phone and no WhatsApp number, and
 * the confirm step opens over the modal. Escape is meant to close the step and
 * save and open nothing; before this repair the modal heard the same Escape on
 * document and closed too.
 *
 * Mounted on the real QuotesPanel and the real BillingDetailModal (wrapped only
 * to count its onClose calls), the real client and the real lib/whatsapp.ts,
 * with fetch stubbed at the network edge (quotes-panel-whatsapp-confirm.test.tsx's
 * harness).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const detail = vi.hoisted(() => ({ closes: 0 }));

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => undefined }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task", markTaskCompleted: () => undefined }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce/quotes",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: null, saveBranding: vi.fn(), savingBranding: false }),
}));
vi.mock("../../components/billing-form-modal", () => ({ BillingFormModal: () => null }));
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => ({}) }));
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

import QuotesPanel from "../quotes-panel";
import type { Contact, Quote } from "@/lib/client";
import { setCachedBusiness } from "@/lib/workspace";

const BIZ = "biz_wa_confirm_q_esc";
const PUBLIC_URL = "https://app.keyflow.test/quote/tok_wa_confirm_q_esc";
const CONTACT_PATH = `/crm/businesses/${BIZ}/contacts/ct_maria`;
const DETAIL = '[role="dialog"][aria-labelledby="billing-detail-quote-QT-0007"]';

const SENT: Quote = {
  id: "q_sent",
  quoteNumber: "QT-0007",
  status: "SENT",
  subtotal: 100,
  total: 100,
  currency: "TTD",
  issueDate: "2026-11-01T10:00:00.000Z",
  businessId: BIZ,
  contactId: "ct_maria",
  contact: { id: "ct_maria", firstName: "Maria", lastName: "Lee", email: "maria@example.test" } as Quote["contact"],
  items: [{ id: "i1", description: "Service", quantity: 1, unitPrice: 100, total: 100 }] as Quote["items"],
  createdAt: "2026-11-01T10:00:00.000Z",
  viewToken: "tok_wa_confirm_q_esc",
};

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
  setCachedBusiness({ id: BIZ, name: "Sweet Treats" });
  customer = { id: "ct_maria", firstName: "Maria", lastName: "Lee", email: "maria@example.test", phone: "755-0123", whatsappNumber: null } as Contact;
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
      if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/quotes/q_sent/public-link`) {
        return jsonResponse(201, { token: "tok_wa_confirm_q_esc", url: PUBLIC_URL });
      }
      if (method === "GET" && url.pathname === CONTACT_PATH) {
        return jsonResponse(200, { contact: customer, events: [], notes: [], tasks: [] });
      }
      if (method === "PATCH" && url.pathname === CONTACT_PATH) {
        patches.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return jsonResponse(200, customer);
      }
      return jsonResponse(200, {});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel() {
  return render(
    <QuotesPanel
      quotes={[SENT]}
      contacts={[]}
      products={[]}
      businessId={BIZ}
      loading={false}
      gmailStatus={{ connected: false, email: null }}
      setProducts={vi.fn()}
      setQuotes={vi.fn()}
      setInvoices={vi.fn()}
    />,
  );
}

async function openDetail(): Promise<HTMLElement> {
  fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
  fireEvent.click(screen.getByText("View details"));
  return waitFor(() => {
    const dialog = document.querySelector<HTMLElement>(DETAIL);
    if (!dialog) throw new Error("the quote detail modal is not open");
    return dialog;
  });
}

/** Presses Escape where the keyboard is: the focused element, as a real key press is. */
function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

describe("FU-WA-CONTACT-PHONE (COR-WACP-1): Escape on the confirm step opened from the quote detail modal", () => {
  it("closes the step alone: the quote detail stays open, nothing is saved and nothing opens", async () => {
    renderPanel();
    const modal = await openDetail();
    fireEvent.click(within(modal).getByTitle("Share via WhatsApp"));
    await screen.findByRole("dialog", { name: /whatsapp number/i });

    pressEscape();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
    expect(detail.closes).toBe(0);
    expect(document.querySelector(DETAIL)).not.toBeNull();
    expect(patches).toEqual([]);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("a second Escape, with the step gone, closes the quote detail as before", async () => {
    renderPanel();
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
