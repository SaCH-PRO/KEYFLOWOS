/**
 * R0-21-WEB-PAYMENT-FORMS: the finance pipeline's Record Payment modal.
 *
 * M29: the modal summed `p.amount` across every payment status, so PENDING and
 * FAILED rows showed as collected cash, and an amount above the balance was
 * recorded without a word. M26 / CF-08: the server (R0-D2) only deduplicates a
 * manual payment when the body carries an idempotency key or a reference, and
 * this form sent neither, so a retried submit could record the payment twice.
 *
 * The modal is mounted the way finance-pipeline.tsx mounts it: the real
 * usePipelineActions hook, the real client and api layer, and fetch stubbed at
 * the network edge with server-shaped responses. The server's figures are the
 * ones CommerceService.getInvoiceForBusiness serves on the tenant detail route
 * (paidAmount = sum of SUCCESSFUL rows, remaining = max(0, total - paidAmount)).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import { PaymentRecordModal } from "../payment-record-modal";
import { usePipelineActions } from "../../hooks/use-pipeline-actions";
import type { Invoice, Quote, PaymentRecord } from "@/lib/client";

const BIZ = "biz_r021";
const INV = "inv_r021";
const DETAIL_PATH = `/commerce/businesses/${BIZ}/invoices/${INV}`;
const PAY_PATH = `${DETAIL_PATH}/payments`;

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

function invoiceWith(payments: PaymentRecord[], total = 100, status = "PARTIALLY_PAID"): Invoice {
  return { id: INV, invoiceNumber: "INV-R021", status, total, currency: "TTD", payments };
}

type Call = { method: string; path: string; body: Record<string, unknown> | null };

/**
 * Network edge. `detail` is what the tenant detail route answers; `post` is a
 * queue of answers for POST .../payments (the last one repeats).
 */
function installServer(opts: {
  detail: { paidAmount: number; remaining: number; payments: PaymentRecord[]; total?: number; status?: string };
  post?: Array<() => Promise<Response>>;
}) {
  const calls: Call[] = [];
  const posts = opts.post ?? [];
  let postIndex = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    if (method === "GET" && url.pathname === DETAIL_PATH) {
      return jsonResponse(200, {
        ...invoiceWith(opts.detail.payments, opts.detail.total ?? 100, opts.detail.status ?? "PARTIALLY_PAID"),
        paidAmount: opts.detail.paidAmount,
        remaining: opts.detail.remaining,
      });
    }
    if (method === "POST" && url.pathname === PAY_PATH) {
      const next = posts[Math.min(postIndex, posts.length - 1)];
      postIndex += 1;
      if (next) return next();
      return jsonResponse(201, okRecord(Number(body?.amount ?? 0)));
    }
    return jsonResponse(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    posts: () => calls.filter((c) => c.method === "POST" && c.path === PAY_PATH),
    detailReads: () => calls.filter((c) => c.method === "GET" && c.path === DETAIL_PATH),
  };
}

function okRecord(amount: number) {
  const payment = row(`p_new_${amount}`, amount, "SUCCESSFUL");
  return {
    payment,
    invoice: { ...invoiceWith([row("p_ok", 30, "SUCCESSFUL"), payment]), status: "PARTIALLY_PAID" },
    paidAmount: 30 + amount,
    remaining: Math.max(0, 100 - 30 - amount),
  };
}

