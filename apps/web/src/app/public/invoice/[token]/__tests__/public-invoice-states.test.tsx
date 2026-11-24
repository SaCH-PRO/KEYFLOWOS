/**
 * SWP-INV-PUBLIC-LINK (BUG-053, BUG-087, BUG-091): the customer's invoice page states what the invoice is.
 *
 * At the base the page (/public/invoice/[token]) showed:
 *   - for a voided invoice's link, "We couldn't find this invoice" (the server answered not_found);
 *   - only the total, never the subtotal, the discount or the tax, though the invoice carried them;
 *   - every amount with the bare "$" of the en-TT locale, so a TTD invoice and a USD one read alike;
 *   - the status as the raw enum (PARTIALLY_PAID).
 *
 * The server now answers { ok: false, reason: 'voided' } for a live link of a VOID invoice and adds a sibling
 * `totals` block { subtotal, taxRate, taxAmount, discountAmount, total, currency } beside the unchanged invoice
 * block (apps/server/test/public-invoice-link.integration.test.ts L-25..L-28). The page renders those figures as
 * given, with the currency code.
 *
 *   PS-01  RED-BEFORE  a voided link says the invoice was voided, and shows no figures
 *   PS-02  RED-BEFORE  journey D's invoice shows Subtotal TTD 1,040.00, Discount -TTD 104.00, Tax (12.5%) TTD 130.00
 *                      and Total TTD 1,066.00, from the totals block
 *   PS-03  RED-BEFORE  every amount carries the currency code: Amount due reads TTD 1,066.00, a USD invoice USD 80.00
 *   PS-04  RED-BEFORE  the status reads as words (Part paid, Overdue, Voided...), never the enum
 *   PS-05  RED-BEFORE  no tax and no discount: no Tax or Discount row, Subtotal and Total only
 *   PS-06  control     an older payload without totals shows no Subtotal, Tax or Discount row and invents none
 *   PS-07  control     an invalid or expired link keeps the neutral message
 *
 * Review round 1 (correctness MINOR-2, MINOR-3, MINOR-6):
 *   PS-04  now reads the shared status words (lib/status-labels: Part-paid, Part-credited), with customer words for
 *          the three states a customer acts on (SENT "Awaiting payment", PENDING "Payment pending", FAILED
 *          "Payment failed")
 *   PS-08  a breakdown that does not add up to the total (a legacy row: subtotal 1,040 at 12.5% with no stored tax,
 *          total 1,170; or a fee the breakdown has no row for) is not shown: the Total only
 *   PS-09  totals without a balance block still show the breakdown and the Total
 *   PS-10  a tax amount stored with no rate reads "Tax", not "Tax (0%)"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import PublicInvoicePage from "../page";

const TOKEN = "Pq9v8yX2Qp0wLr7mNc4tHb6sJd1aUe9f";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/public/invoice/${TOKEN}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ token: TOKEN }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, statusText: "OK", json: async () => JSON.parse(text) as unknown, text: async () => text } as unknown as Response;
}

function serve(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, body)));
}

/** Journey D's invoice: an 800 cake and 24 cupcakes at 10, 12.5% tax on 1,040, then 10% off. */
function payload(overrides: { invoice?: Record<string, unknown>; totals?: Record<string, unknown> | null; balance?: Record<string, unknown> } = {}) {
  const invoice = {
    id: "inv_d", invoiceNumber: "INV-0107", status: "SENT", total: 1066, currency: "TTD",
    issueDate: "2026-11-20T00:00:00.000Z", dueDate: "2026-12-04T00:00:00.000Z", notes: null,
    items: [
      { description: "Wedding cake, 3 tier", quantity: 1, unitPrice: 800, total: 800 },
      { description: "Cupcakes", quantity: 24, unitPrice: 10, total: 240 },
    ],
    contact: { firstName: "Kezia", lastName: "Baptiste" },
    business: { name: "Sugar & Spice Bakery", logoUrl: null, primaryColor: "#F97316", email: null, phone: null },
    ...overrides.invoice,
  };
  const totals = overrides.totals === null
    ? undefined
    : { subtotal: 1040, taxRate: 12.5, taxAmount: 130, discountAmount: 104, total: 1066, currency: invoice.currency, ...overrides.totals };
  return {
    ok: true, token: TOKEN, invoice,
    balance: { amountPaid: 0, amountDue: invoice.total, paidAt: null, ...overrides.balance },
    ...(totals ? { totals } : {}),
  };
}

