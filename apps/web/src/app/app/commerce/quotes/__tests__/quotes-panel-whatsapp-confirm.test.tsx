/**
 * FU-WA-CONTACT-PHONE (V1-71; whatsapp ruling D-153, follow-ups ruling D-221;
 * journey D3): a quote for a customer with only a phone number can be shared
 * on WhatsApp after the member confirms that number once.
 *
 * Before this packet (WA-HELPER's SEC-WAH-1 containment) a customer with a
 * phone and no WhatsApp number saved by the business got WhatsApp's chooser:
 * an owner who created the customer with a phone (the contact form, the
 * composer's quick-add, a CSV import) could never send the quote straight to
 * them. The containment stays (the phone never receives the quote's bearer
 * link unconfirmed), and the gap closes with one step:
 *   - the share shows the E.164 reading of the phone and one button, 'Use this
 *     as their WhatsApp number'; nothing opens and nothing is saved yet;
 *   - confirming saves it as the customer's WhatsApp number through the
 *     contact update route (PATCH /crm/businesses/:id/contacts/:contactId,
 *     the member's own crm write) and then opens wa.me with that number and
 *     the /quote/<token> link; the next share opens it straight away;
 *   - a member the server refuses (no crm write) sees the refusal in plain
 *     words and the chooser fallback ('Share without a number');
 *   - 'Share without a number' opens the chooser without saving anything, and
 *     closing the step opens and saves nothing.
 *
 * Mounted on the real QuotesPanel, the real client and the real
 * lib/whatsapp.ts, with fetch stubbed at the network edge
 * (quotes-panel-whatsapp-number.test.tsx's harness).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

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

const BIZ = "biz_wa_confirm_q";
const PUBLIC_URL = "https://app.keyflow.test/quote/tok_wa_confirm_sent";
const CONTACT_PATH = `/crm/businesses/${BIZ}/contacts/ct_maria`;
const SCOPE_REFUSAL = "Insufficient permissions: crm requires write access (you have read)";

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
  viewToken: "tok_wa_confirm_sent",
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

/** The customer as the server holds it: the member's read serves it, a granted PATCH writes it. */
let customer: Contact;
/** How the server answers the contact update: granted (200) or refused (403 with the guard's words). */
let patchAnswer: { status: number; message?: string; gate?: Promise<void> } = { status: 200 };
let patches: Array<Record<string, unknown>> = [];

function installServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/quotes/q_sent/public-link`) {
        return jsonResponse(201, { token: "tok_wa_confirm_sent", url: PUBLIC_URL });
      }
      if (method === "GET" && url.pathname === CONTACT_PATH) {
        return jsonResponse(200, { contact: customer, events: [], notes: [], tasks: [] });
      }
      if (method === "PATCH" && url.pathname === CONTACT_PATH) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        patches.push(body);
        if (patchAnswer.gate) await patchAnswer.gate;
        if (patchAnswer.status !== 200) return jsonResponse(patchAnswer.status, { statusCode: patchAnswer.status, message: patchAnswer.message });
        customer = { ...customer, ...body } as Contact;
        return jsonResponse(200, customer);
      }
      return jsonResponse(200, {});
    }),
  );
}

let windowOpen: ReturnType<typeof vi.fn>;

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

function share() {
  fireEvent.click(screen.getAllByLabelText("More actions")[0]!);
  fireEvent.click(screen.getByText("Share via WhatsApp"));
}

/** The confirm step, once the share has read the customer and made the link. */
async function confirmStep(): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: /whatsapp number/i });
}

function opened(): URL {
  expect(windowOpen).toHaveBeenCalledTimes(1);
  return new URL(String(windowOpen.mock.calls[0]![0]));
}

beforeEach(() => {
  customer = { id: "ct_maria", firstName: "Maria", lastName: "Lee", email: "maria@example.test", phone: "755-0123", whatsappNumber: null } as Contact;
  patchAnswer = { status: 200 };
  patches = [];
  for (const fn of [toastMock.success, toastMock.error, toastMock.info]) fn!.mockClear();
  windowOpen = vi.fn(() => null);
  vi.stubGlobal("open", windowOpen);
  window.open = windowOpen as unknown as typeof window.open;
  installServer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCachedBusiness({ id: BIZ, name: "Sweet Treats" });
});

describe("FU-WA-CONTACT-PHONE quotes panel: a phone-only customer's share asks once, then opens their chat", () => {
  it("the share offers the confirm step showing the phone's E.164 reading; nothing opens and nothing is saved yet", async () => {
    renderPanel();
    share();
    const step = await confirmStep();
    expect(within(step).getByText("+18687550123")).toBeTruthy();
    expect(within(step).getByText(/755-0123/)).toBeTruthy();
    expect(within(step).getByRole("button", { name: "Use this as their WhatsApp number" })).toBeTruthy();
    expect(windowOpen).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
  });

  it("confirming saves it as the customer's WhatsApp number, then opens wa.me with that number and the /quote/<token> link", async () => {
    renderPanel();
    share();
    fireEvent.click(within(await confirmStep()).getByRole("button", { name: "Use this as their WhatsApp number" }));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    expect(patches).toEqual([{ whatsappNumber: "+18687550123" }]);
    const target = opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550123");
    const text = target.searchParams.get("text") ?? "";
    expect(text.startsWith("Hi Maria Lee, here is your quote QT-0007 for ")).toBe(true);
    expect(text.endsWith(`. You can view and accept it here: ${PUBLIC_URL}`)).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
    expect(toastMock.success).toHaveBeenCalledWith(expect.stringMatching(/Maria Lee's WhatsApp number/));
  });

  it("the next share opens the saved number straight away: the step is asked once", async () => {
    renderPanel();
    share();
    const use = within(await confirmStep()).getByRole("button", { name: "Use this as their WhatsApp number" });
    // A real press: the pointer goes down on the step (outside the row's menu, which closes) and clicks.
    fireEvent.mouseDown(use);
    fireEvent.click(use);
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    share();
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull();
    expect(new URL(String(windowOpen.mock.calls[1]![0])).pathname).toBe("/18687550123");
    expect(patches).toHaveLength(1);
  });

  it("the reading uses the business's own country", async () => {
    setCachedBusiness({ id: BIZ, name: "Sweet Treats", country: "Jamaica" } as Parameters<typeof setCachedBusiness>[0]);
    customer = { ...customer, phone: "555-0123" } as Contact;
    renderPanel();
    share();
    const step = await confirmStep();
    expect(within(step).getByText("+18765550123")).toBeTruthy();
    fireEvent.click(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    expect(patches).toEqual([{ whatsappNumber: "+18765550123" }]);
    expect(opened().pathname).toBe("/18765550123");
  });

  it("a member without crm write sees the refusal in plain words and the chooser fallback; nothing is saved", async () => {
    patchAnswer = { status: 403, message: SCOPE_REFUSAL };
    renderPanel();
    share();
    const step = await confirmStep();
    fireEvent.click(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
    const refusal = await within(step).findByRole("alert");
    expect(refusal.textContent).toMatch(/can't save/i);
    expect(refusal.textContent).not.toMatch(/Insufficient permissions|crm requires/);
    expect(windowOpen).not.toHaveBeenCalled();
    // The save cannot succeed for this member: it is not offered again.
    expect(within(step).queryByRole("button", { name: "Use this as their WhatsApp number" })).toBeNull();
    fireEvent.click(within(step).getByRole("button", { name: "Share without a number" }));
    const target = opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(PUBLIC_URL);
    expect(customer.whatsappNumber).toBeNull();
    expect(patches).toHaveLength(1);
  });

  it("'Share without a number' opens WhatsApp's chooser with the same message and link, and saves nothing", async () => {
    renderPanel();
    share();
    fireEvent.click(within(await confirmStep()).getByRole("button", { name: "Share without a number" }));
    const target = opened();
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toContain(PUBLIC_URL);
    expect(patches).toEqual([]);
  });

  it("closing the step opens nothing and saves nothing", async () => {
    renderPanel();
    share();
    const step = await confirmStep();
    fireEvent.keyDown(step, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
    expect(windowOpen).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
  });

  it("closing the step while the save is in flight: the number is saved, but no chat opens behind the member's back", async () => {
    let release!: () => void;
    patchAnswer = { status: 200, gate: new Promise<void>((resolve) => { release = resolve; }) };
    renderPanel();
    share();
    const step = await confirmStep();
    fireEvent.click(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    fireEvent.keyDown(step, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
    release();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringMatching(/Maria Lee's WhatsApp number/)));
    expect(customer.whatsappNumber).toBe("+18687550123");
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("a phone the business's country cannot read is never offered: the chooser, as before (SEC-WAH-2)", async () => {
    setCachedBusiness({ id: BIZ, name: "Sweet Treats", country: "Other Caribbean" } as Parameters<typeof setCachedBusiness>[0]);
    customer = { ...customer, phone: "456-1234" } as Contact;
    renderPanel();
    share();
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull();
    expect(opened().origin + opened().pathname).toBe("https://wa.me/");
    expect(patches).toEqual([]);
  });

  it("a saved WhatsApp number opens straight away, with no step (WA-HELPER, unchanged)", async () => {
    customer = { ...customer, whatsappNumber: "+1 868 755 0199" } as Contact;
    renderPanel();
    share();
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull();
    expect(opened().pathname).toBe("/18687550199");
    expect(patches).toEqual([]);
  });
});
