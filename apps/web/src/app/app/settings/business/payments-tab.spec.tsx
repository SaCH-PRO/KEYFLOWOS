/**
 * R0-SEC2c-PAYMENT-SECRETS-WRITE-ONLY — the payments tab never echoes a payment
 * provider secret back.
 *
 * RED-BEFORE (R0-SEC2b review SEC2b-R3, deferred): the tab loaded
 * GET /identity/businesses/:id, read metaData.stripeSecretKey,
 * stripeWebhookSecret, paypalClientSecret and wipayApiKey into its form inputs
 * (a click on the eye showed them) and PATCHed all four back on every save.
 *
 * GREEN-AFTER: the server answers each secret as {configured:true} (absent when
 * none is stored). The tab shows "Configured" with Replace and Remove controls,
 * never puts a stored value into an input (even if an older server sends one),
 * sends a secret only when the user typed a new one, sends null for an explicit
 * Remove, and omits every other secret so the stored one stays.
 *
 * Mounted on the real PaymentsTab and the real api client (lib/api.ts); only
 * `fetch` is stubbed: GET answers the business, PATCH records its body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// UI02 types into eight secret fields and saves; under the full web run the
// default 5s budget times out with no assertion failing. Assertions unchanged.
vi.setConfig({ testTimeout: 20_000 });
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { PaymentsTab } from "./payments-tab";

const BUSINESS = "biz_sec2c";
const SECRET_KEYS = ["stripeSecretKey", "stripeWebhookSecret", "paypalClientSecret", "wipayApiKey"] as const;
const PLAINTEXT = {
  stripeSecretKey: "sk_live_SEC2C_STRIPE_SECRET_91ab",
  stripeWebhookSecret: "whsec_SEC2C_WEBHOOK_SECRET_44cd",
  paypalClientSecret: "SEC2C_PAYPAL_SECRET_7e0f",
  wipayApiKey: "SEC2C_WIPAY_KEY_2b3a",
};
const MASKED = { configured: true };
const PUBLIC_META = {
  stripePublishableKey: "pk_live_sec2c",
  paypalClientId: "sec2c-paypal-client",
  wipayAccountNumber: "sec2c-wipay-account",
};

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

/**
 * GET answers `metaData` (and the business `currency`, when given); every PATCH body is recorded and answered with
 * the masked business.
 */
function stubServer(metaData: Record<string, unknown>, currency?: string) {
  const patches: Array<{ metaData: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if (!pathname.endsWith(`/identity/businesses/${BUSINESS}`)) return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
    if ((init?.method ?? "GET") === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { metaData: Record<string, unknown> };
      patches.push(body);
      return jsonResponse(200, { id: BUSINESS, metaData: {} });
    }
    return jsonResponse(200, { id: BUSINESS, address: "1 Frederick St", metaData, ...(currency ? { currency } : {}) });
  }));
  return { patches };
}

/** Open the three gateway cards so every field is mounted. */
async function openGatewayCards() {
  for (const title of ["Card Payments (WiPay)", "PayPal", "Stripe"]) {
    fireEvent.click(await screen.findByText(title));
  }
}

function inputValues(): string[] {
  return Array.from(document.querySelectorAll("input, textarea")).map((el) => (el as HTMLInputElement).value);
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: /Save Payment Settings/ }));
  await screen.findByText("Payment settings saved successfully");
}