/** The text of the row a label opens: the dt, a space, its dd; whitespace collapsed. */
function row(label: RegExp): string {
  const dt = screen.getByText(label, { selector: "dt" });
  const dd = dt.nextElementSibling;
  return `${dt.textContent ?? ""} ${dd?.textContent ?? ""}`.replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SWP-INV-PUBLIC-LINK: the customer's invoice page", () => {
  it("PS-01 RED-BEFORE: a voided link says the invoice was voided and shows no figures", async () => {
    serve({ ok: false, reason: "voided" });
    render(<PublicInvoicePage />);
    expect(await screen.findByText(/this invoice has been voided/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't find this invoice/i)).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\d+\.\d{2}/);
    expect(screen.queryByRole("button", { name: /pay this invoice/i })).toBeNull();
  });

  it("PS-02 RED-BEFORE: journey D's invoice shows Subtotal, Discount, Tax and Total from the totals block", async () => {
    serve(payload());
    render(<PublicInvoicePage />);
    expect(await screen.findByText(/^Subtotal$/, { selector: "dt" })).toBeInTheDocument();
    expect(row(/^Subtotal$/)).toBe("Subtotal TTD 1,040.00");
    expect(row(/^Discount$/)).toBe("Discount -TTD 104.00");
    expect(row(/^Tax/)).toBe("Tax (12.5%) TTD 130.00");
    expect(row(/^Total$/)).toBe("Total TTD 1,066.00");
  });

  it("PS-03 RED-BEFORE: every amount carries the currency code", async () => {
    serve(payload());
    render(<PublicInvoicePage />);
    const due = await screen.findByTestId("public-invoice-amount-due");
    expect((due.textContent ?? "").replace(/\s+/g, " ")).toBe("TTD 1,066.00");
    cleanup();
    vi.unstubAllGlobals();
    serve(payload({
      invoice: { currency: "USD", total: 80, items: [{ description: "Gift box", quantity: 1, unitPrice: 80, total: 80 }] },
      totals: { subtotal: 80, taxRate: 0, taxAmount: 0, discountAmount: 0, total: 80, currency: "USD" },
    }));
    render(<PublicInvoicePage />);
    const usd = await screen.findByTestId("public-invoice-amount-due");
    expect((usd.textContent ?? "").replace(/\s+/g, " ")).toBe("USD 80.00");
    expect(document.body.textContent ?? "").not.toMatch(/US\$|\$\s?\d/);
  });

  it("PS-04 RED-BEFORE: the status reads as words, never the enum", async () => {
    const cases: Array<[string, string]> = [
      ["SENT", "Awaiting payment"], ["OVERDUE", "Overdue"], ["PARTIALLY_PAID", "Part-paid"], ["PAID", "Paid"],
      ["PENDING", "Payment pending"], ["FAILED", "Payment failed"], ["PARTIALLY_CREDITED", "Part-credited"],
    ];
    for (const [status, label] of cases) {
      const paid = status === "PAID" ? 1066 : status === "PARTIALLY_PAID" ? 400 : 0;
      serve(payload({ invoice: { status }, balance: { amountPaid: paid, amountDue: 1066 - paid } }));
      render(<PublicInvoicePage />);
      // The badge; "Paid" is also the label of the Paid row (a dt), which does not count.
      const found = await screen.findAllByText(label, { exact: true });
      expect(found.filter((el) => el.tagName !== "DT"), status).toHaveLength(1);
      expect(screen.queryByText(status, { exact: true }), status).toBeNull();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("PS-05 RED-BEFORE: no tax and no discount shows Subtotal and Total only", async () => {
    serve(payload({
      invoice: { total: 1040 },
      totals: { subtotal: 1040, taxRate: 0, taxAmount: 0, discountAmount: 0, total: 1040 },
    }));
    render(<PublicInvoicePage />);
    expect(await screen.findByText(/^Subtotal$/, { selector: "dt" })).toBeInTheDocument();
    expect(screen.queryByText(/^Tax/, { selector: "dt" })).toBeNull();
    expect(screen.queryByText(/^Discount$/, { selector: "dt" })).toBeNull();
    expect(row(/^Total$/)).toBe("Total TTD 1,040.00");
  });

  it("PS-06 control: an older payload without totals shows no Subtotal, Tax or Discount row", async () => {
    serve(payload({ totals: null }));
    render(<PublicInvoicePage />);
    expect(await screen.findByTestId("public-invoice-total")).toBeInTheDocument();
    expect(screen.queryByText(/^Subtotal$/, { selector: "dt" })).toBeNull();
    expect(screen.queryByText(/^Tax/, { selector: "dt" })).toBeNull();
    expect(screen.queryByText(/^Discount$/, { selector: "dt" })).toBeNull();
  });

  it("PS-07 control: an invalid or expired link keeps the neutral message", async () => {
    serve({ ok: false, reason: "invalid_or_expired" });
    render(<PublicInvoicePage />);
    expect(await screen.findByText(/expired or is invalid/i)).toBeInTheDocument();
    expect(screen.queryByText(/voided/i)).toBeNull();
  });

  it("PS-08 (review MINOR-3): a breakdown that does not add up to the total is not shown; the Total is", async () => {
    // A legacy row: subtotal 1,040 at 12.5% with no tax stored, total 1,170.
    serve(payload({
      invoice: { total: 1170 },
      totals: { subtotal: 1040, taxRate: 12.5, taxAmount: 0, discountAmount: 0, total: 1170 },
    }));
    render(<PublicInvoicePage />);
    expect(await screen.findByTestId("public-invoice-total")).toBeInTheDocument();
    expect(row(/^Total$/)).toBe("Total TTD 1,170.00");
    expect(screen.queryByText(/^Subtotal$/, { selector: "dt" })).toBeNull();
    expect(screen.queryByText(/^Tax/, { selector: "dt" })).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    // A shipping fee the breakdown has no row for: 100 + 15 shipping = 115.
    serve(payload({
      invoice: { total: 115 },
      totals: { subtotal: 100, taxRate: 0, taxAmount: 0, discountAmount: 0, total: 115 },
    }));
    render(<PublicInvoicePage />);
    expect(await screen.findByTestId("public-invoice-total")).toBeInTheDocument();
    expect(screen.queryByText(/^Subtotal$/, { selector: "dt" })).toBeNull();
  });

  it("PS-09 (review MINOR-6): totals without a balance block still show the breakdown and the Total", async () => {
    const body = payload() as Record<string, unknown>;
    delete body.balance;
    serve(body);
    render(<PublicInvoicePage />);
    expect(await screen.findByText(/^Subtotal$/, { selector: "dt" })).toBeInTheDocument();
    expect(row(/^Total$/)).toBe("Total TTD 1,066.00");
    expect(screen.queryByText(/^Paid$/, { selector: "dt" })).toBeNull();
  });

  it("PS-10 (review MINOR-6): a tax amount stored with no rate reads Tax", async () => {
    serve(payload({
      invoice: { total: 110 },
      totals: { subtotal: 100, taxRate: 0, taxAmount: 10, discountAmount: 0, total: 110 },
    }));
    render(<PublicInvoicePage />);
    expect(await screen.findByText(/^Tax$/, { selector: "dt" })).toBeInTheDocument();
    expect(row(/^Tax$/)).toBe("Tax TTD 10.00");
  });
});