/** finance-pipeline.tsx:504-510, verbatim wiring. */
function PipelineHarness({ invoice }: { invoice: Invoice }) {
  const [invoices, setInvoices] = useState<Invoice[]>([invoice]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const actions = usePipelineActions({ businessId: BIZ, invoices, quotes, setInvoices, setQuotes });
  return (
    <>
      <button type="button" onClick={() => actions.setPaymentModalFor(invoices[0]!)}>open-payment</button>
      <PaymentRecordModal
        invoice={actions.paymentModalFor}
        businessId={BIZ}
        onClose={() => actions.setPaymentModalFor(null)}
        onSubmit={(inv, form) => actions.handleRecordPayment(inv, form)}
        loading={actions.paymentModalFor ? actions.actionLoading[`payment-${actions.paymentModalFor.id}`] : false}
      />
    </>
  );
}

/** The figure printed next to a summary label ("Already paid", "Remaining"). */
function summaryFigure(label: string): string {
  const labels = screen.getAllByText(label, { selector: "span" });
  // The summary block renders the label then its value as the next sibling.
  const inSummary = labels.find((el) => el.nextElementSibling);
  return inSummary?.nextElementSibling?.textContent ?? "";
}

function amountInput(): HTMLInputElement {
  return screen.getByRole("spinbutton") as HTMLInputElement;
}

function recordButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^(Record Payment|Recording\.\.\.)$/ }) as HTMLButtonElement;
}

async function openModal() {
  fireEvent.click(screen.getByText("open-payment"));
  await screen.findByText("Already paid");
}

describe("R0-21 payment-record-modal: status-aware figures from the server (M29)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-r021");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("[SUCCESSFUL 30, PENDING 999, FAILED 999] on a 100 invoice shows already-paid 30 and remaining 70, not 2028", async () => {
    const payments = [row("p_ok", 30, "SUCCESSFUL"), row("p_pend", 999, "PENDING"), row("p_fail", 999, "FAILED")];
    installServer({ detail: { paidAmount: 30, remaining: 70, payments } });
    render(<PipelineHarness invoice={invoiceWith(payments)} />);
    await openModal();

    await waitFor(() => expect(summaryFigure("Already paid")).toMatch(/\b30\.00\b/));
    expect(summaryFigure("Already paid")).not.toMatch(/2,?028/);
    expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/);
  });

  it("takes the figures from the server's tenant detail route, not from the list row the modal was opened with", async () => {
    // The list row is stale (it was loaded before the 30 payment landed); the
    // tenant detail route is the authority.
    const server = installServer({ detail: { paidAmount: 30, remaining: 70, payments: [row("p_ok", 30, "SUCCESSFUL")] } });
    render(<PipelineHarness invoice={invoiceWith([], 100, "SENT")} />);
    await openModal();

    await waitFor(() => expect(summaryFigure("Already paid")).toMatch(/\b30\.00\b/));
    expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/);
    expect(server.detailReads().length).toBeGreaterThanOrEqual(1);
  });

  it("M28 characterization (refund convention owned by V1-29): with a REFUNDED row present the modal shows the server's figures unchanged", async () => {
    // Today's row-flip convention: refunding a 20 payment flips that row to
    // REFUNDED. The tenant detail route counts SUCCESSFUL rows only, so it
    // serves paid 60 / remaining 40. V1-29 owns the refund arithmetic; this
    // case pins only that the web repeats the server and invents nothing
    // (no "REFUNDED -20" negative row exists before V1-29).
    const payments = [row("p_ok", 60, "SUCCESSFUL"), row("p_ref", 20, "REFUNDED")];
    installServer({ detail: { paidAmount: 60, remaining: 40, payments } });
    render(<PipelineHarness invoice={invoiceWith(payments)} />);
    await openModal();

    await waitFor(() => expect(summaryFigure("Already paid")).toMatch(/\b60\.00\b/));
    expect(summaryFigure("Remaining")).toMatch(/\b40\.00\b/);
  });
});

