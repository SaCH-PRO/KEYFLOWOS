/**
 * R0-21-WEB-PAYMENT-FORMS: the Sales > Invoices panel's two write forms.
 *
 * 1. Invoice save. The panel never passed `saving` to BillingFormModal and
 *    handleCreateOrUpdateInvoice had no in-flight guard, so a double click on
 *    "Create Invoice" issued two POST .../invoices and created two invoices.
 * 2. Record payment. The panel sent no idempotency key (M26 / CF-08), so a
 *    retried submit could record the payment twice; and it showed paid and
 *    remaining from the list row it was opened with rather than from the
 *    server's status-aware figures (GET .../payments: paidAmount, remaining).
 *
 * The panel is mounted with its real form modal, real hooks and the real
 * client; fetch is stubbed at the network edge. Only the panel's unrelated
 * side panels (drive upload, tax summary, dunning, detail drawer, payment plan,
 * mobile sheet) and app-shell contexts are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => {} }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task_r021", markTaskCompleted: vi.fn() }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => null }));
vi.mock("../../components/tax-summary-panel", () => ({ TaxSummaryPanel: () => null }));
vi.mock("../../components/dunning-rules", () => ({ DunningRulesPanel: () => null }));
vi.mock("../../components/billing-detail-modal", () => ({ BillingDetailModal: () => null }));
vi.mock("../../components/invoice-mobile-actions", () => ({ InvoiceMobileActions: () => null }));

import InvoicesPanel from "../invoices-panel";
import type { Invoice, PaymentRecord } from "@/lib/client";

const BIZ = "biz_r021p";
const INV = "inv_r021p";
const CREATE_PATH = `/commerce/businesses/${BIZ}/invoices`;
const PAY_PATH = `/commerce/businesses/${BIZ}/invoices/${INV}/payments`;

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

function row(id: string, amount: number, status: string): PaymentRecord {
  return {
    id, amount, status, currency: "TTD", provider: "CASH", providerPaymentId: `pp_${id}`,
    createdAt: "2026-10-30T10:00:00.000Z", businessId: BIZ, invoiceId: INV,
  };
}

function invoiceWith(payments: PaymentRecord[], status = "PARTIALLY_PAID", total = 100): Invoice {
  return {
    id: INV, invoiceNumber: "INV-R021P", status, total, currency: "TTD", payments,
    issueDate: new Date().toISOString(), dueDate: null, contactId: null, contact: null, items: [],
  };
}

type Call = { method: string; path: string; body: Record<string, unknown> | null };

function installServer(opts: {
  list?: { payments: PaymentRecord[]; paidAmount: number; remaining: number };
  pay?: Array<() => Promise<Response>>;
  create?: () => Promise<Response>;
} = {}) {
  const calls: Call[] = [];
  const pays = opts.pay ?? [];
  let payIndex = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    if (method === "POST" && url.pathname === CREATE_PATH) {
      if (opts.create) return opts.create();
      return jsonResponse(201, { ...invoiceWith([], "DRAFT", 112.5), id: "inv_created" });
    }
    if (method === "GET" && url.pathname === PAY_PATH) {
      const list = opts.list ?? { payments: [], paidAmount: 0, remaining: 100 };
      return jsonResponse(200, { ...list, invoiceTotal: 100 });
    }
    if (method === "POST" && url.pathname === PAY_PATH) {
      const next = pays[Math.min(payIndex, pays.length - 1)];
      payIndex += 1;
      if (next) return next();
      return jsonResponse(201, recorded(Number(body?.amount ?? 0)));
    }
    if (method === "GET" && url.pathname.endsWith("/document-templates")) {
      return jsonResponse(200, { templates: [], branding: {} });
    }
    return jsonResponse(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    creates: () => calls.filter((c) => c.method === "POST" && c.path === CREATE_PATH),
    payPosts: () => calls.filter((c) => c.method === "POST" && c.path === PAY_PATH),
  };
}

function recorded(amount: number) {
  const payment = row(`p_new_${amount}`, amount, "SUCCESSFUL");
  return {
    payment,
    invoice: invoiceWith([row("p_ok", 30, "SUCCESSFUL"), payment]),
    paidAmount: 30 + amount,
    remaining: Math.max(0, 70 - amount),
  };
}

function Panel(props: { invoices?: Invoice[]; prefill?: boolean }) {
  const [invoices, setInvoices] = React.useState<Invoice[]>(props.invoices ?? []);
  const [products, setProducts] = React.useState<import("@/lib/client").Product[]>([]);
  const prefillItems = React.useMemo(
    () => [{ id: "li_1", productId: "", description: "Consultation", quantity: "1", unitPrice: "100" }],
    [],
  );
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
      {...(props.prefill ? { prefillContactId: "ct_r021", prefillItems, prefillToken: 1 } : {})}
    />
  );
}

function createButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^(Create Invoice|Saving\.\.\.)$/ }) as HTMLButtonElement;
}

describe("R0-21 invoices-panel: a double click on save gives one POST", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-r021p");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("two clicks on Create Invoice issue one POST, and the button reads Saving... while it is in flight", async () => {
    let release: (r: Response) => void = () => {};
    const server = installServer({ create: () => new Promise<Response>((resolve) => { release = resolve; }) });
    render(<Panel prefill />);
    await screen.findByRole("button", { name: /^Create Invoice$/ });

    fireEvent.click(createButton());
    await waitFor(() => expect(server.creates()).toHaveLength(1));
    // BillingFormModal disables its save button while `saving`.
    expect(createButton()).toBeDisabled();
    expect(createButton().textContent).toMatch(/Saving/);
    fireEvent.click(createButton());
    await new Promise((r) => setTimeout(r, 20));
    expect(server.creates()).toHaveLength(1);

    await act(async () => { release(jsonResponse(201, { ...invoiceWith([], "DRAFT", 112.5), id: "inv_created" })); });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^(Create Invoice|Saving\.\.\.)$/ })).toBeNull());
    expect(server.creates()).toHaveLength(1);
  });

  it("two clicks landing before React re-renders still issue one POST", async () => {
    let release: (r: Response) => void = () => {};
    const server = installServer({ create: () => new Promise<Response>((resolve) => { release = resolve; }) });
    render(<Panel prefill />);
    await screen.findByRole("button", { name: /^Create Invoice$/ });

    const button = createButton();
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(server.creates().length).toBeGreaterThanOrEqual(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(server.creates()).toHaveLength(1);

    await act(async () => { release(jsonResponse(201, { ...invoiceWith([], "DRAFT", 112.5), id: "inv_created" })); });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^(Create Invoice|Saving\.\.\.)$/ })).toBeNull());
  });

  it("a failed save re-enables the button so the operator can try again", async () => {
    const server = installServer({ create: async () => jsonResponse(400, { message: "Items are required" }) });
    render(<Panel prefill />);
    await screen.findByRole("button", { name: /^Create Invoice$/ });

    fireEvent.click(createButton());
    await waitFor(() => expect(server.creates()).toHaveLength(1));
    await waitFor(() => expect(createButton()).not.toBeDisabled());
    fireEvent.click(createButton());
    await waitFor(() => expect(server.creates()).toHaveLength(2));
  });
});

describe("R0-21 invoices-panel: record payment carries one key per open and shows the server's figures", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-r021p");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  async function openPayment() {
    fireEvent.click(screen.getAllByRole("button", { name: /^Record payment$/ })[0]!);
    await screen.findByPlaceholderText("Payment amount");
  }

  function figure(label: string): string {
    const el = screen.getAllByText(label).find((e) => e.nextElementSibling);
    return el?.nextElementSibling?.textContent ?? "";
  }

  it("each open gets one crypto.randomUUID key, a retry reuses it, the next open gets a new one", async () => {
    const uuids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"];
    let n = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => uuids[Math.min(n++, uuids.length - 1)] as `${string}-${string}-${string}-${string}-${string}`,
    );
    const server = installServer({
      list: { payments: [row("p_ok", 30, "SUCCESSFUL")], paidAmount: 30, remaining: 70 },
      pay: [
        async () => jsonResponse(502, { message: "Bad gateway" }),
        async () => jsonResponse(201, recorded(20)),
        async () => jsonResponse(201, recorded(10)),
      ],
    });
    render(<Panel invoices={[invoiceWith([row("p_ok", 30, "SUCCESSFUL")])]} />);

    await openPayment();
    fireEvent.change(screen.getByPlaceholderText("Payment amount"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /^Record Payment$/ }));
    await waitFor(() => expect(server.payPosts()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Record Payment$/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /^Record Payment$/ }));
    await waitFor(() => expect(server.payPosts()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByPlaceholderText("Payment amount")).toBeNull());

    const [first, retry] = server.payPosts();
    expect(typeof first!.body?.idempotencyKey).toBe("string");
    expect(first!.body?.idempotencyKey).toBe(uuids[0]);
    expect(retry!.body?.idempotencyKey).toBe(first!.body?.idempotencyKey);

    await openPayment();
    fireEvent.change(screen.getByPlaceholderText("Payment amount"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^Record Payment$/ }));
    await waitFor(() => expect(server.payPosts()).toHaveLength(3));
    const third = server.payPosts()[2]!;
    expect(typeof third.body?.idempotencyKey).toBe("string");
    expect(third.body?.idempotencyKey).not.toBe(first!.body?.idempotencyKey);
  });

  it("shows paid and remaining from the server's payments read, not from the list row it was opened with", async () => {
    installServer({ list: { payments: [row("p_ok", 30, "SUCCESSFUL")], paidAmount: 30, remaining: 70 } });
    // The list row predates the 30 payment.
    render(<Panel invoices={[invoiceWith([], "SENT")]} />);
    // SENT's smart CTA is Remind; the overflow menu carries Record payment.
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    await openPayment();

    await waitFor(() => expect(figure("Already Paid")).toMatch(/\b30\.00\b/));
    expect(figure("Remaining")).toMatch(/\b70\.00\b/);
    await waitFor(() => expect((screen.getByPlaceholderText("Payment amount") as HTMLInputElement).value).toBe("70.00"));
  });

  it("an amount above the server's remaining balance asks for confirmation first", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const server = installServer({ list: { payments: [row("p_ok", 30, "SUCCESSFUL")], paidAmount: 30, remaining: 70 } });
    render(<Panel invoices={[invoiceWith([row("p_ok", 30, "SUCCESSFUL")])]} />);
    await openPayment();
    await waitFor(() => expect(figure("Remaining")).toMatch(/\b70\.00\b/));

    fireEvent.change(screen.getByPlaceholderText("Payment amount"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: /^Record Payment$/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(String(confirmSpy.mock.calls[0]![0])).toMatch(/20\.00/);
    await new Promise((r) => setTimeout(r, 20));
    expect(server.payPosts()).toHaveLength(0);
  });
});
