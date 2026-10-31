/**
 * V1-48-PUBLIC-TOKEN-VIEW — the customer's public invoice page
 * (/public/invoice/[token]).
 *
 * WHY this test exists (CF-18): the page printed a status badge and the
 * invoice total as "Amount due", whatever had been paid. A customer who had
 * paid 100 of 250 was shown 250 due, with nothing to say 100 had arrived. The
 * token route now carries a `balance` block computed on the server from the
 * invoice's own Payment rows (computeBalance); this page must render Paid and
 * Remaining from that block, never from its own arithmetic over the line
 * items.
 *
 * The page is mounted on the real client (lib/client.ts
 * getPublicInvoiceByToken -> apiGet); only `fetch` and the Next router hooks
 * are stubbed, so the payload under test reaches the page exactly as apiGet
 * hands it over. The items in every fixture deliberately sum to something
 * other than the total and the figures, so a page that adds up items cannot
 * pass.
 *
 * Bank-transfer instructions: D-07 (ruled 2026-10-31) puts the link and the
 * receipt into Release 0 and approves no opt-in instructions block, so the page
 * shows none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import PublicInvoicePage from "../[token]/page";

const TOKEN = "Zk3v8yX2Qp0wLr7mNc4tHb6sJd1aUe9f";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => `/public/invoice/${TOKEN}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ token: TOKEN }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

/** Same formatter as the page, so the expectations do not depend on the runtime's ICU data. */
function money(amount: number, currency = "TTD") {
  try {
    return new Intl.NumberFormat("en-TT", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_1",
    invoiceNumber: "INV-0042",
    status: "PARTIALLY_PAID",
    total: 250,
    currency: "TTD",
    issueDate: "2026-10-01T00:00:00.000Z",
    dueDate: "2026-11-15T00:00:00.000Z",
    notes: null,
    // 3 x 111 = 333: neither the total nor any balance figure.
    items: [{ description: "Consulting", quantity: 3, unitPrice: 111, total: 333 }],
    contact: { firstName: "Ada", lastName: "Customer" },
    business: { name: "Harbour Studio", logoUrl: null, primaryColor: "#F97316", email: "hello@harbour.example", phone: null },
    ...overrides,
  };
}

/** Answer the token read with `body`; record every requested path. */
function stubTokenRead(body: unknown, status = 200) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    requested.push(pathname);
    if (pathname.endsWith(`/commerce/public/invoice-link/${TOKEN}`)) return jsonResponse(status, body);
    return jsonResponse(404, { message: "Not Found" }, "Not Found");
  });
  vi.stubGlobal("fetch", fetchMock);
  return requested;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CF-18: Paid and Remaining come from the payload (V1-48)", () => {
  it("W-01: 100 paid of 250 shows Paid 100 and Remaining 150 from balance, and Amount due is the remaining, not the total", async () => {
    const requested = stubTokenRead({
      ok: true,
      token: TOKEN,
      invoice: invoice(),
      balance: { amountPaid: 100, amountDue: 150, paidAt: null },
    });
    render(<PublicInvoicePage />);

    expect(await screen.findByTestId("public-invoice-paid")).toHaveTextContent(money(100));
    expect(screen.getByTestId("public-invoice-remaining")).toHaveTextContent(money(150));
    expect(screen.getByTestId("public-invoice-total")).toHaveTextContent(money(250));
    expect(screen.getByTestId("public-invoice-amount-due")).toHaveTextContent(money(150));
    expect(screen.getByTestId("public-invoice-amount-due")).not.toHaveTextContent(money(250));
    expect(screen.queryByTestId("public-invoice-paid-at")).toBeNull();
    // The pay button stays for a balance still owed.
    expect(screen.getByRole("button", { name: /pay this invoice/i })).toBeInTheDocument();
    expect(requested.some((p) => p.endsWith(`/commerce/public/invoice-link/${TOKEN}`))).toBe(true);
  });

  it("W-02: a PAID invoice shows Remaining 0 and the date it was paid; no pay button", async () => {
    stubTokenRead({
      ok: true,
      token: TOKEN,
      invoice: invoice({ status: "PAID" }),
      balance: { amountPaid: 250, amountDue: 0, paidAt: "2026-10-20T15:30:00.000Z" },
    });
    render(<PublicInvoicePage />);

    expect(await screen.findByTestId("public-invoice-remaining")).toHaveTextContent(money(0));
    expect(screen.getByTestId("public-invoice-paid")).toHaveTextContent(money(250));
    const paidAt = screen.getByTestId("public-invoice-paid-at");
    expect(paidAt).toHaveTextContent(new Date("2026-10-20T15:30:00.000Z").toLocaleDateString("en-TT", { dateStyle: "medium" }));
    expect(screen.getByText(/paid in full/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay this invoice/i })).toBeNull();
  });

  it("W-03: the figures are the payload's even when they disagree with the line items and the total (no client arithmetic)", async () => {
    stubTokenRead({
      ok: true,
      token: TOKEN,
      // V1-29 characterization shape: the server's remaining can exceed total - paid.
      invoice: invoice(),
      balance: { amountPaid: 100, amountDue: 210, paidAt: null },
    });
    render(<PublicInvoicePage />);

    expect(await screen.findByTestId("public-invoice-remaining")).toHaveTextContent(money(210));
    expect(screen.getByTestId("public-invoice-paid")).toHaveTextContent(money(100));
    expect(screen.queryByText(money(150))).toBeNull();
  });
});