describe("R0-21 payment-record-modal: overpayment is confirmed explicitly (M29)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-r021");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("an amount above the remaining balance shows a confirm and records nothing until it is accepted", async () => {
    const payments = [row("p_ok", 30, "SUCCESSFUL")];
    const server = installServer({ detail: { paidAmount: 30, remaining: 70, payments } });
    render(<PipelineHarness invoice={invoiceWith(payments)} />);
    await openModal();
    await waitFor(() => expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/));

    fireEvent.change(amountInput(), { target: { value: "100" } });
    fireEvent.click(recordButton());

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toMatch(/over-?payment/i);
    expect(confirm.textContent).toMatch(/30\.00/); // the excess
    expect(confirm.textContent).toMatch(/70\.00/); // what is actually owed
    expect(server.posts()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /record over-?payment/i }));
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    expect(server.posts()[0]!.body).toMatchObject({ amount: 100 });
  });

  it("declining the confirm records nothing and keeps the form open", async () => {
    const payments = [row("p_ok", 30, "SUCCESSFUL")];
    const server = installServer({ detail: { paidAmount: 30, remaining: 70, payments } });
    render(<PipelineHarness invoice={invoiceWith(payments)} />);
    await openModal();
    await waitFor(() => expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/));

    fireEvent.change(amountInput(), { target: { value: "75" } });
    fireEvent.click(recordButton());
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: /change amount/i }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("Already paid")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(server.posts()).toHaveLength(0);
  });

  it("an amount within the remaining balance records directly, with no confirm", async () => {
    const payments = [row("p_ok", 30, "SUCCESSFUL")];
    const server = installServer({ detail: { paidAmount: 30, remaining: 70, payments } });
    render(<PipelineHarness invoice={invoiceWith(payments)} />);
    await openModal();
    await waitFor(() => expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/));

    fireEvent.change(amountInput(), { target: { value: "70" } });
    fireEvent.click(recordButton());
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("R0-21 payment-record-modal: one idempotency key per open, single submit (M26, CF-08)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-r021");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("each open gets one crypto.randomUUID key, a retry reuses it, the next open gets a new one", async () => {
    const uuids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
    let n = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => uuids[Math.min(n++, uuids.length - 1)] as `${string}-${string}-${string}-${string}-${string}`,
    );
    const payments = [row("p_ok", 30, "SUCCESSFUL")];
    const server = installServer({
      detail: { paidAmount: 30, remaining: 70, payments },
      post: [
        // The first submit's response is lost (a gateway error); the operator retries.
        async () => jsonResponse(502, { message: "Bad gateway" }),
        async () => jsonResponse(201, okRecord(20)),
        async () => jsonResponse(201, okRecord(10)),
      ],
    });
    render(<PipelineHarness invoice={invoiceWith(payments)} />);

    await openModal();
    await waitFor(() => expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/));
    fireEvent.change(amountInput(), { target: { value: "20" } });
    fireEvent.click(recordButton());
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    // The failure keeps the form open; the retry is the same attempt.
    await waitFor(() => expect(recordButton()).not.toBeDisabled());
    fireEvent.click(recordButton());
    await waitFor(() => expect(server.posts()).toHaveLength(2));
    // Success closes the modal.
    await waitFor(() => expect(screen.queryByText("Already paid")).toBeNull());

    const [first, retry] = server.posts();
    expect(typeof first!.body?.idempotencyKey).toBe("string");
    expect(first!.body?.idempotencyKey).toBe(uuids[0]);
    expect(retry!.body?.idempotencyKey).toBe(first!.body?.idempotencyKey);

    // A new open is a new payment attempt.
    await openModal();
    await waitFor(() => expect(summaryFigure("Remaining")).toMatch(/\d\.\d\d/));
    fireEvent.change(amountInput(), { target: { value: "10" } });
    fireEvent.click(recordButton());
    await waitFor(() => expect(server.posts()).toHaveLength(3));
    const third = server.posts()[2]!;
    expect(typeof third.body?.idempotencyKey).toBe("string");
    expect(third.body?.idempotencyKey).not.toBe(first!.body?.idempotencyKey);
  });

  it("a double click on Record Payment gives one POST", async () => {
    const payments = [row("p_ok", 30, "SUCCESSFUL")];
    let release: (r: Response) => void = () => {};
    const server = installServer({
      detail: { paidAmount: 30, remaining: 70, payments },
      post: [() => new Promise<Response>((resolve) => { release = resolve; })],
    });
    render(<PipelineHarness invoice={invoiceWith(payments)} />);
    await openModal();
    await waitFor(() => expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/));
    fireEvent.change(amountInput(), { target: { value: "20" } });

    // Both clicks land before React re-renders the disabled button.
    const button = recordButton();
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(server.posts().length).toBeGreaterThanOrEqual(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(server.posts()).toHaveLength(1);

    await act(async () => { release(jsonResponse(201, okRecord(20))); });
    await waitFor(() => expect(screen.queryByText("Already paid")).toBeNull());
    expect(server.posts()).toHaveLength(1);
  });
});

