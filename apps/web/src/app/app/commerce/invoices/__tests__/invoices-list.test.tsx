/**
 * SWP-INV-LIST (sweep BUG-007, BUG-050, BUG-070, BUG-089, BUG-131, BUG-047): the Invoices list (/app/commerce/invoices).
 *
 * The page is mounted with the real lib/client.ts; `fetch` is stubbed at the network edge and the list answers what
 * CommerceService.listInvoices answers (the full invoice row, with contact, quote, payments and items). The business
 * is a USD business (the workspace's cached business carries its currency).
 *
 *   - BUG-007: the cards added every invoice into one figure labelled with a hard-coded "TTD", so a USD business's
 *     Unpaid card added its TTD invoices into a TT$ figure; and lib/client.ts createInvoice sent currency "TTD" when
 *     the caller named none, so the server's business-currency default never applied (the new-invoice page names none).
 *   - BUG-050: Duplicate lost the tax, the discount and the notes: fetchInvoices' schema dropped them from each row.
 *   - "complete search": the same dropped notes could not be searched.
 *   - BUG-089: the Unpaid card filtered SENT only, so a part-paid invoice it counts was not listed.
 *   - BUG-131: a voided (or paid) invoice still said "Due in 7d".
 *   - BUG-047: a part-paid row offered "Record payment" and no reminder; it offers Record balance and Remind.
 *
 * Cases tagged RED-BEFORE fail on the packet's base; CONTROL cases pass on both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
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
    getCachedBusiness: () => cachedBusiness,
  };
});

import InvoicesHubPage from "../page";
import { createInvoice } from "@/lib/client";

const BIZ = "biz_inv_list";
/** The workspace's cached business (vi.mock reads it per call; a test may make it another business's). */
let cachedBusiness: { id: string; name: string; currency: string; country: string } = { id: "biz_inv_list", name: "Island Events", currency: "USD", country: "TT" };
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

