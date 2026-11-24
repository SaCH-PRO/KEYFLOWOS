/**
 * SWP-QUOTE-PUBLIC-PAGE (BUG-046; journey D4): the customer's quote page shows who it is from and how the total is
 * made.
 *
 * At the base the page (/quote/[token]) printed the quote number, the lines and the total only, although the public
 * quote payload carries the business block (name, logoUrl) and the quote's stored subtotal, taxRate, taxAmount and
 * discountAmount (CommerceService.getQuoteByToken). Every amount used the visitor's locale symbol ("$").
 *
 * The page now lays its figures out as the invoice public page does (SWP-INV-PUBLIC-LINK): the business's name and
 * logo, Subtotal, Discount, Tax (rate) and Total rows from the stored figures, each amount with the currency code.
 * A breakdown that does not add up to the stored total (a legacy row) shows the Total only.
 *
 *   PQT-01  RED-BEFORE  the business's name and logo head the page
 *   PQT-02  RED-BEFORE  journey D's quote: Subtotal TTD 1,040.00, Discount -TTD 104.00, Tax (12.5%) TTD 130.00,
 *                       Total TTD 1,066.00, from the stored figures (no client arithmetic)
 *   PQT-03  RED-BEFORE  every amount carries the currency code: the lines and the total ("TTD 800.00", "USD 80.00")
 *   PQT-04  RED-BEFORE  no tax and no discount: Subtotal and Total rows, no Tax or Discount row
 *   PQT-05  control     a breakdown that does not add up to the total shows the Total only
 *   PQT-06  control     a payload without a business block shows no name row and still renders the quote
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useParams: () => ({ token: "tok_qpt" }) }));
vi.mock("@/app/_lib/PresenceTracker", () => ({ PresenceTracker: () => null }));
vi.mock("@/app/_lib/presence-sdk", () => ({ pickBusinessId: () => null }));

import PublicQuotePage from "../page";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status, statusText: status >= 400 ? "Error" : "OK",
    json: async () => JSON.parse(text) as unknown, text: async () => text,
  } as unknown as Response;
}

/** Journey D's quote: an 800 cake and 24 cupcakes at 10, 12.5% tax on 1,040, then 10% off: 1,066.00. */
function journeyDQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: "q_qpt", quoteNumber: "QT-0107", status: "SENT", lifecycleStep: "VIEWED", currency: "TTD",
    subtotal: 1040, taxRate: 12.5, taxAmount: 130, discountType: "PERCENT", discountValue: 10, discountAmount: 104,
    total: 1066, issueDate: "2026-11-20T10:00:00.000Z", expiryDate: "2026-12-20T10:00:00.000Z",
    businessId: "biz_qpt", contactId: "ct_qpt", termsVersion: "tv_qpt", createdAt: "2026-11-20T10:00:00.000Z",
    contact: { firstName: "Kezia", lastName: "Baptiste" },
    items: [
      { id: "i1", description: "Wedding cake, 3 tier", quantity: 1, unitPrice: 800, total: 800 },
      { id: "i2", description: "Cupcakes", quantity: 24, unitPrice: 10, total: 240 },
    ],
    business: { id: "biz_qpt", name: "Sugar & Spice Bakery", logoUrl: "https://cdn.example.test/logo.png", primaryColor: "#F97316" },
    ...overrides,
  };
}

function serve(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    if (url.pathname.endsWith("/commerce/public/quotes/tok_qpt")) return jsonResponse(200, body);
    return jsonResponse(404, { message: "not stubbed" });
  }));
}

/** The text of the row a label opens: the dt, a space, its dd; whitespace collapsed. */
function row(label: RegExp): string {
  const dt = screen.getByText(label, { selector: "dt" });
  const dd = dt.nextElementSibling;
  return `${dt.textContent ?? ""} ${dd?.textContent ?? ""}`.replace(/\s+/g, " ").trim();
}

const bodyText = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SWP-QUOTE-PUBLIC-PAGE: the customer's quote page", () => {
  it("PQT-01 RED-BEFORE: the business's name and logo head the page", async () => {
    serve(journeyDQuote());
    render(<PublicQuotePage />);
    expect(await screen.findByText("Sugar & Spice Bakery")).toBeInTheDocument();
    const logo = screen.getByRole("img", { name: "Sugar & Spice Bakery" }) as HTMLImageElement;
    expect(logo.getAttribute("src")).toBe("https://cdn.example.test/logo.png");
  });

  it("PQT-02 RED-BEFORE: journey D's quote shows Subtotal, Discount, Tax and Total from the stored figures", async () => {
    serve(journeyDQuote());
    render(<PublicQuotePage />);
    expect(await screen.findByText(/^Subtotal$/, { selector: "dt" })).toBeInTheDocument();
    expect(row(/^Subtotal$/)).toBe("Subtotal TTD 1,040.00");
    expect(row(/^Discount$/)).toBe("Discount -TTD 104.00");
    expect(row(/^Tax/)).toBe("Tax (12.5%) TTD 130.00");
    expect(row(/^Total$/)).toBe("Total TTD 1,066.00");
  });

  it("PQT-03 RED-BEFORE: every amount carries the currency code", async () => {
    serve(journeyDQuote());
    render(<PublicQuotePage />);
    await screen.findByText(/QT-0107/);
    expect(bodyText()).toContain("TTD 800.00");
    expect(bodyText()).toContain("24 × TTD 10.00");
    expect(bodyText()).not.toMatch(/\$\s?\d/);
    cleanup();
    vi.unstubAllGlobals();
    serve(journeyDQuote({
      currency: "USD", subtotal: 80, taxRate: 0, taxAmount: 0, discountAmount: 0, total: 80,
      items: [{ id: "i1", description: "Gift box", quantity: 1, unitPrice: 80, total: 80 }],
    }));
    render(<PublicQuotePage />);
    await screen.findByText(/QT-0107/);
    expect(bodyText()).toContain("USD 80.00");
    expect(bodyText()).not.toMatch(/US\$|\$\s?\d/);
  });

  it("PQT-04 RED-BEFORE: no tax and no discount shows Subtotal and Total, and no Tax or Discount row", async () => {
    serve(journeyDQuote({ taxRate: 0, taxAmount: 0, discountType: null, discountValue: 0, discountAmount: 0, total: 1040 }));
    render(<PublicQuotePage />);
    expect(await screen.findByText(/^Subtotal$/, { selector: "dt" })).toBeInTheDocument();
    expect(screen.queryByText(/^Tax/, { selector: "dt" })).toBeNull();
    expect(screen.queryByText(/^Discount$/, { selector: "dt" })).toBeNull();
    expect(row(/^Total$/)).toBe("Total TTD 1,040.00");
  });

  it("PQT-05 control: a breakdown that does not add up to the stored total shows the Total only", async () => {
    // A legacy row: subtotal stored as 0.
    serve(journeyDQuote({ subtotal: 0, taxAmount: 0, discountAmount: 0, total: 1066 }));
    render(<PublicQuotePage />);
    expect(await screen.findByText(/^Total$/)).toBeInTheDocument();
    expect(bodyText()).toContain("1,066.00");
    expect(screen.queryByText(/^Subtotal$/, { selector: "dt" })).toBeNull();
    expect(screen.queryByText(/^Tax/, { selector: "dt" })).toBeNull();
  });

  it("PQT-06 control: a payload without a business block still renders the quote", async () => {
    serve(journeyDQuote({ business: undefined }));
    render(<PublicQuotePage />);
    expect(await screen.findByText(/QT-0107/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(bodyText()).toContain("1,066.00");
  });
});
