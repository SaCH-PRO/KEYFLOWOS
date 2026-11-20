/**
 * WA-HELPER (whatsapp ruling D-153): an invoice's WhatsApp share opens a chat
 * with the customer's own number and the /public/invoice/<token> link, from
 * both invoice lists (the Sales > Invoices panel and the nav's Invoices hub).
 *
 * Before this packet both opened `https://wa.me/?text=...` with no number, so
 * the owner had to find the customer in WhatsApp's chooser. The operator
 * invoice read serves the customer's name and email only (no phone, by
 * design: OPERATOR_INVOICE_CONTACT_SELECT), so the number comes from the
 * business's contacts each screen already loads (the customer's WhatsApp
 * number, else their phone), read as E.164 with the business's country.
 *
 * The panel is mounted with the real client and fetch stubbed at the network
 * edge (invoices-panel-bulk-delete-skipped.test.tsx's harness); the hub is
 * mounted as the route renders it with its data doors stubbed
 * (invoices-hub-refund-balance.test.tsx's harness). lib/whatsapp.ts is real in
 * both.
 *
 * Repair (review of 087b0365):
 * - SEC-WAH-1: the share carries the invoice's bearer link (its holder sees
 *   the customer's name, the items and the total, and can pay). Public forms
 *   (storefront intake, bookings, orders) fill a blank Contact.phone on the
 *   contact they match by e-mail, so a phone may be a number nobody at the
 *   business checked. The share opens only the WhatsApp number the business
 *   saved on the contact (Contact.whatsappNumber, which no public route
 *   writes); a phone alone gets WhatsApp's chooser, as before the packet.
 *   FU-WA-CONTACT-PHONE (D-221): a phone alone is now offered for the member
 *   to confirm as the WhatsApp number first (invoices-whatsapp-confirm
 *   .test.tsx); unconfirmed it still never receives the link.
 * - WAH-CR-1: the screens' contacts are the 50 newest (fetchContacts sends no
 *   take), so the customer is read by id at share time (GET
 *   /crm/businesses/:id/contacts/:contactId, the member's own read).
 * - SEC-WAH-2: a business whose country the helper does not know is not read
 *   as Trinidad and Tobago.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Contact, Invoice } from "@/lib/client";

const hub = vi.hoisted(() => ({
  invoices: [] as unknown[],
  contacts: [] as unknown[],
  country: null as string | null,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
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
// The detail panel is stubbed here (its own test mounts it); the stub records what the panel passes it.
const detail = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("../../components/billing-detail-modal", () => ({
  BillingDetailModal: (props: Record<string, unknown>) => {
    detail.props = props;
    return null;
  },
}));
vi.mock("../../components/invoice-mobile-actions", () => ({ InvoiceMobileActions: () => null }));
// The hub's data doors read the stored lists; createInvoicePaymentLink stays real (fetch below).
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    fetchInvoices: async () => ({ data: hub.invoices, error: null }),
    fetchContacts: async () => ({ data: { contacts: hub.contacts }, error: null }),
    fetchProducts: async () => ({ data: [], error: null }),
    getGmailStatus: async () => ({ data: { connected: false, email: null }, error: null }),
  };
});
// The hub reads its business id, and both screens the business's country, from the workspace.
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

const BIZ = "biz_wa_helper_inv";
const TOKEN = "tok_wa_helper_inv_0001";

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

function contact(fields: Partial<Contact>): Contact {
  return { id: "ct_rena", firstName: "Rena", lastName: "Ali", email: "rena@example.test", ...fields } as Contact;
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

/** The customer as the member's contact read serves it (GET .../contacts/:contactId), or that read's refusal. */
let served: { status: number; contact: Contact | null } = { status: 200, contact: null };
let contactReads: string[] = [];

