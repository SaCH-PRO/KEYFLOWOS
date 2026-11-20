/**
 * FU-WA-CONTACT-PHONE (V1-71; whatsapp ruling D-153, follow-ups ruling D-221;
 * journey E6): an invoice for a customer with only a phone number can be
 * shared on WhatsApp after the member confirms that number once, from both
 * invoice lists (the Sales > Invoices panel and the nav's Invoices hub).
 *
 * Before this packet (WA-HELPER's SEC-WAH-1 containment) a customer with a
 * phone and no WhatsApp number saved by the business got WhatsApp's chooser.
 * The containment stays (the phone never receives the invoice's bearer link
 * unconfirmed); the share now shows the E.164 reading of the phone and one
 * button, 'Use this as their WhatsApp number', which saves it through the
 * contact update route (the member's own crm write) and then opens wa.me with
 * that number and the /public/invoice/<token> link. A member the server
 * refuses sees the refusal in plain words and the chooser fallback.
 *
 * The panel is mounted with the real client and fetch stubbed at the network
 * edge; the hub is mounted as the route renders it with its list doors stubbed
 * (invoices-whatsapp-number.test.tsx's harness). lib/whatsapp.ts is real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Contact, Invoice } from "@/lib/client";

const hub = vi.hoisted(() => ({
  invoices: [] as unknown[],
  country: null as string | null,
}));

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
vi.mock("../../components/billing-detail-modal", () => ({ BillingDetailModal: () => null }));
vi.mock("../../components/invoice-mobile-actions", () => ({ InvoiceMobileActions: () => null }));
// The hub's list doors read the stored lists; the payment link, the contact read and the contact update stay real (fetch below).
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    fetchInvoices: async () => ({ data: hub.invoices, error: null }),
    fetchContacts: async () => ({ data: { contacts: [] }, error: null }),
    fetchProducts: async () => ({ data: [], error: null }),
    getGmailStatus: async () => ({ data: { connected: false, email: null }, error: null }),
  };
});
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return {
    ...actual,
    refreshWorkspace: async () => BIZ,
    getStoredBusinessId: () => BIZ,
    getCachedBusiness: () => ({ id: BIZ, name: "Sweet Treats", ...(hub.country ? { country: hub.country } : {}) }),
  };
});

import InvoicesPanel from "../invoices-panel";
import InvoicesHubPage from "../page";

const BIZ = "biz_wa_confirm_inv";
const TOKEN = "tok_wa_confirm_inv_0001";
const CONTACT_PATH = `/crm/businesses/${BIZ}/contacts/ct_rena`;
const SCOPE_REFUSAL = "Insufficient permissions: crm requires write access (you have read)";

function invoice(fields: Partial<Invoice> = {}): Invoice {
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
    ...fields,
  } as Invoice;
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
let patchAnswer: { status: number; message?: string } = { status: 200 };
let patches: Array<Record<string, unknown>> = [];

function installServer() {
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
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        patches.push(body);
        if (patchAnswer.status !== 200) return jsonResponse(patchAnswer.status, { statusCode: patchAnswer.status, message: patchAnswer.message });
        customer = { ...customer, ...body } as Contact;
        return jsonResponse(200, customer);
      }
      if (method === "GET" && url.pathname.endsWith("/document-templates")) {
        return jsonResponse(200, { templates: [], branding: {} });
      }
      return jsonResponse(200, {});
    }),
  );
}

let windowOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  customer = { id: "ct_rena", firstName: "Rena", lastName: "Ali", email: "rena@example.test", phone: "+1 868 755 0145", whatsappNumber: null } as Contact;
  patchAnswer = { status: 200 };
  patches = [];
  windowOpen = vi.fn(() => null);
  vi.stubGlobal("open", windowOpen);
  window.open = windowOpen as unknown as typeof window.open;
  hub.country = null;
  installServer();
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

function panelShare() {
  fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
  fireEvent.click(screen.getByText("Share via WhatsApp"));
}

async function hubShare() {
  const number = await screen.findAllByText("INV-0042");
  const row = number[0]!.closest("tr")!;
  const menu = row.querySelectorAll("button");
  fireEvent.click(menu[menu.length - 1]!);
  fireEvent.click(await screen.findByText("Share WhatsApp"));
}

async function confirmStep(): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: /whatsapp number/i });
}

function opened(): URL {
  expect(windowOpen).toHaveBeenCalledTimes(1);
  return new URL(String(windowOpen.mock.calls[0]![0]));
}

describe("FU-WA-CONTACT-PHONE Sales > Invoices panel: a phone-only customer's share asks once, then opens their chat", () => {
  it("the confirm step shows the E.164 reading; confirming saves it and opens wa.me with that number and the invoice link", async () => {
    render(<Panel />);
    panelShare();
    const step = await confirmStep();
    expect(within(step).getByText("+18687550145")).toBeTruthy();
    expect(windowOpen).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
    fireEvent.click(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    expect(patches).toEqual([{ whatsappNumber: "+18687550145" }]);
    const target = opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550145");
    const text = target.searchParams.get("text") ?? "";
    expect(text.startsWith("Hi Rena Ali, here is your invoice INV-0042 for ")).toBe(true);
    expect(text).toMatch(new RegExp(`\\. You can view and pay it here: \\S+/public/invoice/${TOKEN}$`));
  });

  it("a member without crm write sees the refusal and the chooser fallback; nothing is saved", async () => {
    patchAnswer = { status: 403, message: SCOPE_REFUSAL };
    render(<Panel />);
    panelShare();
    const step = await confirmStep();
    fireEvent.click(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
    const refusal = await within(step).findByRole("alert");
    expect(refusal.textContent).toMatch(/can't save/i);
    expect(windowOpen).not.toHaveBeenCalled();
    fireEvent.click(within(step).getByRole("button", { name: "Share without a number" }));
    const target = opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(`/public/invoice/${TOKEN}`);
    expect(customer.whatsappNumber).toBeNull();
  });
});

describe("FU-WA-CONTACT-PHONE Invoices hub: a phone-only customer's share asks once, then opens their chat", () => {
  beforeEach(() => {
    hub.invoices = [invoice()];
  });

  it("the confirm step shows the E.164 reading; confirming saves it and opens wa.me with that number and the invoice link", async () => {
    render(<InvoicesHubPage />);
    await hubShare();
    const step = await confirmStep();
    expect(within(step).getByText("+18687550145")).toBeTruthy();
    expect(windowOpen).not.toHaveBeenCalled();
    fireEvent.click(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    expect(patches).toEqual([{ whatsappNumber: "+18687550145" }]);
    const target = opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550145");
    expect(target.searchParams.get("text")).toMatch(new RegExp(`^Your invoice: \\S+/public/invoice/${TOKEN}$`));
  });

  it("a local number reads with the business's own country", async () => {
    hub.country = "United Kingdom";
    customer = { ...customer, phone: "07700 900123" } as Contact;
    render(<InvoicesHubPage />);
    await hubShare();
    const step = await confirmStep();
    expect(within(step).getByText("+447700900123")).toBeTruthy();
    fireEvent.click(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    expect(opened().pathname).toBe("/447700900123");
  });

  it("a member without crm write sees the refusal and the chooser fallback; nothing is saved", async () => {
    patchAnswer = { status: 403, message: SCOPE_REFUSAL };
    render(<InvoicesHubPage />);
    await hubShare();
    const step = await confirmStep();
    fireEvent.click(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
    const refusal = await within(step).findByRole("alert");
    expect(refusal.textContent).toMatch(/can't save/i);
    expect(refusal.textContent).not.toMatch(/Insufficient permissions|crm requires/);
    expect(windowOpen).not.toHaveBeenCalled();
    fireEvent.click(within(step).getByRole("button", { name: "Share without a number" }));
    const target = opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toMatch(new RegExp(`^Your invoice: \\S+/public/invoice/${TOKEN}$`));
    expect(customer.whatsappNumber).toBeNull();
  });
});
