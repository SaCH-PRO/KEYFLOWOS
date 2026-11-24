/**
 * SWP-INV-PUBLIC-LINK, review round 1 (correctness MAJOR-1; journey E13's second leg, BUG-087): the pay page of a
 * voided invoice's live link says the invoice was voided.
 *
 * The pay read (GET .../invoice-link/:token/pay) answers 404 for a VOID invoice, and Release 0 pins that (TG-07), so
 * it stays. On a 404 the page now asks the token view (GET .../invoice-link/:token), which answers
 * { ok: false, reason: 'voided' } only for a live link of a VOID invoice, and says so: no "Try again", no Pay
 * button. Any other answer keeps the link-error message.
 *
 *   PV-01  RED-BEFORE  a 404 pay read and a 'voided' view: the page says the invoice has been voided; no Pay, no
 *                      Try again
 *   PV-02  control     a 404 pay read and the neutral view: the link-error message, as before
 *   PV-03  control     a live pay read never asks the view
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import PaymentLinkPage from "../[token]/page";

const TOKEN = "vd46wabcdefghij0123456789";
const VIEW_PATH = `/commerce/public/invoice-link/${TOKEN}`;
const PAY_PATH = `${VIEW_PATH}/pay`;
const LINK_ERROR = /this payment link is invalid, has expired or has been deactivated/i;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/pay/link/${TOKEN}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ token: TOKEN }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status, statusText: status === 404 ? "Not Found" : "OK",
    json: async () => JSON.parse(text) as unknown, text: async () => text,
  } as unknown as Response;
}

const GONE = { statusCode: 404, message: "Invoice not found" };

function stub(pay: [number, unknown], viewBody: unknown) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    requested.push(pathname);
    if (pathname.endsWith(PAY_PATH)) return jsonResponse(pay[0], pay[1]);
    if (pathname.endsWith(VIEW_PATH)) return jsonResponse(200, viewBody);
    if (pathname.endsWith("/gateways")) return jsonResponse(200, []);
    return jsonResponse(404, { statusCode: 404, message: "Not Found" });
  }));
  return requested;
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* storage unavailable */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SWP-INV-PUBLIC-LINK: the pay page of a voided invoice", () => {
  it("PV-01 RED-BEFORE: a 404 pay read and a 'voided' view: the page says the invoice has been voided, with nothing to press", async () => {
    stub([404, GONE], { ok: false, reason: "voided" });
    render(<PaymentLinkPage />);
    expect((await screen.findAllByText(/has been voided/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(LINK_ERROR)).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^pay|try again/i })).toEqual([]);
  });

  it("PV-02 control: a 404 pay read and the neutral view keep the link-error message", async () => {
    stub([404, GONE], { ok: false, reason: "invalid_or_expired" });
    render(<PaymentLinkPage />);
    expect(await screen.findByText(LINK_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(/has been voided/i)).toBeNull();
  });

  it("PV-03 control: a live pay read never asks the token view", async () => {
    const requested = stub([200, {
      businessId: "biz_vd", invoiceNumber: "INV-9", status: "SENT", total: 100, remaining: 100, currency: "TTD",
      subtotal: 100, taxRate: 0, taxAmount: 0, discountType: null, discountValue: null, discountAmount: 0, notes: null,
      issueDate: "2026-11-01T00:00:00.000Z", dueDate: null, paidAt: null,
      items: [{ id: "i1", description: "Consulting", quantity: 1, unitPrice: 100, total: 100 }],
      contact: { firstName: "Ada", lastName: "Customer" },
      business: { name: "Harbour Studio", logoUrl: null, primaryColor: "#F97316", secondaryColor: null },
    }], { ok: false, reason: "voided" });
    render(<PaymentLinkPage />);
    expect((await screen.findAllByText(/INV-9/)).length).toBeGreaterThan(0);
    expect(requested.filter((p) => p.endsWith(VIEW_PATH))).toEqual([]);
  });
});
