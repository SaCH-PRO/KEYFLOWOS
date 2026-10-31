/**
 * V1-46-PUB-PAY-LINK-TOKEN-GATE — the customer pay page at /pay/link/[token].
 *
 * WHY this test exists (review CR-02): the provider return URL is the token
 * page itself. Paying a pre-V1-48 (cuid-shaped) link rotates its token
 * (invoice.paid -> InvoiceReceiptListener -> findAnyPaymentLink ->
 * reissueLink, ST-V48-1), so every read the page makes after the provider
 * sends the customer back answers 404. The page then told a customer who had
 * just paid "This payment link is invalid, has expired or has been
 * deactivated", or kept a stale unpaid view. It must show a neutral
 * received / submitted state instead, and only on a provider-success return:
 * a dead link opened any other way still gets the link error.
 *
 * It also pins, at unit level, what the Playwright cases in
 * e2e/public-flows.spec.ts check in a browser (CI runs no Playwright): the
 * page reads through GET /commerce/public/invoice-link/:token/pay only, never
 * the retired resolver or the bare-id read, and never navigates away.
 *
 * The page is mounted with the real lib/api.ts client; only `fetch` and the
 * Next router hooks are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import PaymentLinkPage from "../[token]/page";

const TOKEN = "cv46wabcdefghij0123456789";
const PAY_PATH = `/commerce/public/invoice-link/${TOKEN}/pay`;
const LINK_ERROR = /this payment link is invalid, has expired or has been deactivated/i;

let search = new URLSearchParams();
const replace = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/pay/link/${TOKEN}`,
  useSearchParams: () => search,
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

const GONE = { statusCode: 404, message: "Invoice not found" };

function view(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_v46w",
    businessId: "biz_v46w",
    invoiceNumber: "INV-4601",
    status: "SENT",
    total: 100,
    remaining: 100,
    currency: "TTD",
    subtotal: 100,
    taxRate: 0,
    taxAmount: 0,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    notes: null,
    issueDate: "2026-10-01T00:00:00.000Z",
    dueDate: null,
    paidAt: null,
    items: [{ id: "it1", description: "Consulting", quantity: 1, unitPrice: 100, total: 100 }],
    contact: { firstName: "Ada", lastName: "Customer" },
    business: { name: "Harbour Studio", logoUrl: null, primaryColor: "#F97316", secondaryColor: null },
    ...overrides,
  };
}

/**
 * `payReads` answers the token pay read in order (the last one repeats);
 * `wipay` answers the WiPay callback. Every requested path is recorded.
 */
function stubApi(payReads: Array<[number, unknown]>, wipay?: [number, unknown]) {
  const requested: string[] = [];
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      requested.push(pathname);
      if (pathname.endsWith(PAY_PATH)) {
        const [status, body] = payReads[Math.min(reads, payReads.length - 1)];
        reads += 1;
        return jsonResponse(status, body, status === 404 ? "Not Found" : "OK");
      }
      if (pathname.endsWith("/payments/invoice/inv_v46w/gateways")) return jsonResponse(200, { gateways: [] });
      if (pathname.endsWith("/payments/wipay/callback") && wipay) return jsonResponse(wipay[0], wipay[1]);
      return jsonResponse(404, { statusCode: 404, message: "Not Found" }, "Not Found");
    }),
  );
  return requested;
}

