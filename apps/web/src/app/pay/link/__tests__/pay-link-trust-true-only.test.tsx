/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 1 (acceptance reviews at bed0f8f, MAJOR-1): the customer pay page makes no
 * security claim the product does not verify. No "Fast & secure checkout" under Google Pay and no "Secure payment
 * processing" under the Pay button.
 *
 * The page is mounted with the real lib/api.ts and lib/client.ts clients; only `fetch`, the Next router hooks and the
 * browser's PaymentRequest (so the Google Pay tile shows) are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import PaymentLinkPage from "../[token]/page";

const TOKEN = "tb31wabcdefghij0123456789";
const PAY_PATH = `/commerce/public/invoice-link/${TOKEN}/pay`;

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

const VIEW = {
  businessId: "biz_tb31", invoiceNumber: "INV-3101", status: "SENT", total: 100, remaining: 100, currency: "TTD",
  subtotal: 100, taxRate: 0, taxAmount: 0, discountType: null, discountValue: null, discountAmount: 0, notes: null,
  issueDate: "2026-10-01T00:00:00.000Z", dueDate: null, paidAt: null,
  items: [{ id: "it1", description: "Consulting", quantity: 1, unitPrice: 100, total: 100 }],
  contact: { firstName: "Ada", lastName: "Customer" },
  business: { name: "Harbour Studio", logoUrl: null, primaryColor: "#F97316", secondaryColor: null },
};

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* storage unavailable */ }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if (pathname.endsWith(PAY_PATH)) return jsonResponse(200, VIEW);
    if (pathname.endsWith("/gateways")) return jsonResponse(200, [{ id: "wipay", name: "WiPay", currencies: ["TTD"] }]);
    return jsonResponse(404, { statusCode: 404, message: "Not Found" });
  }));
  vi.stubGlobal("PaymentRequest", class { canMakePayment() { return Promise.resolve(true); } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

describe("the customer pay page", () => {
  it("says no 'Fast & secure checkout' and no 'Secure payment processing'", async () => {
    render(<PaymentLinkPage />);
    expect(await screen.findByText("Google Pay")).toBeTruthy(); // the Google Pay tile is offered
    expect(text()).toContain("INV-3101");
    expect(text()).not.toMatch(/Fast & secure checkout/i);
    expect(text()).not.toMatch(/Secure payment processing/i);
  });
});
