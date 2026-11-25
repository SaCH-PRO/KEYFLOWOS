/**
 * SWP-INV-DETAIL, the web half (V1-64; sweep BUG-051, BUG-084, BUG-085, BUG-086, the web side of BUG-088; journey
 * E; FCP-COR-1 for journey C4). The server half (sentAt stamped on DRAFT -> SENT, one invoice.sent activity) is
 * apps/server/test/invoice-sent-at.integration.test.ts. The browser half is e2e/sweep-invoice-detail.spec.ts.
 *
 * The invoice detail page (/app/commerce/invoices/[id]):
 *   - BUG-084: a payment recorded before the Payments tab was first opened was the only row the tab listed (the tab
 *     read the server's list only while its own list was empty), and Mark paid left the list as it was.
 *   - BUG-085: "Amount due" was the invoice total, not what is still owed (the Payment Summary's Remaining).
 *   - BUG-086: Mark paid was offered on a DRAFT only (the server refuses it, 409), and never on an invoice that can be
 *     paid. The Invoices list's row menu and the commerce Payments tab offered it on a DRAFT too.
 *   - BUG-088 (web side): Send -> Confirm & Send left the Activity tab as it was loaded, so 'Invoice sent' (the
 *     server's invoice.sent entry, from the sentAt it now stamps) showed only after a reload.
 *   - BUG-051: Print / PDF printed the whole app screen (navigation, tabs and buttons). Print now prints the invoice
 *     alone (a print sheet of the page's own figures), and Download PDF builds a one-invoice A4 PDF from the same
 *     projection with jspdf / jspdf-autotable.
 *   - FCP-COR-1 (journey C4): the invoice's customer is a link to /app/crm/contacts/:id.
 *
 * The detail page is mounted as the route renders it with its data doors (@/lib/client) stubbed; the Invoices list
 * and the Payments tab are mounted with the same doors. Cases tagged RED-BEFORE fail on the packet's base
 * (85f6d3e0); CONTROL cases pass on both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { Invoice, PaymentRecord, InvoiceTimelineEntry } from "@/lib/client";

const getInvoice = vi.hoisted(() => vi.fn());
const getInvoiceTimeline = vi.hoisted(() => vi.fn());
const listInvoicePayments = vi.hoisted(() => vi.fn());
const updateInvoiceStatus = vi.hoisted(() => vi.fn());
const markInvoicePaid = vi.hoisted(() => vi.fn());
const recordInvoicePayment = vi.hoisted(() => vi.fn());
const createInvoicePaymentLink = vi.hoisted(() => vi.fn());
const fetchInvoices = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: "inv_v64" }),
  usePathname: () => "/app/commerce/invoices/inv_v64",
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
    refreshWorkspace: async () => "biz_v64",
    getStoredBusinessId: () => "biz_v64",
    getCachedBusiness: () => ({ id: "biz_v64", name: "Island Events", currency: "TTD", country: "TT" }),
  };
});
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    getInvoice: (...args: unknown[]) => getInvoice(...args),
    getInvoiceTimeline: (...args: unknown[]) => getInvoiceTimeline(...args),
    listInvoicePayments: (...args: unknown[]) => listInvoicePayments(...args),
    updateInvoiceStatus: (...args: unknown[]) => updateInvoiceStatus(...args),
    markInvoicePaid: (...args: unknown[]) => markInvoicePaid(...args),
    recordInvoicePayment: (...args: unknown[]) => recordInvoicePayment(...args),
    createInvoicePaymentLink: (...args: unknown[]) => createInvoicePaymentLink(...args),
    fetchInvoices: (...args: unknown[]) => fetchInvoices(...args),
    fetchContacts: async () => ({ data: { contacts: [] }, error: null }),
    fetchProducts: async () => ({ data: [], error: null }),
    getGmailStatus: async () => ({ data: { connected: false, email: null }, error: null }),
  };
});

import { toast } from "sonner";
import InvoiceDetailPage from "../[id]/page";
import InvoicesHubPage from "../page";
import PaymentsTab from "../../payments/payments-tab";
import { formatAmount } from "../../utils/commerce-utils";

const BIZ = "biz_v64";
const INV = "inv_v64";
const TTD = (n: number) => formatAmount(n, "TTD");

function pay(id: string, amount: number, provider = "cash", status = "SUCCESSFUL"): PaymentRecord {
  return { id, amount, status, currency: "TTD", provider, providerPaymentId: `manual_${INV}_${id}`, createdAt: "2026-11-20T10:00:00.000Z", businessId: BIZ, invoiceId: INV };
}

const P1 = pay("pay_cash_100", 100);
const P2 = pay("pay_bank_50", 50, "bank_transfer");
const PM = pay("pay_markpaid", 300, "manual");

function invoice(status: string, payments: PaymentRecord[], figures?: { paidAmount: number; remaining: number }, over: Partial<Invoice> = {}): Invoice {
  return {
    id: INV,
    invoiceNumber: "INV-V64",
    status,
    total: 300,
    subtotal: 300,
    taxRate: 0,
    taxAmount: 0,
    discountAmount: 0,
    currency: "TTD",
    notes: "Thank you for your business",
    issueDate: "2026-11-18T10:00:00.000Z",
    dueDate: "2026-12-18T10:00:00.000Z",
    contactId: "ct_v64",
    contact: { firstName: "Rena", lastName: "Ali", email: "rena@example.test" },
    items: [{ id: "it_1", description: "Tent hire", quantity: 1, unitPrice: 300, total: 300 } as NonNullable<Invoice["items"]>[number]],
    payments,
    ...(figures ?? {}),
    ...over,
  };
}

function entry(type: string, label: string, at = "2026-11-18T10:00:00.000Z"): InvoiceTimelineEntry {
  return { id: `${type}-${INV}`, type, label, at } as InvoiceTimelineEntry;
}

function paymentRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-testid='invoice-payment-row']"));
}

/** The "Amount due" info card's value. */
function amountDue(): string {
  const label = screen.getByText("Amount due");
  const card = label.parentElement!.parentElement as HTMLElement;
  return card.querySelector("p")?.textContent ?? "";
}