describe("controls (V1-48)", () => {
  it("W-04: an invalid or expired link shows the neutral unavailable message and no figures", async () => {
    stubTokenRead({ ok: false, reason: "invalid_or_expired" });
    render(<PublicInvoicePage />);

    expect(await screen.findByText(/this invoice link is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/expired or is invalid/i)).toBeInTheDocument();
    expect(screen.queryByTestId("public-invoice-paid")).toBeNull();
    expect(screen.queryByTestId("public-invoice-remaining")).toBeNull();
  });

  it("W-05: no bank-transfer instructions are rendered (D-07 approved no opt-in block)", async () => {
    stubTokenRead({
      ok: true,
      token: TOKEN,
      invoice: invoice(),
      balance: { amountPaid: 100, amountDue: 150, paidAt: null },
    });
    const { container } = render(<PublicInvoicePage />);

    await screen.findByTestId("public-invoice-remaining");
    expect(container.textContent ?? "").not.toMatch(/bank transfer|account number|routing|iban|swift/i);
  });

  it("W-06: an older payload without a balance block shows the total as the amount due and invents no Paid or Remaining figure", async () => {
    stubTokenRead({ ok: true, token: TOKEN, invoice: invoice({ status: "SENT" }) });
    render(<PublicInvoicePage />);

    expect(await screen.findByTestId("public-invoice-amount-due")).toHaveTextContent(money(250));
    expect(screen.queryByTestId("public-invoice-paid")).toBeNull();
    expect(screen.queryByTestId("public-invoice-remaining")).toBeNull();
  });
});

/** Answer the token read with `view` and the receipt read with `receiptBody`; record every requested path. */
function stubTokenAndReceipt(view: unknown, receiptBody: unknown, receiptStatus = 200) {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      requested.push(pathname);
      if (pathname.endsWith(`/commerce/public/invoice-link/${TOKEN}/receipt`)) return jsonResponse(receiptStatus, receiptBody);
      if (pathname.endsWith(`/commerce/public/invoice-link/${TOKEN}`)) return jsonResponse(200, view);
      return jsonResponse(404, { message: "Not Found" }, "Not Found");
    }),
  );
  return requested;
}

describe("the receipt button follows the received amount, not the status (V1-49 review CR-V49-1)", () => {
  it("W-07: a part-paid invoice moved to OVERDUE (100 of 250 received) offers the receipt, and shows Received / Remaining as served", async () => {
    const requested = stubTokenAndReceipt(
      { ok: true, token: TOKEN, invoice: invoice({ status: "OVERDUE" }), balance: { amountPaid: 100, amountDue: 150, paidAt: null } },
      { invoiceNumber: "INV-0042", status: "OVERDUE", currency: "TTD", total: 250, amountPaid: 100, amountDue: 150, paidAt: null, issuedAt: null },
    );
    render(<PublicInvoicePage />);

    fireEvent.click(await screen.findByTestId("public-invoice-receipt-button"));
    expect(await screen.findByTestId("public-receipt-paid")).toHaveTextContent(money(100));
    expect(screen.getByTestId("public-receipt-remaining")).toHaveTextContent(money(150));
    expect(requested.some((p) => p.endsWith(`/commerce/public/invoice-link/${TOKEN}/receipt`))).toBe(true);
  });

  it("W-08: nothing received offers no receipt: a SENT invoice with 0 paid, and a PAID invoice whose payment was refunded (paid 0)", async () => {
    for (const status of ["SENT", "PAID"]) {
      const requested = stubTokenAndReceipt(
        { ok: true, token: TOKEN, invoice: invoice({ status }), balance: { amountPaid: 0, amountDue: status === "PAID" ? 500 : 250, paidAt: null } },
        { message: "No receipt is available for this invoice" },
        409,
      );
      render(<PublicInvoicePage />);

      await screen.findByTestId("public-invoice-remaining");
      expect(screen.queryByTestId("public-invoice-receipt-button"), status).toBeNull();
      expect(requested.some((p) => p.endsWith("/receipt")), status).toBe(false);
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("W-09 control: an older payload without a balance block keeps the status rule (PAID offers the receipt)", async () => {
    stubTokenAndReceipt(
      { ok: true, token: TOKEN, invoice: invoice({ status: "PAID" }) },
      { invoiceNumber: "INV-0042", status: "PAID", currency: "TTD", total: 250, amountPaid: 250, amountDue: 0, paidAt: null },
    );
    render(<PublicInvoicePage />);

    expect(await screen.findByTestId("public-invoice-receipt-button")).toBeInTheDocument();
  });
});
