/**
 * V1-51-QUOTE-CONVERSION-JOURNEY: the Convert-to-Invoice forms start from the
 * accepted quote (M20, IV-P08).
 *
 * At the packet base the finance pipeline's QuoteConvertModal seeded its tax
 * field with `useState("12.5")` whatever the quote said (and, mounted once by
 * finance-pipeline.tsx with `quote={actions.convertModalFor}`, it never
 * re-seeded for the next quote), showed no discount, and usePipelineActions
 * sent that 12.5 as an explicit taxRate. A 0%-tax quote was invoiced at 12.5%;
 * the quotes panel fell back to 12.5 for a quote without a stored rate, and
 * dropped a cleared discount (undefined) so the server could not tell "no
 * discount" from "not given".
 *
 * Contract pinned here:
 *   - the modal prefills the tax rate and the discount from the quote it is
 *     opened for, and re-seeds when it is opened for another quote;
 *   - the discount is the quote's and is shown read-only: the finance
 *     pipeline's convert handler (use-pipeline-actions.ts) forwards only tax,
 *     due date and notes, and the server carries the quote's discount when the
 *     body names none, so an editable field there would be silently dropped;
 *   - mounted the way finance-pipeline.tsx mounts it (real usePipelineActions,
 *     real client, fetch stubbed at the network edge), Convert POSTs the
 *     quote's own tax rate and no discount;
 *   - quoteConvertDefaults / quoteConvertRequest (the quotes panel's form) seed
 *     from the quote (0 when it has no rate, never 12.5) and send a cleared
 *     discount as an explicit 0.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import * as modalModule from "../quote-convert-modal";
import { QuoteConvertModal } from "../quote-convert-modal";
import { usePipelineActions } from "../../hooks/use-pipeline-actions";
import type { Invoice, Quote } from "@/lib/client";

const BIZ = "biz_v51";

function quote(id: string, fields: Partial<Quote>): Quote {
  return {
    id,
    quoteNumber: `QT-${id}`,
    status: "ACCEPTED",
    subtotal: 100,
    total: 100,
    currency: "TTD",
    issueDate: "2026-11-01T10:00:00.000Z",
    businessId: BIZ,
    contactId: "ct_v51",
    items: [],
    createdAt: "2026-11-01T10:00:00.000Z",
    ...fields,
  };
}

const ZERO_TAX_PCT10 = quote("q_zero", { taxRate: 0, discountType: "PERCENT", discountValue: 10, total: 90 });
const TAX15_FIXED25 = quote("q_fixed", { taxRate: 15, taxAmount: 15, discountType: "FIXED", discountValue: 25, total: 90 });
const NO_RATE = quote("q_norate", { taxRate: null, discountType: null, discountValue: null });

/** The modal's first number input is the tax rate (before and after this packet). */
function taxInput(): HTMLInputElement {
  const input = document.querySelector('input[type="number"]');
  expect(input, "tax rate input").not.toBeNull();
  return input as HTMLInputElement;
}

function discountType(): HTMLSelectElement {
  return screen.getByLabelText("Discount type") as HTMLSelectElement;
}