/** The Payment Summary card's Remaining figure (the server's). */
function remainingFigure(): string {
  const box = screen.getByText("Payment Summary").parentElement as HTMLElement;
  const line = Array.from(box.querySelectorAll("div")).find((d) => d.firstElementChild?.textContent === "Remaining");
  return line?.lastElementChild?.textContent ?? "";
}

async function mountDetail(first: Invoice) {
  getInvoice.mockResolvedValueOnce({ data: first, error: null });
  render(<InvoiceDetailPage />);
  await waitFor(() => expect(screen.getByText("Payment Summary")).toBeInTheDocument());
}

function openPaymentsTab() {
  fireEvent.click(screen.getByRole("button", { name: /^Payments/ }));
}

/** Records a payment through the page's Record Payment modal. */
async function recordThroughModal(amount: string) {
  fireEvent.click(screen.getAllByRole("button", { name: /^record payment$/i })[0]!);
  const modal = screen.getByRole("heading", { name: "Record Payment" }).parentElement as HTMLElement;
  fireEvent.change(modal.querySelector('input[type="number"]')!, { target: { value: amount } });
  fireEvent.click(within(modal).getByRole("button", { name: "Record Payment" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Record Payment" })).toBeNull());
}

/** Reads a Blob's bytes as latin1 (jsdom's Blob is read through FileReader). */
function latin1(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer), (b) => String.fromCharCode(b)).join(""));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  for (const fn of [getInvoice, getInvoiceTimeline, listInvoicePayments, updateInvoiceStatus, markInvoicePaid, recordInvoicePayment, createInvoicePaymentLink, fetchInvoices, push]) fn.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.info).mockReset();
  getInvoiceTimeline.mockResolvedValue({ data: { entries: [entry("invoice.created", "Invoice created")] }, error: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SWP-INV-DETAIL: the invoice detail page", () => {
  it("RED-BEFORE (BUG-084): a payment recorded before the Payments tab is first opened is listed beside the one already there: two rows", async () => {
    await mountDetail(invoice("PARTIALLY_PAID", [P1], { paidAmount: 100, remaining: 200 }));
    recordInvoicePayment.mockResolvedValue({
      data: { payment: P2, invoice: invoice("PARTIALLY_PAID", [P1, P2]), paidAmount: 150, remaining: 150 },
      error: null,
    });
    listInvoicePayments.mockResolvedValue({ data: { payments: [P2, P1], paidAmount: 150, remaining: 150, invoiceTotal: 300 }, error: null });

    await recordThroughModal("50");
    openPaymentsTab();

    // RED-BEFORE: one row (the payment just recorded): the tab read the server's list only while its own was empty.
    await waitFor(() => expect(paymentRows().map((r) => r.dataset.paymentId)).toEqual(["pay_bank_50", "pay_cash_100"]));
    expect(listInvoicePayments).toHaveBeenCalledWith(BIZ, INV);
  });

  it("CONTROL: with the Payments tab open, a recorded payment is listed at once beside the earlier one", async () => {
    await mountDetail(invoice("PARTIALLY_PAID", [P1], { paidAmount: 100, remaining: 200 }));
    listInvoicePayments.mockResolvedValueOnce({ data: { payments: [P1], paidAmount: 100, remaining: 200, invoiceTotal: 300 }, error: null });
    listInvoicePayments.mockResolvedValue({ data: { payments: [P2, P1], paidAmount: 150, remaining: 150, invoiceTotal: 300 }, error: null });
    recordInvoicePayment.mockResolvedValue({
      data: { payment: P2, invoice: invoice("PARTIALLY_PAID", [P1, P2]), paidAmount: 150, remaining: 150 },
      error: null,
    });
    openPaymentsTab();
    await waitFor(() => expect(paymentRows()).toHaveLength(1));

    await recordThroughModal("50");

    await waitFor(() => expect(paymentRows().map((r) => r.dataset.paymentId)).toEqual(["pay_bank_50", "pay_cash_100"]));
  });

  it("RED-BEFORE (BUG-085): 'Amount due' is what is still owed (300 with 100 paid reads 200), and follows a recorded payment", async () => {
    await mountDetail(invoice("PARTIALLY_PAID", [P1], { paidAmount: 100, remaining: 200 }));
    // RED-BEFORE: TTD 300.00 (the total).
    expect(amountDue()).toBe(TTD(200));
    expect(remainingFigure()).toBe(TTD(200));

    recordInvoicePayment.mockResolvedValue({
      data: { payment: P2, invoice: invoice("PARTIALLY_PAID", [P1, P2]), paidAmount: 150, remaining: 150 },
      error: null,
    });
    await recordThroughModal("50");
    await waitFor(() => expect(amountDue()).toBe(TTD(150)));
    expect(remainingFigure()).toBe(TTD(150));
  });

  it("CONTROL: an unpaid invoice's 'Amount due' is its total", async () => {
    await mountDetail(invoice("SENT", [], { paidAmount: 0, remaining: 300 }));
    expect(amountDue()).toBe(TTD(300));
  });

  it("RED-BEFORE (BUG-086): a DRAFT offers no Mark paid (the sidebar or the More menu), and no Copy payment link", async () => {
    await mountDetail(invoice("DRAFT", [], { paidAmount: 0, remaining: 300 }));
    // RED-BEFORE: two Mark paid controls (sidebar Actions and the More menu), on a DRAFT only.
    expect(screen.queryAllByRole("button", { name: /mark paid/i })).toHaveLength(0);
    // CONTROL (SWP-INV-PUBLIC-LINK, FU-WEB-PAYLINK-STATUS-BUTTONS): no share door on a draft.
    expect(screen.queryAllByRole("button", { name: /copy (payment )?link/i })).toHaveLength(0);
    // The draft is still sent from its page (Release 0 pins 'Send').
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("RED-BEFORE (BUG-086, BUG-084, BUG-085): a SENT invoice offers Mark paid; marking it paid re-reads the invoice and its payments: the balancing payment is listed and nothing is due", async () => {
    await mountDetail(invoice("SENT", [], { paidAmount: 0, remaining: 300 }));
    listInvoicePayments.mockResolvedValueOnce({ data: { payments: [], paidAmount: 0, remaining: 300, invoiceTotal: 300 }, error: null });
    listInvoicePayments.mockResolvedValue({ data: { payments: [PM], paidAmount: 300, remaining: 0, invoiceTotal: 300 }, error: null });
    markInvoicePaid.mockResolvedValue({ data: invoice("PAID", [PM]), error: null });
    getInvoice.mockResolvedValue({ data: invoice("PAID", [PM], { paidAmount: 300, remaining: 0 }), error: null });
    openPaymentsTab();
    await screen.findByText("No payments recorded yet.");

    // RED-BEFORE: no Mark paid on a SENT invoice (it was gated on DRAFT).
    const markPaid = screen.getAllByRole("button", { name: /mark paid/i });
    expect(markPaid.length).toBeGreaterThan(0);
    fireEvent.click(markPaid[0]!);

    await waitFor(() => expect(markInvoicePaid).toHaveBeenCalledWith(INV));
    await waitFor(() => expect(paymentRows().map((r) => r.dataset.paymentId)).toEqual(["pay_markpaid"]));
    await waitFor(() => expect(amountDue()).toBe(TTD(0)));
    expect(remainingFigure()).toBe(TTD(0));
    expect(screen.queryAllByRole("button", { name: /mark paid/i })).toHaveLength(0);
  });

  it("CONTROL: a PAID invoice offers no Mark paid and no Record Payment", async () => {
    await mountDetail(invoice("PAID", [PM], { paidAmount: 300, remaining: 0 }));
    expect(screen.queryAllByRole("button", { name: /mark paid/i })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /^record payment$/i })).toHaveLength(0);
  });

  it("RED-BEFORE (BUG-088 web side): Send -> Confirm & Send re-reads the activity, so 'Invoice sent' is listed without a reload", async () => {
    await mountDetail(invoice("DRAFT", [], { paidAmount: 0, remaining: 300 }));
    await screen.findByText("Invoice created");
    getInvoiceTimeline.mockResolvedValue({
      data: { entries: [entry("invoice.created", "Invoice created"), entry("invoice.sent", "Invoice sent", "2026-11-20T10:00:00.000Z")] },
      error: null,
    });
    updateInvoiceStatus.mockResolvedValue({ data: invoice("SENT", [], undefined, { sentAt: "2026-11-20T10:00:00.000Z" } as Partial<Invoice>), error: null });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("heading", { name: "Send Invoice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm & send/i }));

    await waitFor(() => expect(updateInvoiceStatus).toHaveBeenCalledWith(INV, "SENT"));
    const badge = screen.getByRole("heading", { level: 1, name: "Invoice INV-V64" }).nextElementSibling;
    await waitFor(() => expect(badge?.textContent).toBe("Sent"));
    // RED-BEFORE: the activity stays as loaded (Invoice created only).
    expect(await screen.findByText("Invoice sent")).toBeInTheDocument();
  });

  it("RED-BEFORE (BUG-051): Print prints the invoice: a print sheet of the invoice (number, customer, lines, totals, balance due), with no app control in it, is in place when the browser prints, and is removed after", async () => {
    await mountDetail(invoice("PARTIALLY_PAID", [P1], { paidAmount: 100, remaining: 200 }));
    let atPrint: { sheet: string | null; parentIsBody: boolean; bodyFlagged: boolean } | null = null;
    const print = vi.fn(() => {
      const sheet = document.querySelector<HTMLElement>("[data-invoice-print]");
      atPrint = { sheet: sheet?.textContent ?? null, parentIsBody: sheet?.parentElement === document.body, bodyFlagged: document.body.classList.contains("kf-printing-invoice") };
    });
    vi.stubGlobal("print", print);

    fireEvent.click(screen.getAllByRole("button", { name: /^print/i })[0]!);

    expect(print).toHaveBeenCalledTimes(1);
    // RED-BEFORE: nothing but the app screen to print (no sheet).
    expect(atPrint).not.toBeNull();
    const at = atPrint as unknown as { sheet: string | null; parentIsBody: boolean; bodyFlagged: boolean };
    expect(at.sheet).not.toBeNull();
    expect(at.parentIsBody, "the sheet sits beside the app, so print.css can print it alone").toBe(true);
    expect(at.bodyFlagged).toBe(true);
    for (const part of ["INV-V64", "Rena Ali", "rena@example.test", "Tent hire", TTD(300), "Balance due", TTD(200), TTD(100), "Thank you for your business"]) {
      expect(at.sheet, part).toContain(part);
    }
    expect(at.sheet).not.toMatch(/Record Payment|Copy payment link|Mark paid|Activity|Download PDF/);

    act(() => { window.dispatchEvent(new Event("afterprint")); });
    expect(document.querySelector("[data-invoice-print]")).toBeNull();
    expect(document.body.classList.contains("kf-printing-invoice")).toBe(false);
  });

  it("RED-BEFORE (BUG-051): the browser's own Print (Ctrl+P) prints the same sheet", async () => {
    await mountDetail(invoice("SENT", [], { paidAmount: 0, remaining: 300 }));
    act(() => { window.dispatchEvent(new Event("beforeprint")); });
    // RED-BEFORE: no sheet.
    expect(document.querySelector("[data-invoice-print]")?.textContent ?? "").toContain("INV-V64");
    act(() => { window.dispatchEvent(new Event("afterprint")); });
    expect(document.querySelector("[data-invoice-print]")).toBeNull();
  });

  it("RED-BEFORE (BUG-051): Download PDF downloads a one-page A4 PDF of the invoice, named for it, with the page's figures", async () => {
    await mountDetail(invoice("PARTIALLY_PAID", [P1], { paidAmount: 100, remaining: 200 }));
    const blobs: Blob[] = [];
    const names: string[] = [];
    // jsdom has no object URLs: the download's Blob is captured instead, and the anchor's click records its name.
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:invoice-v64"; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    try {
      // RED-BEFORE: no Download PDF (Print / PDF printed the screen).
      fireEvent.click(screen.getAllByRole("button", { name: /download pdf/i })[0]!);
      await waitFor(() => expect(blobs).toHaveLength(1), { timeout: 10_000 });
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
    expect(names).toEqual(["INV-V64.pdf"]);
    expect(blobs[0]!.type).toBe("application/pdf");
    const bytes = await latin1(blobs[0]!);
    expect(bytes.startsWith("%PDF")).toBe(true);
    expect((bytes.match(/\/Type\s*\/Page\b/g) ?? []).length, "one page").toBe(1);
    const box = bytes.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    expect(box && [Math.round(Number(box[1])), Math.round(Number(box[2]))], "A4").toEqual([595, 842]);
    for (const part of ["INV-V64", "Rena Ali", "Tent hire", "Balance due", "200.00", "100.00", "300.00"]) expect(bytes, part).toContain(part);
  }, 20_000);

  it("RED-BEFORE (FCP-COR-1, journey C4): the invoice's customer is a link to /app/crm/contacts/:id", async () => {
    await mountDetail(invoice("SENT", [], { paidAmount: 0, remaining: 300 }));
    const links = screen.getAllByRole("link", { name: /Rena Ali/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute("href")).toBe("/app/crm/contacts/ct_v64");
  });

  it("CONTROL (Release 0): the invoice-not-found heading for a refused read is unchanged", async () => {
    getInvoice.mockResolvedValueOnce({ data: null, error: "Invoice not found" });
    render(<InvoiceDetailPage />);
    expect(await screen.findByRole("heading", { name: "Invoice not found" })).toBeInTheDocument();
  });
});

function listRow(over: Partial<Invoice> & { id: string; invoiceNumber: string; status: string }): Invoice {
  return { ...invoice(over.status, []), ...over };
}

async function openRowMenu(invoiceNumber: string): Promise<void> {
  const cells = await screen.findAllByText(invoiceNumber);
  const tr = cells[0]!.closest("tr")!;
  const buttons = tr.querySelectorAll("button");
  fireEvent.click(buttons[buttons.length - 1]!);
}

describe("SWP-INV-DETAIL: the other doors to Mark paid (B2)", () => {
  it("RED-BEFORE (BUG-086): the Invoices list's DRAFT row menu offers no Mark paid; a SENT row's does (control)", async () => {
    fetchInvoices.mockResolvedValue({
      data: [listRow({ id: "inv_draft", invoiceNumber: "INV-DRAFT", status: "DRAFT" }), listRow({ id: "inv_sent", invoiceNumber: "INV-SENT", status: "SENT" })],
      error: null,
    });
    render(<InvoicesHubPage />);

    await openRowMenu("INV-DRAFT");
    // RED-BEFORE: Mark paid on the draft.
    expect(screen.queryByRole("button", { name: /mark paid/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeInTheDocument();

    await openRowMenu("INV-SENT");
    expect(screen.getByRole("button", { name: /mark paid/i })).toBeInTheDocument();
  });

  it("RED-BEFORE (BUG-086): the commerce Payments tab offers no Mark Paid on a DRAFT row, and its bulk Mark Paid skips a DRAFT", async () => {
    const future = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const draft = listRow({ id: "inv_draft", invoiceNumber: "INV-DRAFT", status: "DRAFT", dueDate: future });
    const sent = listRow({ id: "inv_sent", invoiceNumber: "INV-SENT", status: "SENT", dueDate: future });
    render(<PaymentsTab invoices={[draft, sent]} currency="TTD" businessId={BIZ} setInvoices={vi.fn()} />);

    const rowOf = (n: string) => screen.getByLabelText(`Select payment ${n}`).closest("label")!.parentElement as HTMLElement;
    // RED-BEFORE: the draft row carries Mark Paid.
    expect(within(rowOf("INV-DRAFT")).queryByTitle("Mark Paid")).toBeNull();
    expect(within(rowOf("INV-SENT")).getByTitle("Mark Paid")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Select payment INV-DRAFT"));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    fireEvent.click(screen.getByText("Mark Paid", { selector: "button" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("No eligible invoices to mark as paid"));
    // RED-BEFORE: the draft is sent to the server (which refuses it, 409).
    expect(markInvoicePaid).not.toHaveBeenCalled();
  });
});