beforeEach(() => {
  search = new URLSearchParams();
  replace.mockReset();
  push.mockReset();
  try { window.localStorage.clear(); } catch { /* storage unavailable */ }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CR-02: a provider-success return whose link has since closed", () => {
  it("W-PL-01: Stripe success and the token read answers 404 (rotated on payment): 'Payment submitted', not the link error", async () => {
    search = new URLSearchParams("stripe=success");
    stubApi([[404, GONE]]);
    render(<PaymentLinkPage />);

    expect(await screen.findByRole("heading", { name: /payment submitted/i })).toBeInTheDocument();
    expect(screen.getByText(/no longer active/i)).toBeInTheDocument();
    expect(screen.queryByText(LINK_ERROR)).toBeNull();
    expect(screen.queryByRole("heading", { name: /payment link error/i })).toBeNull();
  });

  it("W-PL-02: Stripe success, the first reads show the invoice unpaid and a later poll answers 404: the stale unpaid view is replaced by 'Payment submitted'", async () => {
    search = new URLSearchParams("stripe=success");
    stubApi([[200, view()], [200, view()], [404, GONE]]);
    render(<PaymentLinkPage />);

    expect(await screen.findByRole("heading", { name: /payment submitted/i }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(LINK_ERROR)).toBeNull();
    expect(screen.queryByText("INV-4601")).toBeNull();
  });

  it("W-PL-03: a successful WiPay callback and a token read that answers 404: 'Payment received', not the link error", async () => {
    search = new URLSearchParams("status=success&order_id=inv_v46w&transaction_id=t1&total=100&hash=h");
    const requested = stubApi([[404, GONE]], [200, { success: true, invoiceId: "inv_v46w", message: "ok" }]);
    render(<PaymentLinkPage />);

    expect(await screen.findByRole("heading", { name: /payment received/i })).toBeInTheDocument();
    expect(screen.queryByText(LINK_ERROR)).toBeNull();
    expect(requested.some((p) => p.endsWith("/payments/wipay/callback"))).toBe(true);
  });

  it("W-PL-04: Stripe success and the poll finds the invoice PAID: the paid view, as before", async () => {
    search = new URLSearchParams("stripe=success");
    stubApi([[200, view({ status: "PAID", remaining: 0 })]]);
    render(<PaymentLinkPage />);

    expect(await screen.findByRole("heading", { name: /payment complete/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /payment submitted/i })).toBeNull();
  });
});

describe("controls: a closed link opened any other way still gets the link error", () => {
  it("W-PL-05: no provider return and a 404: the link error, no received / submitted state", async () => {
    stubApi([[404, GONE]]);
    render(<PaymentLinkPage />);

    expect(await screen.findByRole("heading", { name: /payment link error/i })).toBeInTheDocument();
    expect(screen.getByText(LINK_ERROR)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /payment (received|submitted)/i })).toBeNull();
  });

  it("W-PL-06: a Stripe cancel return and a 404: the link error", async () => {
    search = new URLSearchParams("stripe=cancel");
    stubApi([[404, GONE]]);
    render(<PaymentLinkPage />);

    expect(await screen.findByRole("heading", { name: /payment link error/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /payment (received|submitted)/i })).toBeNull();
  });

  it("W-PL-07: a failed WiPay callback and a 404: the error state, never 'Payment received'", async () => {
    search = new URLSearchParams("status=failed&order_id=inv_v46w");
    const requested = stubApi([[404, GONE]], [200, { success: false, message: "Card declined" }]);
    render(<PaymentLinkPage />);

    expect(await screen.findByRole("heading", { name: /payment link error/i })).toBeInTheDocument();
    expect(requested.some((p) => p.endsWith("/payments/wipay/callback"))).toBe(true);
    expect(screen.queryByRole("heading", { name: /payment (received|submitted)/i })).toBeNull();
  });
});

describe("the page is the token pay page (D-07; mirrors e2e/public-flows.spec.ts)", () => {
  it("W-PL-08: a live link renders the invoice from the token read and stays on the page; the retired resolver and the bare-id read are never requested", async () => {
    const requested = stubApi([[200, view()]]);
    render(<PaymentLinkPage />);

    expect(await screen.findByText(/INV-4601/)).toBeInTheDocument();
    expect(requested.some((p) => p.endsWith(PAY_PATH))).toBe(true);
    expect(requested.some((p) => p.includes("/commerce/payment-links/"))).toBe(false);
    expect(requested.some((p) => /\/commerce\/invoices\//.test(p))).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
