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
 * V1-46b review (CR-V46B-02): the page's payment calls are the token routes
 * of payments.controller.ts (lib/client.ts): the status poll, the gateway
 * list, the per-provider checkout and the PayPal capture. The stub answers
 * those exact paths only (every other path, the retired bare-id ones among
 * them, is a 404), so a wrong path in client.ts fails a case here: W-PL-09
 * drives the Stripe poll's PAID branch, W-PL-10 the gateway list, W-PL-11
 * each checkout and W-PL-12 the capture.
 *
 * The page is mounted with the real lib/api.ts and lib/client.ts clients;
 * only `fetch` and the Next router hooks are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import PaymentLinkPage from "../[token]/page";

const TOKEN = "cv46wabcdefghij0123456789";
const PAY_PATH = `/commerce/public/invoice-link/${TOKEN}/pay`;
/** V1-46b: the token payment routes the page calls through lib/client.ts. */
const TOKEN_PAYMENTS = `/payments/public/invoice-link/${TOKEN}`;
const STATUS_PATH = `${TOKEN_PAYMENTS}/status`;
const GATEWAYS_PATH = `${TOKEN_PAYMENTS}/gateways`;
const CHECKOUT_PATH = `${TOKEN_PAYMENTS}/checkout`;
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

// V1-46b (TG-16): the token read carries no invoice id.
function view(overrides: Record<string, unknown> = {}) {
  return {
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

function statusOf(status: string, paid = 0) {
  return { status, paid, remaining: 100 - paid, currency: "TTD", lastPaymentAt: null };
}

type Answer = [number, unknown];

/** The token payment routes (V1-46b). Each sequence is answered in order; its last answer repeats. */
type TokenRoutes = {
  status?: Answer[];
  gateways?: Answer[];
  checkout?: Answer[];
  /** PayPal order id -> the capture's answer. */
  capture?: Record<string, Answer>;
};

/** A POST the page made: its path and parsed body. */
type Posted = { path: string; body: unknown };

/**
 * `payReads` answers the token pay read in order (the last one repeats);
 * `wipay` answers the WiPay callback; `routes` the token payment routes,
 * matched on the exact path (the status poll answers as the closed link by
 * default, the gateway list answers none). Every requested path is
 * recorded, and every POST with its body in `requested.posted`.
 */
function stubApi(payReads: Answer[], wipay?: Answer, routes: TokenRoutes = {}) {
  const requested: string[] & { posted: Posted[] } = Object.assign([] as string[], { posted: [] as Posted[] });
  const seq = { pay: 0, status: 0, gateways: 0, checkout: 0 };
  const next = (answers: Answer[], key: keyof typeof seq): Answer => {
    const answer = answers[Math.min(seq[key], answers.length - 1)];
    seq[key] += 1;
    return answer;
  };
  const reply = ([status, body]: Answer) => jsonResponse(status, body, status === 404 ? "Not Found" : "OK");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      requested.push(pathname);
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        const raw = init?.body;
        requested.posted.push({ path: pathname, body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw ?? null });
      }
      if (pathname.endsWith(PAY_PATH)) return reply(next(payReads, "pay"));
      if (pathname.endsWith(STATUS_PATH)) return reply(next(routes.status ?? [[404, GONE]], "status"));
      if (pathname.endsWith(GATEWAYS_PATH)) return reply(next(routes.gateways ?? [[200, []]], "gateways"));
      if (pathname.endsWith(CHECKOUT_PATH) && routes.checkout) return reply(next(routes.checkout, "checkout"));
      const capturePrefix = `${TOKEN_PAYMENTS}/paypal/capture/`;
      const at = pathname.indexOf(capturePrefix);
      if (at >= 0 && routes.capture) {
        const orderId = decodeURIComponent(pathname.slice(at + capturePrefix.length));
        const answer = routes.capture[orderId];
        if (answer) return reply(answer);
      }
      if (pathname.endsWith("/payments/wipay/callback") && wipay) return reply(wipay);
      return jsonResponse(404, { statusCode: 404, message: "Not Found" }, "Not Found");
    }),
  );
  return requested;
}

const GATEWAYS = [
  { id: "wipay", name: "WiPay", currencies: ["TTD"] },
  { id: "paypal", name: "PayPal", currencies: ["USD"] },
  { id: "stripe", name: "Stripe", currencies: ["TTD"] },
];

