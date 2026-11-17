/**
 * FU-WA-CONTACT-PHONE repair (found by the live run of the repair, recorded
 * with COR-WACP-2): the Invoices hub's WhatsApp share reads the customer by
 * the invoice's contactId, and the hub's rows come from fetchInvoices, whose
 * zod schema dropped contactId (the server's GET .../invoices row carries it).
 * So in a real browser every hub share went straight to WhatsApp's chooser:
 * no customer read, no confirm step, even for a saved WhatsApp number
 * (observed against the real API: only the list and the payment link were
 * requested, then wa.me/?text=...). The hub's other tests stub fetchInvoices
 * with rows that carry contactId, which hid it.
 *
 * Here the hub is mounted with the real client: fetch is stubbed at the
 * network edge and the list answers what the server's listInvoices answers
 * (the full invoice row, contactId and the included contact). The share must
 * read that customer and offer the confirm step for a phone-only customer, and
 * open a saved WhatsApp number straight away.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

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
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return {
    ...actual,
    refreshWorkspace: async () => BIZ,
    getStoredBusinessId: () => BIZ,
    getCachedBusiness: () => ({ id: BIZ, name: "Sweet Treats" }),
  };
});

import InvoicesHubPage from "../page";
import { fetchInvoices } from "@/lib/client";

const BIZ = "biz_wa_hub_row";
const TOKEN = "tok_wa_hub_row_000001";
const CONTACT_PATH = `/crm/businesses/${BIZ}/contacts/ct_rena`;

/** One row as CommerceService.listInvoices answers it (include: contact, quote, payments, items). */
function serverRow() {
  return {
    id: "inv_row",
    businessId: BIZ,
    contactId: "ct_rena",
    quoteId: null,
    invoiceNumber: "INV-0042",
    status: "SENT",
    subtotal: 250,
    taxRate: 0,
    taxAmount: 0,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    total: 250,
    currency: "TTD",
    issueDate: new Date().toISOString(),
    dueDate: null,
    paidAt: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    contact: { id: "ct_rena", businessId: BIZ, firstName: "Rena", lastName: "Ali", email: "rena@example.test", phone: "+18687550145", whatsappNumber: null },
    quote: null,
    payments: [],
    items: [{ id: "it_1", description: "Catering", quantity: 1, unitPrice: 250, total: 250, productId: null }],
  };
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

let customer: Record<string, unknown>;
let detailReads = 0;
let windowOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  customer = { id: "ct_rena", firstName: "Rena", lastName: "Ali", email: "rena@example.test", phone: "+18687550145", whatsappNumber: null };
  detailReads = 0;
  windowOpen = vi.fn(() => null);
  vi.stubGlobal("open", windowOpen);
  window.open = windowOpen as unknown as typeof window.open;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.pathname === `/commerce/businesses/${BIZ}/invoices`) {
        return jsonResponse(200, { data: [serverRow()], total: 1, page: 1, pageSize: 50, totalPages: 1 });
      }
      if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/invoices/inv_row/payment-link`) {
        return jsonResponse(201, { id: "pl_1", token: TOKEN, url: `/pay/link/${TOKEN}`, expiresAt: null });
      }
      if (method === "GET" && url.pathname === CONTACT_PATH) {
        detailReads += 1;
        return jsonResponse(200, { contact: customer, events: [], notes: [], tasks: [] });
      }
      return jsonResponse(200, {});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function hubShare() {
  const number = await screen.findAllByText("INV-0042");
  const row = number[0]!.closest("tr")!;
  const menu = row.querySelectorAll("button");
  fireEvent.click(menu[menu.length - 1]!);
  fireEvent.click(await screen.findByText("Share WhatsApp"));
}

describe("FU-WA-CONTACT-PHONE: the Invoices hub's rows keep the customer's id, so the share can read the customer", () => {
  it("fetchInvoices keeps each row's contactId from the server's list", async () => {
    const { data } = await fetchInvoices(BIZ);
    expect(data).toHaveLength(1);
    expect((data[0] as { contactId?: string | null }).contactId).toBe("ct_rena");
  });

  it("a phone-only customer's share from the hub reads the customer and offers the confirm step (not the chooser)", async () => {
    render(<InvoicesHubPage />);
    await hubShare();
    const step = await screen.findByRole("dialog", { name: /whatsapp number/i });
    expect(within(step).getByText("+18687550145")).toBeTruthy();
    expect(detailReads).toBe(1);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("a saved WhatsApp number opens that chat straight away from the hub", async () => {
    customer = { ...customer, whatsappNumber: "+18687550199" };
    render(<InvoicesHubPage />);
    await hubShare();
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    const target = new URL(String(windowOpen.mock.calls[0]![0]));
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550199");
    expect(target.searchParams.get("text")).toMatch(new RegExp(`^Your invoice: \\S+/public/invoice/${TOKEN}$`));
  });
});
