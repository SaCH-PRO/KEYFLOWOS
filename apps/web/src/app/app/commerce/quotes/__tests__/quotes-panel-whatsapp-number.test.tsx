/**
 * WA-HELPER (whatsapp ruling D-153): a quote's "Share via WhatsApp" opens a
 * chat with the customer's own number and the /quote/<token> link.
 *
 * Before this packet the panel opened `https://wa.me/?text=...` with no number
 * at all, so the owner had to find the customer in WhatsApp's chooser. The
 * operator quote read serves the customer's name and email only (no phone, by
 * design: OPERATOR_QUOTE_CONTACT_SELECT), so the number comes from the
 * business's contacts the panel already holds (the customer's WhatsApp number,
 * else their phone), read as E.164 with the business's country.
 *
 * Mounted on the real QuotesPanel, the real client and the real
 * lib/whatsapp.ts, with fetch stubbed at the network edge
 * (quotes-panel-share.test.tsx's harness).
 *
 * Repair (review of 087b0365):
 * - SEC-WAH-1: the share carries the quote's bearer link (its holder sees the
 *   customer's name and e-mail and can accept or reject the quote). Public
 *   forms (storefront intake, bookings, orders) fill a blank Contact.phone on
 *   the contact they match by e-mail, so a phone may be a number nobody at the
 *   business checked. The share opens only the WhatsApp number the business
 *   saved on the contact (Contact.whatsappNumber, which no public route
 *   writes); a phone alone gets WhatsApp's chooser, as before the packet.
 * - WAH-CR-1: the panel's contacts are the 50 newest (fetchContacts sends no
 *   take), so the customer is read by id at share time (GET
 *   /crm/businesses/:id/contacts/:contactId, the member's own read), not
 *   looked up in that list.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as unknown as ((...args: unknown[]) => unknown) & Record<string, ReturnType<typeof vi.fn>>;
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.info = vi.fn();
  fn.warning = vi.fn();
  return fn;
});
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => undefined }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task", markTaskCompleted: () => undefined }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../../hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: null, saveBranding: vi.fn(), savingBranding: false }),
}));
vi.mock("../../components/billing-form-modal", () => ({ BillingFormModal: () => null }));
// The detail panel is stubbed here (its own test mounts it); the stub records what the panel passes it.
const detail = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("../../components/billing-detail-modal", () => ({
  BillingDetailModal: (props: Record<string, unknown>) => {
    detail.props = props;
    return null;
  },
}));
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => ({}) }));

import QuotesPanel from "../quotes-panel";
import type { Contact, Quote } from "@/lib/client";
import { setCachedBusiness } from "@/lib/workspace";

const BIZ = "biz_wa_helper_q";
const PUBLIC_URL = "https://app.keyflow.test/quote/tok_wa_helper_sent";

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
  viewToken: "tok_wa_helper_sent",
};

function contact(fields: Partial<Contact>): Contact {
  return { id: "ct_maria", firstName: "Maria", lastName: "Lee", email: "maria@example.test", ...fields } as Contact;
}

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Error" : "OK",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

/** The customer as the member's contact read serves it (GET .../contacts/:contactId), or that read's refusal. */
let served: { status: number; contact: Contact | null } = { status: 200, contact: null };
let contactReads: string[] = [];

function installServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/quotes/q_sent/public-link`) {
        return jsonResponse(201, { token: "tok_wa_helper_sent", url: PUBLIC_URL });
      }
      if (method === "GET" && url.pathname === `/crm/businesses/${BIZ}/contacts/ct_maria`) {
        contactReads.push(url.pathname);
        return served.status === 200
          ? jsonResponse(200, { contact: served.contact, events: [], notes: [], tasks: [] })
          : jsonResponse(served.status, { message: "Contact not found" });
      }
      return jsonResponse(200, {});
    }),
  );
}

/** The contacts the panel loaded: the 50 newest, which need not include the quote's customer. */
function fiftyNewest(): Contact[] {
  return Array.from({ length: 50 }, (_, i) =>
    ({ id: `ct_new_${i}`, firstName: `New${i}`, lastName: "Customer", phone: `755-01${String(i).padStart(2, "0")}` }) as Contact,
  );
}

function renderPanel(contacts: Contact[]) {
  return render(
    <QuotesPanel
      quotes={[SENT]}
      contacts={contacts}
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

let windowOpen: ReturnType<typeof vi.fn>;

/** Share the quote; `customer` is what the contact read serves (null: none), `loaded` the panel's contact list (default: the customer). */
async function shareTarget(customer: Contact | null, loaded: Contact[] = customer ? [customer] : []): Promise<URL> {
  served = { status: 200, contact: customer };
  installServer();
  renderPanel(loaded);
  fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
  fireEvent.click(screen.getByText("Share via WhatsApp"));
  await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
  return new URL(String(windowOpen.mock.calls[0]![0]));
}

beforeEach(() => {
  contactReads = [];
  windowOpen = vi.fn(() => null);
  vi.stubGlobal("open", windowOpen);
  window.open = windowOpen as unknown as typeof window.open;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCachedBusiness({ id: BIZ, name: "Sweet Treats" });
});

describe("WA-HELPER quotes panel: Share via WhatsApp opens the customer's own number with the /quote/<token> link", () => {
  it.each(["755-0123", "868-755-0123", "+1 868 755 0123"])("the customer's WhatsApp number saved as %j: wa.me/18687550123", async (typed) => {
    const target = await shareTarget(contact({ phone: typed, whatsappNumber: typed }));
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550123");
    const text = target.searchParams.get("text") ?? "";
    // The message is the panel's own words, unchanged; only the chat's number is new.
    expect(text.startsWith("Hi Maria Lee, here is your quote QT-0007 for ")).toBe(true);
    expect(text.endsWith(`. You can view and accept it here: ${PUBLIC_URL}`)).toBe(true);
  });

  it("the customer's WhatsApp number wins over their phone", async () => {
    const target = await shareTarget(contact({ phone: "755-0123", whatsappNumber: "+1 868 755 0199" }));
    expect(target.pathname).toBe("/18687550199");
  });

  it("a local number reads with the business's own country", async () => {
    setCachedBusiness({ id: BIZ, name: "Sweet Treats", country: "Jamaica" } as Parameters<typeof setCachedBusiness>[0]);
    const target = await shareTarget(contact({ phone: "555-0123", whatsappNumber: "555-0123" }));
    expect(target.pathname).toBe("/18765550123");
  });

  it("a customer with no number on file: WhatsApp's chooser, with the same message and link", async () => {
    const target = await shareTarget(contact({ phone: null, whatsappNumber: null }));
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(PUBLIC_URL);
  });

  // SEC-WAH-1 (RED at 087b0365: wa.me/18685550199 with the bearer quote link).
  it("a phone with no WhatsApp number saved by the business (a public form can write it) never receives the quote link: the chooser", async () => {
    const target = await shareTarget(contact({ phone: "+1 868 555 0199", whatsappNumber: null }));
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(PUBLIC_URL);
  });

  // WAH-CR-1 (RED at 087b0365: the chooser, because the customer was not in the loaded list).
  it("a customer outside the 50 contacts the panel loaded: read by id, the share still opens their number", async () => {
    const target = await shareTarget(contact({ phone: "755-0123", whatsappNumber: "755-0123" }), fiftyNewest());
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550123");
    expect(contactReads).toEqual([`/crm/businesses/${BIZ}/contacts/ct_maria`]);
  });

  it("the number in the loaded list is not trusted over the customer's own read (the list can be stale)", async () => {
    const stale = contact({ phone: "755-0123", whatsappNumber: "755-0123" });
    const target = await shareTarget(contact({ phone: "755-0123", whatsappNumber: "755-0177" }), [stale]);
    expect(target.pathname).toBe("/18687550177");
  });

  it("the member's contact read is refused (the customer is outside their reach): the chooser, with the same link", async () => {
    served = { status: 404, contact: null };
    installServer();
    renderPanel([]);
    fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
    fireEvent.click(screen.getByText("Share via WhatsApp"));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    const target = new URL(String(windowOpen.mock.calls[0]![0]));
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(PUBLIC_URL);
  });

  // SEC-WAH-2 (RED at 087b0365: wa.me/18684561234, a Trinidad stranger).
  it("a business in 'Other Caribbean' with a saved local number: the chooser, never a Trinidad chat", async () => {
    setCachedBusiness({ id: BIZ, name: "Sweet Treats", country: "Other Caribbean" } as Parameters<typeof setCachedBusiness>[0]);
    const target = await shareTarget(contact({ phone: "456-1234", whatsappNumber: "456-1234" }));
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(PUBLIC_URL);
  });
});

// WAH-CR-4 (RED at 087b0365: the panel passed no business id, and the
// operator read's contact has no phone, so the detail panel's WhatsApp never
// rendered). billing-detail-modal-whatsapp.test.tsx proves what the detail
// panel does with these two ids.
describe("WA-HELPER quotes panel: the detail panel gets what it needs to read the customer's number", () => {
  it("View details passes the business id and the quote's contact id", async () => {
    detail.props = null;
    served = { status: 200, contact: contact({ whatsappNumber: "755-0123" }) };
    installServer();
    renderPanel([]);
    fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
    fireEvent.click(screen.getByText("View details"));
    await waitFor(() => expect(detail.props).not.toBeNull());
    expect(detail.props!.contactId).toBe("ct_maria");
    expect(detail.props!.businessId).toBe(BIZ);
  });
});