/** The final "Pay <amount>" button (not a method tile such as "Pay with Card"). */
function payButton(): HTMLElement {
  const button = screen.getAllByRole("button").find((b) => /^Pay (?!with)/.test((b.textContent ?? "").trim()));
  if (!button) throw new Error("no Pay button");
  return button;
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
    // V1-46b: the poll is the token status route: unpaid first, then the closed link's 404.
    stubApi([[200, view()], [200, view()], [404, GONE]], undefined, { status: [[200, statusOf("SENT")], [404, GONE]] });
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
    stubApi([[200, view({ status: "PAID", remaining: 0 })]], undefined, { status: [[200, statusOf("PAID", 100)]] });
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

describe("V1-46b review (CR-V46B-02): the page's payment calls are the token routes", () => {
  it("W-PL-09: Stripe success, the token read shows the invoice unpaid and the token status poll answers PAID: the page re-reads the token pay read and shows the paid view", async () => {
    search = new URLSearchParams("stripe=success");
    const requested = stubApi([[200, view()], [200, view({ status: "PAID", remaining: 0 })]], undefined, {
      status: [[200, statusOf("PAID", 100)]],
    });
    render(<PaymentLinkPage />);

    expect(await screen.findByRole("heading", { name: /payment complete/i })).toBeInTheDocument();
    expect(requested.filter((p) => p.endsWith(STATUS_PATH))).toHaveLength(1);
    // The initial read, then the poll's re-read once the status said PAID.
    await waitFor(() => expect(requested.filter((p) => p.endsWith(PAY_PATH))).toHaveLength(2));
    expect(screen.queryByRole("heading", { name: /payment submitted/i })).toBeNull();
    expect(requested.some((p) => p.includes("/payments/invoice/"))).toBe(false);
  });

  it("W-PL-10: the gateway list is the token route's answer: each gateway it lists is offered", async () => {
    const requested = stubApi([[200, view()]], undefined, { gateways: [[200, GATEWAYS]] });
    render(<PaymentLinkPage />);

    expect(await screen.findByText("Pay with Card")).toBeInTheDocument();
    expect(screen.getByText("Pay with PayPal")).toBeInTheDocument();
    expect(screen.getByText("Pay with Stripe")).toBeInTheDocument();
    expect(requested.filter((p) => p.endsWith(GATEWAYS_PATH))).toHaveLength(1);
    expect(requested.some((p) => p.includes("/payments/invoice/"))).toBe(false);
  });

  it("W-PL-11: each provider checkout is one POST to the token checkout route naming the gateway and its return URLs, and nothing names the invoice", async () => {
    const base = `${window.location.origin}${window.location.pathname}`;
    const cases: Array<[string, Record<string, string>, Answer]> = [
      ["Pay with Stripe", { gateway: "stripe", successUrl: `${base}?stripe=success`, cancelUrl: `${base}?stripe=cancel` }, [201, { type: "redirect", redirectUrl: "#stripe-session" }]],
      ["Pay with Card", { gateway: "wipay", returnUrl: base }, [201, { type: "redirect", redirectUrl: "#wipay-session" }]],
      ["Pay with PayPal", { gateway: "paypal" }, [201, { type: "paypal_order", orderId: "ORDER-V46W" }]],
    ];
    // jsdom does not navigate away; a hash-only redirect keeps the page mounted.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const [tile, body, answer] of cases) {
      cleanup();
      vi.unstubAllGlobals();
      const requested = stubApi([[200, view()]], undefined, { gateways: [[200, GATEWAYS]], checkout: [answer] });
      render(<PaymentLinkPage />);

      fireEvent.click((await screen.findByText(tile)).closest("button")!);
      fireEvent.click(payButton());

      await waitFor(() => expect(requested.posted.filter((p) => p.path.endsWith(CHECKOUT_PATH)), tile).toHaveLength(1));
      expect(requested.posted.find((p) => p.path.endsWith(CHECKOUT_PATH))!.body, tile).toEqual(body);
      expect(JSON.stringify(requested.posted), tile).not.toContain("inv_");
      expect(requested.some((p) => p.includes("/payments/invoice/") || p.includes("create-checkout")), tile).toBe(false);
    }
  });

  it("W-PL-12: a PayPal return captures through the token route with PayPal's order id, and a COMPLETED capture shows the paid view", async () => {
    search = new URLSearchParams("token=ORDER-V46W&PayerID=PAYER1");
    const requested = stubApi([[200, view()], [200, view({ status: "PAID", remaining: 0 })]], undefined, {
      capture: { "ORDER-V46W": [201, { id: "ORDER-V46W", status: "COMPLETED" }] },
    });
    render(<PaymentLinkPage />);

    expect(await screen.findByRole("heading", { name: /payment complete/i })).toBeInTheDocument();
    const captures = requested.posted.filter((p) => p.path.includes("/paypal/capture/"));
    expect(captures).toHaveLength(1);
    expect(captures[0].path.endsWith(`${TOKEN_PAYMENTS}/paypal/capture/ORDER-V46W`)).toBe(true);
    expect(captures[0].body).toEqual({});
    expect(requested.some((p) => p.startsWith("/payments/paypal/capture/") || p.includes("/api/payments/paypal/capture/"))).toBe(false);
  });
});