function discountValue(): HTMLInputElement {
  return screen.getByLabelText("Discount value") as HTMLInputElement;
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

type Call = { method: string; path: string; body: Record<string, unknown> | null };

function installServer() {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    if (method === "POST" && url.pathname.endsWith("/convert")) {
      const invoice: Invoice = { id: "inv_v51", invoiceNumber: "INV-V51", status: "DRAFT", total: 90, currency: "TTD" } as Invoice;
      return jsonResponse(201, invoice);
    }
    return jsonResponse(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { converts: () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/convert")) };
}

/** finance-pipeline.tsx:512-518, verbatim wiring: the modal stays mounted and follows convertModalFor. */
function PipelineHarness({ quotes: initial }: { quotes: Quote[] }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>(initial);
  const actions = usePipelineActions({ businessId: BIZ, invoices, quotes, setInvoices, setQuotes });
  return (
    <>
      {quotes.map((q) => (
        <button key={q.id} type="button" onClick={() => actions.setConvertModalFor(q)}>{`open-${q.id}`}</button>
      ))}
      <button type="button" onClick={() => actions.setConvertModalFor(null)}>close-modal</button>
      <QuoteConvertModal
        quote={actions.convertModalFor}
        onClose={() => actions.setConvertModalFor(null)}
        onSubmit={(q, form) => actions.handleConvertQuote(q, form)}
        loading={actions.convertModalFor ? actions.actionLoading[`convert-${actions.convertModalFor.id}`] : false}
      />
    </>
  );
}

describe("V1-51 quote-convert-modal: prefilled from the quote (M20)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a 0% tax quote opens with tax 0, not the hard-coded 12.5", () => {
    render(<QuoteConvertModal quote={ZERO_TAX_PCT10} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(taxInput().value).toBe("0");
  });

  it("prefills the quote's tax rate and its PERCENT discount; the discount is the quote's and read-only", () => {
    render(<QuoteConvertModal quote={ZERO_TAX_PCT10} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(discountType().value).toBe("PERCENT");
    expect(discountValue().value).toBe("10");
    expect(discountType().disabled).toBe(true);
    expect(discountValue().readOnly).toBe(true);
  });

  it("prefills a 15% tax rate and a FIXED 25 discount", () => {
    render(<QuoteConvertModal quote={TAX15_FIXED25} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(taxInput().value).toBe("15");
    expect(discountType().value).toBe("FIXED");
    expect(discountValue().value).toBe("25");
  });

  it("a quote with no stored rate or discount opens with tax 0 and no discount", () => {
    render(<QuoteConvertModal quote={NO_RATE} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(taxInput().value).toBe("0");
    expect(discountValue().value).toBe("");
  });

  it("submits the prefilled values (an edited tax rate is passed on as typed)", () => {
    const onSubmit = vi.fn();
    render(<QuoteConvertModal quote={TAX15_FIXED25} onClose={() => undefined} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toBe(TAX15_FIXED25);
    expect(onSubmit.mock.calls[0]![1]).toMatchObject({ taxRate: "15", discountType: "FIXED", discountValue: "25", dueDate: "", notes: "" });

    fireEvent.change(taxInput(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    expect(onSubmit.mock.calls[1]![1]).toMatchObject({ taxRate: "5" });
  });

  it("mounted as finance-pipeline.tsx mounts it, it re-seeds for each quote it is opened for", async () => {
    installServer();
    render(<PipelineHarness quotes={[TAX15_FIXED25, ZERO_TAX_PCT10]} />);
    fireEvent.click(screen.getByText("open-q_fixed"));
    await screen.findByText("Convert to Invoice");
    expect(taxInput().value).toBe("15");
    fireEvent.change(taxInput(), { target: { value: "7" } });

    fireEvent.click(screen.getByText("close-modal"));
    fireEvent.click(screen.getByText("open-q_zero"));
    await screen.findByText("Convert to Invoice");
    expect(taxInput().value).toBe("0");
    expect(discountValue().value).toBe("10");
  });

  it("through the real usePipelineActions and client, Convert POSTs the quote's own tax rate (0) and no discount, so the server carries the quote's discount", async () => {
    const server = installServer();
    render(<PipelineHarness quotes={[ZERO_TAX_PCT10]} />);
    fireEvent.click(screen.getByText("open-q_zero"));
    await screen.findByText("Convert to Invoice");
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(server.converts()).toHaveLength(1));
    const call = server.converts()[0]!;
    expect(call.path).toBe(`/commerce/businesses/${BIZ}/quotes/q_zero/convert`);
    expect(call.body?.taxRate).toBe(0);
    expect(call.body).not.toHaveProperty("discountType");
    expect(call.body).not.toHaveProperty("discountValue");
  });
});

describe("V1-51 quotes-panel convert form helpers (M20)", () => {
  it("quoteConvertDefaults seeds from the quote: its rate (0 when none, never 12.5), its discount, its notes", () => {
    const defaults = (modalModule as Record<string, unknown>).quoteConvertDefaults as ((q: Quote) => Record<string, string>) | undefined;
    expect(typeof defaults, "quoteConvertDefaults is exported").toBe("function");
    expect(defaults!(NO_RATE)).toEqual({ taxRate: "0", discountType: "PERCENT", discountValue: "", notes: "", dueDate: "" });
    expect(defaults!(TAX15_FIXED25)).toEqual({ taxRate: "15", discountType: "FIXED", discountValue: "25", notes: "", dueDate: "" });
    expect(defaults!({ ...ZERO_TAX_PCT10, notes: "Net 30" })).toEqual({ taxRate: "0", discountType: "PERCENT", discountValue: "10", notes: "Net 30", dueDate: "" });
    // A discount stored without a type is a percentage, as the server computed the quote.
    expect(defaults!(quote("q_untyped", { taxRate: 12.5, discountType: null, discountValue: 5 }))).toMatchObject({ discountType: "PERCENT", discountValue: "5" });
  });

  it("quoteConvertRequest sends the form's tax and discount explicitly; a cleared discount is 0, so the server does not carry the quote's", () => {
    const toRequest = (modalModule as Record<string, unknown>).quoteConvertRequest as
      | ((form: Record<string, string>) => Record<string, unknown>)
      | undefined;
    expect(typeof toRequest, "quoteConvertRequest is exported").toBe("function");
    expect(toRequest!({ taxRate: "12.5", discountType: "PERCENT", discountValue: "10", notes: "", dueDate: "" })).toEqual({
      taxRate: 12.5,
      discountType: "PERCENT",
      discountValue: 10,
      notes: undefined,
      dueDate: undefined,
    });
    expect(toRequest!({ taxRate: "", discountType: "FIXED", discountValue: "", notes: "Net 30", dueDate: "2026-12-01" })).toEqual({
      taxRate: 0,
      discountType: undefined,
      discountValue: 0,
      notes: "Net 30",
      dueDate: "2026-12-01",
    });
  });
});