describe("payments tab: payment provider secrets are write-only (R0-SEC2c)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", BUSINESS);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("[SEC2c-UI01] RED-BEFORE: a stored secret value the read carries (an older server) never reaches an input or the page, and a save sends no secret", async () => {
    const { patches } = stubServer({ ...PLAINTEXT, ...PUBLIC_META });
    render(<PaymentsTab />);
    await openGatewayCards();
    // The read has landed: the non-secret settings are in their inputs.
    await waitFor(() => expect(inputValues()).toContain(PUBLIC_META.paypalClientId));

    for (const value of Object.values(PLAINTEXT)) {
      expect(inputValues(), `an input holds ${value}`).not.toContain(value);
      expect(document.body.innerHTML.includes(value), `${value} on the page`).toBe(false);
    }

    await save();
    expect(patches).toHaveLength(1);
    for (const k of SECRET_KEYS) expect(patches[0].metaData, `PATCH metaData.${k}`).not.toHaveProperty(k);
  });

  it("[SEC2c-UI02] RED-BEFORE: a {configured:true} marker shows 'Configured' with a Replace and a Remove control for each secret, the gateways read as connected, and a save omits every secret (the stored ones stay)", async () => {
    const { patches } = stubServer({
      stripeSecretKey: MASKED, stripeWebhookSecret: MASKED, paypalClientSecret: MASKED, wipayApiKey: MASKED, ...PUBLIC_META,
    });
    render(<PaymentsTab />);
    await openGatewayCards();

    expect(await screen.findAllByText("Configured")).toHaveLength(4);
    for (const label of ["Secret Key", "Webhook Signing Secret", "Client Secret", "API Key (Developer ID)"]) {
      expect(screen.getByRole("button", { name: `Replace ${label}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Remove ${label}` })).toBeInTheDocument();
    }
    // Stripe (publishable + both secrets), PayPal (id + secret) and WiPay (key + account) are complete.
    expect(screen.getAllByText("Connected")).toHaveLength(3);

    await save();
    expect(patches).toHaveLength(1);
    for (const k of SECRET_KEYS) expect(patches[0].metaData, `PATCH metaData.${k}`).not.toHaveProperty(k);
    expect(patches[0].metaData.stripePublishableKey).toBe(PUBLIC_META.stripePublishableKey);
  });

  it("[SEC2c-UI03] Replace: the user types a new Stripe secret key; the save sends that one secret and omits the other three, and the typed value leaves the page", async () => {
    const { patches } = stubServer({
      stripeSecretKey: MASKED, stripeWebhookSecret: MASKED, paypalClientSecret: MASKED, wipayApiKey: MASKED, ...PUBLIC_META,
    });
    render(<PaymentsTab />);
    await openGatewayCards();

    fireEvent.click(await screen.findByRole("button", { name: "Replace Secret Key" }));
    const input = screen.getByLabelText("Secret Key") as HTMLInputElement;
    expect(input.value, "the replace input starts empty").toBe("");
    fireEvent.change(input, { target: { value: "sk_live_brand_new" } });

    await save();
    expect(patches).toHaveLength(1);
    expect(patches[0].metaData.stripeSecretKey).toBe("sk_live_brand_new");
    for (const k of SECRET_KEYS.filter((s) => s !== "stripeSecretKey")) expect(patches[0].metaData).not.toHaveProperty(k);
    // Saved: the field is back to 'Configured', the typed secret is not kept in an input.
    await waitFor(() => expect(inputValues()).not.toContain("sk_live_brand_new"));
    expect(screen.getAllByText("Configured")).toHaveLength(4);
  });

  it("[SEC2c-UI04] Remove: an explicit clear sends null for that secret only; the gateway then reads as partial", async () => {
    const { patches } = stubServer({
      stripeSecretKey: MASKED, stripeWebhookSecret: MASKED, paypalClientSecret: MASKED, wipayApiKey: MASKED, ...PUBLIC_META,
    });
    render(<PaymentsTab />);
    await openGatewayCards();

    fireEvent.click(await screen.findByRole("button", { name: "Remove Client Secret" }));
    expect(screen.getByText(/removed when you save/i)).toBeInTheDocument();

    await save();
    expect(patches).toHaveLength(1);
    expect(patches[0].metaData).toHaveProperty("paypalClientSecret", null);
    for (const k of SECRET_KEYS.filter((s) => s !== "paypalClientSecret")) expect(patches[0].metaData).not.toHaveProperty(k);
    expect(screen.getAllByText("Configured")).toHaveLength(3);
    expect(screen.getAllByText("Connected")).toHaveLength(2);
  });

  it("[SEC2c-UI05] a secret that is not configured shows an empty input; typing sends it, leaving it empty sends nothing", async () => {
    const { patches } = stubServer({ ...PUBLIC_META });
    render(<PaymentsTab />);
    await openGatewayCards();

    expect(screen.queryByText("Configured")).not.toBeInTheDocument();
    const wipay = (await screen.findByLabelText("API Key (Developer ID)")) as HTMLInputElement;
    expect(wipay.value).toBe("");
    fireEvent.change(wipay, { target: { value: "wipay-new-key" } });

    await save();
    expect(patches).toHaveLength(1);
    expect(patches[0].metaData.wipayApiKey).toBe("wipay-new-key");
    for (const k of SECRET_KEYS.filter((s) => s !== "wipayApiKey")) expect(patches[0].metaData).not.toHaveProperty(k);
    const card = screen.getByText("Card Payments (WiPay)").closest("button") as HTMLElement;
    expect(within(card).getByText("Connected")).toBeInTheDocument();
  });
});

describe("payments tab: why PayPal is missing for the business currency (W10-PAYPAL-CURRENCY, D-106)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", BUSINESS);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("[PPC-UI01] (W10-PAYPAL-CURRENCY, D-106) a TTD business: the PayPal card says PayPal does not support TTD, so payers are not offered PayPal for invoices, pay links and storefront orders in TTD", async () => {
    stubServer({ paypalClientSecret: MASKED, ...PUBLIC_META }, "TTD");
    render(<PaymentsTab />);
    fireEvent.click(await screen.findByText("PayPal"));

    // At 71a97cb1: no such note; the card listed PayPal as connected with no word on the business currency.
    const note = await screen.findByTestId("paypal-currency-note");
    expect(note).toHaveTextContent("PayPal does not support TTD, your business currency");
    expect(note).toHaveTextContent("invoices, pay links and storefront orders in TTD are not offered PayPal");
  });

  it("[PPC-UI02] (W10-PAYPAL-CURRENCY, D-106) the other Caribbean currencies the ruling names get the same note; a USD business (control) gets none", async () => {
    for (const currency of ["JMD", "BBD", "GYD", "XCD"]) {
      stubServer({ ...PUBLIC_META }, currency);
      render(<PaymentsTab />);
      fireEvent.click(await screen.findByText("PayPal"));
      expect(await screen.findByTestId("paypal-currency-note"), currency).toHaveTextContent(`PayPal does not support ${currency}`);
      cleanup();
      vi.unstubAllGlobals();
    }

    stubServer({ ...PUBLIC_META }, "USD");
    render(<PaymentsTab />);
    fireEvent.click(await screen.findByText("PayPal"));
    // The read has landed (the client id is in its input) and no note is shown.
    await waitFor(() => expect(inputValues()).toContain(PUBLIC_META.paypalClientId));
    expect(screen.queryByTestId("paypal-currency-note")).toBeNull();
  });
});