/**
 * Review R021-ST-1 / CR-R021-1: the server keys on the client key whenever one
 * is sent and then skips its reference + amount slot, so a key per open made
 * one slip entered in two opens two payments. A submit with a reference sends
 * no key (the server's R0-D2 reference slot absorbs the second entry); a
 * blank-reference submit keeps the open's key.
 */
describe("R0-21 review: payment-record-modal leaves the reference slot to the server", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-r021");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const referenceInput = () => screen.getByPlaceholderText("Transaction ID, check number...") as HTMLInputElement;

  it("the same slip entered in two opens (lost response, Cancel, reopen) is sent with its reference and no key both times", async () => {
    const payments = [row("p_ok", 30, "SUCCESSFUL")];
    const server = installServer({
      detail: { paidAmount: 30, remaining: 70, payments },
      post: [async () => jsonResponse(502, { message: "Bad gateway" }), async () => jsonResponse(201, okRecord(40))],
    });
    render(<PipelineHarness invoice={invoiceWith(payments)} />);

    await openModal();
    await waitFor(() => expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/));
    fireEvent.change(amountInput(), { target: { value: "40" } });
    fireEvent.change(referenceInput(), { target: { value: "SLIP-77" } });
    fireEvent.click(recordButton());
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    await waitFor(() => expect(recordButton()).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    await waitFor(() => expect(screen.queryByText("Already paid")).toBeNull());

    await openModal();
    await waitFor(() => expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/));
    fireEvent.change(amountInput(), { target: { value: "40" } });
    fireEvent.change(referenceInput(), { target: { value: "SLIP-77" } });
    fireEvent.click(recordButton());
    await waitFor(() => expect(server.posts()).toHaveLength(2));

    for (const post of server.posts()) {
      expect(post.body).toMatchObject({ amount: 40, reference: "SLIP-77" });
      expect(post.body).not.toHaveProperty("idempotencyKey");
    }
  });

  it("a blank-reference submit keeps the open's key on its retry, even after a reference is added", async () => {
    const payments = [row("p_ok", 30, "SUCCESSFUL")];
    const server = installServer({
      detail: { paidAmount: 30, remaining: 70, payments },
      post: [async () => jsonResponse(502, { message: "Bad gateway" }), async () => jsonResponse(201, okRecord(20))],
    });
    render(<PipelineHarness invoice={invoiceWith(payments)} />);

    await openModal();
    await waitFor(() => expect(summaryFigure("Remaining")).toMatch(/\b70\.00\b/));
    fireEvent.change(amountInput(), { target: { value: "20" } });
    fireEvent.click(recordButton());
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    await waitFor(() => expect(recordButton()).not.toBeDisabled());
    fireEvent.change(referenceInput(), { target: { value: "SLIP-9" } });
    fireEvent.click(recordButton());
    await waitFor(() => expect(server.posts()).toHaveLength(2));

    const [first, retry] = server.posts();
    expect(typeof first!.body?.idempotencyKey).toBe("string");
    expect(retry!.body).toMatchObject({ reference: "SLIP-9", idempotencyKey: first!.body?.idempotencyKey });
  });
});