/** The network edge: the payment-link mint, the customer's read, and an empty answer for everything else. */
function installServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/invoices/inv_wa/payment-link`) {
        return jsonResponse(201, { id: "pl_1", token: TOKEN, url: `/pay/link/${TOKEN}`, expiresAt: null });
      }
      if (method === "GET" && url.pathname === `/crm/businesses/${BIZ}/contacts/ct_rena`) {
        contactReads.push(url.pathname);
        return served.status === 200
          ? jsonResponse(200, { contact: served.contact, events: [], notes: [], tasks: [] })
          : jsonResponse(served.status, { message: "Contact not found" });
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
  contactReads = [];
  served = { status: 200, contact: null };
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

function Panel({ contacts }: { contacts: Contact[] }) {
  const [invoices, setInvoices] = React.useState<Invoice[]>([invoice()]);
  const [products, setProducts] = React.useState<import("@/lib/client").Product[]>([]);
  return (
    <InvoicesPanel
      invoices={invoices}
      contacts={contacts}
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

async function opened(): Promise<URL> {
  await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
  return new URL(String(windowOpen.mock.calls[0]![0]));
}

/** The contacts a screen loaded: the 50 newest, which need not include the invoice's customer. */
function fiftyNewest(): Contact[] {
  return Array.from({ length: 50 }, (_, i) =>
    ({ id: `ct_new_${i}`, firstName: `New${i}`, lastName: "Customer", phone: `755-01${String(i).padStart(2, "0")}` }) as Contact,
  );
}

/** Share from the panel; `customer` is what the contact read serves (null: none), `loaded` the panel's contact list (default: the customer). */
async function panelShare(customer: Contact | null, loaded: Contact[] = customer ? [customer] : []): Promise<URL> {
  served = { status: 200, contact: customer };
  render(<Panel contacts={loaded} />);
  fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
  fireEvent.click(screen.getByText("Share via WhatsApp"));
  return opened();
}

/** Share from the hub; `customer` is what the contact read serves (null: none), `loaded` the hub's contact list (default: the customer). */
async function hubShare(customer: Contact | null, loaded: Contact[] = customer ? [customer] : []): Promise<URL> {
  served = { status: 200, contact: customer };
  hub.invoices = [invoice()];
  hub.contacts = loaded;
  render(<InvoicesHubPage />);
  const number = await screen.findAllByText("INV-0042");
  const row = number[0]!.closest("tr")!;
  const menu = row.querySelectorAll("button");
  fireEvent.click(menu[menu.length - 1]!);
  fireEvent.click(await screen.findByText("Share WhatsApp"));
  return opened();
}

describe("WA-HELPER Sales > Invoices panel: Share via WhatsApp opens the customer's own number", () => {
  it.each(["755-0123", "868-755-0123", "+1 868 755 0123"])("WhatsApp number saved as %j: wa.me/18687550123 with the invoice link", async (typed) => {
    const target = await panelShare(contact({ phone: typed, whatsappNumber: typed }));
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550123");
    const text = target.searchParams.get("text") ?? "";
    expect(text.startsWith("Hi Rena Ali, here is your invoice INV-0042 for ")).toBe(true);
    // The message is the panel's own words, unchanged; only the chat's number is new.
    expect(text).toMatch(new RegExp(`\\. You can view and pay it here: \\S+/public/invoice/${TOKEN}$`));
  });

  it("the customer's WhatsApp number wins over their phone", async () => {
    const target = await panelShare(contact({ phone: "755-0123", whatsappNumber: "868-755-0199" }));
    expect(target.pathname).toBe("/18687550199");
  });

  it("no number on file: WhatsApp's chooser with the same link", async () => {
    const target = await panelShare(null);
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(`/public/invoice/${TOKEN}`);
  });

  // SEC-WAH-1 (RED at 087b0365: wa.me/18685550199 with the bearer invoice link). Since
  // FU-WA-CONTACT-PHONE the phone is offered for the member to confirm first
  // (invoices-whatsapp-confirm.test.tsx); unconfirmed it never receives the link.
  it("a phone with no WhatsApp number saved by the business (a public form can write it) never receives the invoice link unconfirmed: the confirm step, and without confirming, the chooser", async () => {
    served = { status: 200, contact: contact({ phone: "+1 868 555 0199", whatsappNumber: null }) };
    render(<Panel contacts={[]} />);
    fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
    fireEvent.click(screen.getByText("Share via WhatsApp"));
    const step = await screen.findByRole("dialog", { name: /whatsapp number/i });
    expect(windowOpen).not.toHaveBeenCalled();
    fireEvent.click(within(step).getByRole("button", { name: "Share without a number" }));
    const target = await opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(`/public/invoice/${TOKEN}`);
  });

  // WAH-CR-1 (RED at 087b0365: the chooser, because the customer was not in the loaded list).
  it("a customer outside the 50 contacts the panel loaded: read by id, the share still opens their number", async () => {
    const target = await panelShare(contact({ phone: "755-0123", whatsappNumber: "755-0123" }), fiftyNewest());
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550123");
    expect(contactReads).toEqual([`/crm/businesses/${BIZ}/contacts/ct_rena`]);
  });

  it("the member's contact read is refused: the chooser, with the same link", async () => {
    served = { status: 404, contact: null };
    render(<Panel contacts={[]} />);
    fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
    fireEvent.click(screen.getByText("Share via WhatsApp"));
    const target = await opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(`/public/invoice/${TOKEN}`);
  });
});

describe("WA-HELPER Invoices hub: Share WhatsApp opens the customer's own number", () => {
  it.each(["755-0123", "868-755-0123"])("WhatsApp number saved as %j: wa.me/18687550123 with the invoice link", async (typed) => {
    const target = await hubShare(contact({ phone: typed, whatsappNumber: typed }));
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550123");
    expect(target.searchParams.get("text")).toMatch(new RegExp(`^Your invoice: \\S+/public/invoice/${TOKEN}$`));
  });

  it("a local number reads with the business's own country", async () => {
    hub.country = "United Kingdom";
    const target = await hubShare(contact({ phone: "07700 900123", whatsappNumber: "07700 900123" }));
    expect(target.pathname).toBe("/447700900123");
  });

  it("no number on file: WhatsApp's chooser with the same link", async () => {
    const target = await hubShare(contact({ phone: null, whatsappNumber: null }));
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(`/public/invoice/${TOKEN}`);
  });

  // SEC-WAH-1 (RED at 087b0365: wa.me/18685550199 with the bearer invoice link). Since
  // FU-WA-CONTACT-PHONE the phone is offered for the member to confirm first; unconfirmed,
  // the planted chat never receives the link.
  it("a phone planted through the public intake (no WhatsApp number saved by the business): the confirm step, and without confirming, the chooser, never the planted chat", async () => {
    served = { status: 200, contact: contact({ phone: "+1 868 555 0199", whatsappNumber: null }) };
    hub.invoices = [invoice()];
    hub.contacts = [];
    render(<InvoicesHubPage />);
    const number = await screen.findAllByText("INV-0042");
    const row = number[0]!.closest("tr")!;
    const menu = row.querySelectorAll("button");
    fireEvent.click(menu[menu.length - 1]!);
    fireEvent.click(await screen.findByText("Share WhatsApp"));
    const step = await screen.findByRole("dialog", { name: /whatsapp number/i });
    expect(windowOpen).not.toHaveBeenCalled();
    fireEvent.click(within(step).getByRole("button", { name: "Share without a number" }));
    const target = await opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toMatch(new RegExp(`^Your invoice: \\S+/public/invoice/${TOKEN}$`));
  });

  // WAH-CR-1 (RED at 087b0365: the chooser).
  it("a customer outside the 50 contacts the hub loaded: read by id, the share still opens their number", async () => {
    const target = await hubShare(contact({ phone: "755-0123", whatsappNumber: "755-0123" }), fiftyNewest());
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550123");
    expect(contactReads).toEqual([`/crm/businesses/${BIZ}/contacts/ct_rena`]);
  });

  // SEC-WAH-2 (RED at 087b0365: wa.me/18684561234 and wa.me/13123456789, strangers in Trinidad and Chicago).
  it.each([
    ["Other Caribbean", "456-1234"],
    ["Other", "312 345 6789"],
  ])("a business in %j: the saved local number %j is not read as TT; the chooser opens", async (country, typed) => {
    hub.country = country;
    const target = await hubShare(contact({ phone: typed, whatsappNumber: typed }));
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(`/public/invoice/${TOKEN}`);
  });
});

// WAH-CR-4 (RED at 087b0365: the panel passed no business id, and the
// operator read's contact has no phone, so the detail panel's WhatsApp never
// rendered). billing-detail-modal-whatsapp.test.tsx proves what the detail
// panel does with these two ids.
describe("WA-HELPER Sales > Invoices panel: the detail panel gets what it needs to read the customer's number", () => {
  it("View details passes the business id and the invoice's contact id", async () => {
    detail.props = null;
    render(<Panel contacts={[]} />);
    fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
    fireEvent.click(screen.getByText("View details"));
    await waitFor(() => expect(detail.props).not.toBeNull());
    expect(detail.props!.contactId).toBe("ct_rena");
    expect(detail.props!.businessId).toBe(BIZ);
  });
});
