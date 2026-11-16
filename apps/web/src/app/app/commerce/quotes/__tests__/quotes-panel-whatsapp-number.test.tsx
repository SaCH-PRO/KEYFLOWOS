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
vi.mock("../../components/billing-detail-modal", () => ({ BillingDetailModal: () => null }));
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

function installServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/quotes/q_sent/public-link`) {
        return jsonResponse(201, { token: "tok_wa_helper_sent", url: PUBLIC_URL });
      }
      return jsonResponse(200, {});
    }),
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

async function shareTarget(contacts: Contact[]): Promise<URL> {
  installServer();
  renderPanel(contacts);
  fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
  fireEvent.click(screen.getByText("Share via WhatsApp"));
  await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
  return new URL(String(windowOpen.mock.calls[0]![0]));
}

beforeEach(() => {
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
  it.each(["755-0123", "868-755-0123", "+1 868 755 0123"])("the customer's phone saved as %j: wa.me/18687550123", async (typed) => {
    const target = await shareTarget([contact({ phone: typed })]);
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550123");
    const text = target.searchParams.get("text") ?? "";
    // The message is the panel's own words, unchanged; only the chat's number is new.
    expect(text.startsWith("Hi Maria Lee, here is your quote QT-0007 for ")).toBe(true);
    expect(text.endsWith(`. You can view and accept it here: ${PUBLIC_URL}`)).toBe(true);
  });

  it("the customer's WhatsApp number wins over their phone", async () => {
    const target = await shareTarget([contact({ phone: "755-0123", whatsappNumber: "+1 868 755 0199" })]);
    expect(target.pathname).toBe("/18687550199");
  });

  it("a local number reads with the business's own country", async () => {
    setCachedBusiness({ id: BIZ, name: "Sweet Treats", country: "Jamaica" } as Parameters<typeof setCachedBusiness>[0]);
    const target = await shareTarget([contact({ phone: "555-0123" })]);
    expect(target.pathname).toBe("/18765550123");
  });

  it("a customer with no number on file: WhatsApp's chooser, with the same message and link", async () => {
    const target = await shareTarget([contact({ phone: null })]);
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(PUBLIC_URL);
  });
});