/** One row as CommerceService.listInvoices answers it. */
function row(over: Row): Row {
  return {
    id: "inv_x",
    businessId: BIZ,
    contactId: "ct_rena",
    quoteId: null,
    invoiceNumber: "INV-0001",
    status: "SENT",
    subtotal: 100,
    taxRate: 0,
    taxAmount: 0,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    total: 100,
    currency: "USD",
    issueDate: new Date(Date.now() - 2 * DAY).toISOString(),
    dueDate: null,
    paidAt: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    contact: { id: "ct_rena", businessId: BIZ, firstName: "Rena", lastName: "Ali", email: "rena@example.test", phone: "+18687550145", whatsappNumber: "+18687550145" },
    quote: null,
    payments: [],
    items: [{ id: "it_1", description: "Event styling", quantity: 1, unitPrice: 100, total: 100, productId: null }],
    ...over,
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

let rows: Row[];
let posts: { path: string; body: Record<string, unknown> }[];
let windowOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cachedBusiness = { id: BIZ, name: "Island Events", currency: "USD", country: "TT" };
  rows = [];
  posts = [];
  push.mockClear();
  sessionStorage.clear();
  windowOpen = vi.fn(() => null);
  vi.stubGlobal("open", windowOpen);
  window.open = windowOpen as unknown as typeof window.open;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.pathname === `/commerce/businesses/${BIZ}/invoices`) {
        return jsonResponse(200, { data: rows, total: rows.length, page: 1, pageSize: 50, totalPages: 1 });
      }
      if (method === "POST") {
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        posts.push({ path: url.pathname, body });
        if (url.pathname.endsWith("/payment-link")) return jsonResponse(201, { id: "pl_1", token: "tok_inv_list_fixture", url: "/pay/link/tok_inv_list_fixture", expiresAt: null });
        return jsonResponse(201, { id: "inv_new", ...body });
      }
      if (method === "GET" && url.pathname.startsWith(`/crm/businesses/${BIZ}/contacts/`)) {
        return jsonResponse(200, { contact: { id: "ct_rena", firstName: "Rena", lastName: "Ali", phone: "+18687550145", whatsappNumber: "+18687550145" }, events: [], notes: [], tasks: [] });
      }
      return jsonResponse(200, {});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The stat card with this label (its button). */
async function card(label: string): Promise<HTMLElement> {
  const name = await screen.findByText(label, { selector: "span" });
  return name.closest("button") as HTMLElement;
}

async function openRowMenu(invoiceNumber: string): Promise<void> {
  const cells = await screen.findAllByText(invoiceNumber);
  const tr = cells[0]!.closest("tr")!;
  const buttons = tr.querySelectorAll("button");
  fireEvent.click(buttons[buttons.length - 1]!);
}

describe("SWP-INV-LIST: the Invoices list", () => {
  it("RED-BEFORE (BUG-007): a USD business's cards never add its TTD invoices, and say USD", async () => {
    rows = [
      row({ id: "inv_usd", invoiceNumber: "INV-0001", currency: "USD", total: 100, subtotal: 100 }),
      row({ id: "inv_ttd", invoiceNumber: "INV-0002", currency: "TTD", total: 1000, subtotal: 1000 }),
    ];
    render(<InvoicesHubPage />);
    const unpaid = await card("Unpaid");
    // The USD invoice alone, in USD; never 1,100 and never TT$.
    expect(unpaid.textContent).toMatch(/100\.00/);
    expect(unpaid.textContent).not.toMatch(/1,100/);
    expect(unpaid.textContent).not.toMatch(/TT\$|TTD/);
    expect(unpaid.textContent).toMatch(/US\$|USD|\$100\.00/);
  });

  it("RED-BEFORE (BUG-007): createInvoice sends no currency when the caller names none (the server applies the business currency)", async () => {
    await createInvoice({ businessId: BIZ, contactId: "ct_rena", items: [{ description: "Event styling", quantity: 1, unitPrice: 100 }] });
    const create = posts.find((p) => p.path === `/commerce/businesses/${BIZ}/invoices`);
    expect(create).toBeDefined();
    expect(create!.body).not.toHaveProperty("currency");
  });

  it("CONTROL: createInvoice still sends a currency the caller names", async () => {
    await createInvoice({ businessId: BIZ, contactId: "ct_rena", items: [{ description: "Event styling", quantity: 1, unitPrice: 100 }], currency: "TTD" });
    expect(posts.find((p) => p.path === `/commerce/businesses/${BIZ}/invoices`)!.body.currency).toBe("TTD");
  });

  it("RED-BEFORE (BUG-050): Duplicate carries the client, the tax, the discount and the notes to the new invoice", async () => {
    rows = [row({ invoiceNumber: "INV-0007", taxRate: 12.5, discountType: "FIXED", discountValue: 20, notes: "Deposit 50% to confirm the date" })];
    render(<InvoicesHubPage />);
    await openRowMenu("INV-0007");
    fireEvent.click(await screen.findByText("Duplicate"));
    expect(push).toHaveBeenCalledWith("/app/commerce/invoices/new");
    const dup = JSON.parse(sessionStorage.getItem("invoice_duplicate") ?? "{}") as Record<string, unknown>;
    expect(dup).toMatchObject({ contactId: "ct_rena", taxRate: 12.5, discountType: "FIXED", discountValue: 20, notes: "Deposit 50% to confirm the date" });
  });

  it("RED-BEFORE (complete search): an invoice is found by its notes", async () => {
    rows = [
      row({ id: "inv_a", invoiceNumber: "INV-0010", notes: "Wedding at Pigeon Point" }),
      row({ id: "inv_b", invoiceNumber: "INV-0011", notes: null }),
    ];
    render(<InvoicesHubPage />);
    await screen.findAllByText("INV-0010");
    fireEvent.change(screen.getByPlaceholderText(/search invoices/i), { target: { value: "pigeon" } });
    await waitFor(() => expect(screen.queryAllByText("INV-0011")).toHaveLength(0));
    expect(screen.getAllByText("INV-0010").length).toBeGreaterThan(0);
  });

  it("RED-BEFORE (BUG-089): the Unpaid card lists the part-paid invoice it counts", async () => {
    rows = [
      row({ id: "inv_sent", invoiceNumber: "INV-0020", status: "SENT" }),
      row({
        id: "inv_part", invoiceNumber: "INV-0021", status: "PARTIALLY_PAID", total: 300, subtotal: 300,
        payments: [{ id: "pay_1", amount: 100, currency: "USD", status: "SUCCESSFUL", provider: "MANUAL", providerPaymentId: "m_1", createdAt: new Date().toISOString(), businessId: BIZ, invoiceId: "inv_part" }],
      }),
      row({ id: "inv_paid", invoiceNumber: "INV-0022", status: "PAID", paidAt: new Date().toISOString() }),
    ];
    render(<InvoicesHubPage />);
    const unpaid = await card("Unpaid");
    expect(unpaid.textContent).toMatch(/2 invoices/);
    fireEvent.click(unpaid);
    await waitFor(() => expect(screen.queryAllByText("INV-0022")).toHaveLength(0));
    expect(screen.getAllByText("INV-0020").length).toBeGreaterThan(0);
    expect(screen.getAllByText("INV-0021").length).toBeGreaterThan(0);
  });

  it("RED-BEFORE (BUG-131): a voided or paid invoice does not say 'Due in'", async () => {
    const due = new Date(Date.now() + 7 * DAY).toISOString();
    rows = [
      row({ id: "inv_void", invoiceNumber: "INV-0030", status: "VOID", dueDate: due }),
      row({ id: "inv_paid", invoiceNumber: "INV-0031", status: "PAID", dueDate: due, paidAt: new Date().toISOString() }),
      row({ id: "inv_sent", invoiceNumber: "INV-0032", status: "SENT", dueDate: due }),
    ];
    render(<InvoicesHubPage />);
    for (const n of ["INV-0030", "INV-0031"]) {
      const tr = (await screen.findAllByText(n))[0]!.closest("tr")!;
      expect(tr.textContent, `${n} has no 'Due in'`).not.toMatch(/Due in|Due today|overdue/i);
    }
    // CONTROL: an unpaid invoice still says when it is due.
    const sent = (await screen.findAllByText("INV-0032"))[0]!.closest("tr")!;
    expect(sent.textContent).toMatch(/Due in/);
  });

  it("RED-BEFORE (BUG-047): a part-paid row offers Record balance and Remind; Remind opens WhatsApp with the balance and the link", async () => {
    rows = [row({
      id: "inv_part", invoiceNumber: "INV-0040", status: "PARTIALLY_PAID", total: 300, subtotal: 300,
      payments: [{ id: "pay_1", amount: 100, currency: "USD", status: "SUCCESSFUL", provider: "MANUAL", providerPaymentId: "m_1", createdAt: new Date().toISOString(), businessId: BIZ, invoiceId: "inv_part" }],
    })];
    render(<InvoicesHubPage />);
    await openRowMenu("INV-0040");
    const menu = (await screen.findByText("Record balance")).closest("div") as HTMLElement;
    expect(within(menu).queryByText("Record payment")).toBeNull();
    fireEvent.click(within(menu).getByText("Remind"));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    const target = new URL(String(windowOpen.mock.calls[0]![0]));
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550145");
    const text = target.searchParams.get("text") ?? "";
    expect(text).toMatch(/200\.00/);
    expect(text).toMatch(/INV-0040/);
    expect(text).toMatch(/\/public\/invoice\/tok_inv_list_fixture/);
  });

  it("RED-BEFORE (review MINOR-3): Remind names the balance net of a refund, and is not offered when nothing is due or on a sent row", async () => {
    const pay = (id: string, invoiceId: string, amount: number, status = "SUCCESSFUL") => ({ id, amount, currency: "USD", status, provider: "MANUAL", providerPaymentId: `m_${id}`, createdAt: new Date().toISOString(), businessId: BIZ, invoiceId });
    rows = [
      // 300 total, 150 paid, 50 of it refunded: 200 still due.
      row({ id: "inv_ref", invoiceNumber: "INV-0050", status: "PARTIALLY_PAID", total: 300, subtotal: 300, payments: [pay("p1", "inv_ref", 150), pay("p2", "inv_ref", -50, "REFUNDED")] }),
      // Part-paid on the books but nothing left to pay: no reminder.
      row({ id: "inv_cov", invoiceNumber: "INV-0051", status: "PARTIALLY_PAID", total: 300, subtotal: 300, payments: [pay("p3", "inv_cov", 300)] }),
      row({ id: "inv_sent", invoiceNumber: "INV-0052", status: "SENT" }),
    ];
    render(<InvoicesHubPage />);
    await openRowMenu("INV-0051");
    await screen.findByText("Record balance");
    expect(screen.queryByText("Remind"), "nothing due: no reminder").toBeNull();
    await openRowMenu("INV-0052");
    await screen.findByText("Duplicate");
    expect(screen.queryByText("Remind"), "a sent row has no part-paid reminder").toBeNull();
    await openRowMenu("INV-0050");
    fireEvent.click(await screen.findByText("Remind"));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    const text = new URL(String(windowOpen.mock.calls[0]![0])).searchParams.get("text") ?? "";
    expect(text).toMatch(/200\.00/);
  });

  it("RED-BEFORE (review MINOR-1): a cached business that is not the one on screen does not set the cards' currency", async () => {
    cachedBusiness = { id: "biz_other", name: "Other", currency: "USD", country: "TT" };
    rows = [row({ id: "inv_ttd", invoiceNumber: "INV-0060", currency: "TTD", total: 100, subtotal: 100 })];
    render(<InvoicesHubPage />);
    const unpaid = await card("Unpaid");
    // The other business's USD is not used: the page keeps its own default, so this TTD invoice is counted, in TTD.
    expect(unpaid.textContent).toMatch(/TTD\s*100\.00/);
  });

  it("CONTROL (review MAJOR-2): a row with a discount type the form does not know still lists (read as none)", async () => {
    rows = [row({ id: "inv_legacy", invoiceNumber: "INV-0070", discountType: "PERCENTAGE", discountValue: 10 })];
    render(<InvoicesHubPage />);
    expect((await screen.findAllByText("INV-0070")).length).toBeGreaterThan(0);
  });

  it("CONTROL: a part-paid row's Record balance opens the invoice's record-payment step", async () => {
    rows = [row({ id: "inv_part", invoiceNumber: "INV-0041", status: "PARTIALLY_PAID", total: 300, subtotal: 300 })];
    render(<InvoicesHubPage />);
    await openRowMenu("INV-0041");
    const item = screen.queryByText("Record balance") ?? (await screen.findByText("Record payment"));
    fireEvent.click(item);
    expect(push).toHaveBeenCalledWith("/app/commerce/invoices/inv_part?action=record-payment");
  });
});
