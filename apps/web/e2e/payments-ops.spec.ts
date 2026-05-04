import { test, expect, type Route } from "@playwright/test";
import {
  mockBaseLayout,
  mockCatchAll,
  seedWorkspace,
  TEST_BUSINESS_ID,
  TEST_TOKEN,
} from "./helpers/workspace";

type GatewayId = "stripe" | "paypal" | "wipay";

interface GatewayStatus {
  id: GatewayId;
  name: string;
  connected: boolean;
  supports: { transactions: boolean; paymentLinks: boolean; refunds: boolean };
}

interface Transaction {
  id: string;
  provider: GatewayId;
  type: "charge" | "refund";
  status: string;
  amount: number;
  currency: string;
  amountTtd: number | null;
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
  invoiceId: string | null;
  externalUrl: string | null;
  createdAt: string;
}

interface PaymentLink {
  id: string;
  provider: GatewayId;
  url: string;
  amount: number;
  currency: string;
  description: string;
  active: boolean;
  createdAt: string;
}

const GATEWAYS: GatewayStatus[] = [
  {
    id: "stripe",
    name: "Stripe",
    connected: true,
    supports: { transactions: true, paymentLinks: true, refunds: true },
  },
  {
    id: "paypal",
    name: "PayPal",
    connected: false,
    supports: { transactions: true, paymentLinks: true, refunds: true },
  },
  {
    id: "wipay",
    name: "WiPay",
    connected: true,
    supports: { transactions: true, paymentLinks: false, refunds: false },
  },
];

const SEED_TRANSACTIONS: Transaction[] = [
  {
    id: "ch_seed_1",
    provider: "stripe",
    type: "charge",
    status: "succeeded",
    amount: 49.99,
    currency: "USD",
    amountTtd: 338.93,
    customerName: "Jane Acme",
    customerEmail: "jane@acme.com",
    description: "Carnival package deposit",
    invoiceId: null,
    externalUrl: "https://dashboard.stripe.com/payments/ch_seed_1",
    createdAt: "2026-04-20T12:00:00.000Z",
  },
  {
    id: "ch_seed_2",
    provider: "stripe",
    type: "charge",
    status: "succeeded",
    amount: 120.0,
    currency: "USD",
    amountTtd: 813.6,
    customerName: "Bobby Cruz",
    customerEmail: "bobby@cruz.tt",
    description: "Photo session",
    invoiceId: null,
    externalUrl: "https://dashboard.stripe.com/payments/ch_seed_2",
    createdAt: "2026-04-22T09:00:00.000Z",
  },
];

interface PaymentsState {
  gateways: GatewayStatus[];
  transactions: Transaction[];
  links: PaymentLink[];
  createLinkCalls: Array<{ gateway: GatewayId; body: unknown }>;
  refundCalls: Array<{ gateway: GatewayId; chargeId: string; amount?: number }>;
}

async function mockPaymentsApi(
  page: import("@playwright/test").Page,
  state: PaymentsState,
): Promise<void> {
  // GET gateways (apiGet adds a `?_t=…` cache buster, so pattern must end in `**`)
  await page.route(
    `**/payments/businesses/${TEST_BUSINESS_ID}/gateways**`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.gateways),
      }),
  );

  // GET transactions (with optional ?limit & ?q)
  await page.route(
    `**/payments/businesses/${TEST_BUSINESS_ID}/transactions**`,
    (route: Route) => {
      // Skip the /transactions/:id/link sub-path; that has its own handler if needed
      if (/\/transactions\/[^/]+\/link/.test(route.request().url())) {
        return route.fallback();
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.transactions),
      });
    },
  );

  // GET / POST /links — `**` suffix to match the apiGet `?_t=` cache buster
  await page.route(
    `**/payments/businesses/${TEST_BUSINESS_ID}/links**`,
    async (route: Route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(state.links),
        });
        return;
      }
      if (method === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}") as {
          gateway: GatewayId;
          amount: number;
          currency: string;
          description: string;
          customerEmail?: string;
        };
        state.createLinkCalls.push({ gateway: body.gateway, body });
        if (body.gateway === "wipay") {
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              statusCode: 400,
              message: "WiPay does not support payment links",
              error: "Bad Request",
            }),
          });
          return;
        }
        const created: PaymentLink = {
          id: `plink_${state.links.length + 1}`,
          provider: body.gateway,
          url: `https://buy.stripe.com/test_${state.links.length + 1}`,
          amount: body.amount,
          currency: body.currency,
          description: body.description,
          active: true,
          createdAt: new Date().toISOString(),
        };
        state.links = [created, ...state.links];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(created),
        });
        return;
      }
      await route.fallback();
    },
  );

  // POST /refunds
  await page.route(
    `**/payments/businesses/${TEST_BUSINESS_ID}/refunds`,
    async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        gateway: GatewayId;
        chargeId: string;
        amount?: number;
        reason?: string;
      };
      state.refundCalls.push({
        gateway: body.gateway,
        chargeId: body.chargeId,
        amount: body.amount,
      });
      const orig = state.transactions.find((t) => t.id === body.chargeId);
      const refundAmount = body.amount ?? orig?.amount ?? 0;
      const refundCurrency = orig?.currency ?? "USD";
      const refund = {
        id: `re_${state.transactions.length + 1}`,
        chargeId: body.chargeId,
        amount: refundAmount,
        currency: refundCurrency,
        status: "succeeded",
        provider: body.gateway,
        createdAt: new Date().toISOString(),
      };
      // Add a refund row so the UI reflects it after reload.
      state.transactions = [
        {
          id: refund.id,
          provider: body.gateway,
          type: "refund",
          status: "succeeded",
          amount: refundAmount,
          currency: refundCurrency,
          amountTtd: null,
          customerName: orig?.customerName ?? null,
          customerEmail: orig?.customerEmail ?? null,
          description: body.reason ?? "Refund",
          invoiceId: null,
          externalUrl: null,
          createdAt: refund.createdAt,
        },
        ...state.transactions,
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(refund),
      });
    },
  );
}

function freshState(): PaymentsState {
  return {
    gateways: JSON.parse(JSON.stringify(GATEWAYS)) as GatewayStatus[],
    transactions: JSON.parse(JSON.stringify(SEED_TRANSACTIONS)) as Transaction[],
    links: [],
    createLinkCalls: [],
    refundCalls: [],
  };
}

test.describe.configure({ mode: "serial" });

test.describe("Payments dashboard", () => {
  test.beforeEach(async ({ page, context }) => {
    await seedWorkspace(context);
    // The Next.js proxy gates `/app/*` on the presence of the `kf_token` cookie.
    // localStorage seeding alone isn't enough to get past it on the first navigation.
    await context.addCookies([
      {
        name: "kf_token",
        value: TEST_TOKEN,
        url: "http://localhost:5000",
      },
    ]);
    // Catch-all FIRST so specific routes registered later (in mockBaseLayout
    // and mockPaymentsApi) take precedence — Playwright dispatches matchers
    // in reverse registration order.
    await mockCatchAll(page);
    await mockBaseLayout(page);
  });

  test("loads recent activity from connected gateways", async ({ page }) => {
    const state = freshState();
    await mockPaymentsApi(page, state);

    await page.goto("/app/payments", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    // Recent activity is the default tab; the seeded charges should render
    await expect(page.getByText("Jane Acme")).toBeVisible();
    await expect(page.getByText("Bobby Cruz")).toBeVisible();
    await expect(page.getByText("Carnival package deposit")).toBeVisible();
    // Total received in TTD should be summed and displayed
    await expect(page.getByText(/Total received \(TTD\)/i)).toBeVisible();
  });

  test("creates a Stripe payment link", async ({ page }) => {
    const state = freshState();
    await mockPaymentsApi(page, state);

    await page.goto("/app/payments?tab=links", { waitUntil: "domcontentloaded" });

    // Wait for gateways + links to finish loading (empty-state message renders
    // only after the initial load resolves).
    await expect(page.getByText("No payment links")).toBeVisible();

    await page.getByRole("button", { name: /New payment link/i }).first().click();

    const modal = page.getByRole("heading", { name: "New payment link" });
    await expect(modal).toBeVisible();

    // Default gateway is Stripe (first connected gateway with paymentLinks support).
    await page.locator('input[type="number"]').first().fill("75");
    await page
      .getByPlaceholder("What is this for?")
      .fill("Stripe link from e2e test");

    await page.getByRole("button", { name: /^Create link$/ }).click();

    await expect(page.getByText("Payment link created")).toBeVisible();

    expect(state.createLinkCalls).toHaveLength(1);
    expect(state.createLinkCalls[0].gateway).toBe("stripe");
    // The mock POST handler also stored the new link in `state.links`.
    expect(state.links[0]).toMatchObject({
      provider: "stripe",
      description: "Stripe link from e2e test",
      amount: 75,
    });
  });

  test("surfaces 'not supported' when creating a WiPay link", async ({
    page,
  }) => {
    const state = freshState();
    // Force WiPay to be the only connected gateway with payment-link support
    // by also flipping Stripe's paymentLinks support off and pretending WiPay
    // exposes them — this lets us drive the modal into picking WiPay and then
    // assert the server-side rejection message bubbles to the UI.
    state.gateways = state.gateways.map((g) => {
      if (g.id === "wipay") {
        return { ...g, supports: { ...g.supports, paymentLinks: true } };
      }
      if (g.id === "stripe") {
        return {
          ...g,
          connected: false,
          supports: { ...g.supports, paymentLinks: true },
        };
      }
      return g;
    });
    await mockPaymentsApi(page, state);

    await page.goto("/app/payments?tab=links", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("No payment links")).toBeVisible();

    await page.getByRole("button", { name: /New payment link/i }).first().click();

    await expect(
      page.getByRole("heading", { name: "New payment link" }),
    ).toBeVisible();

    // Only WiPay should be in the gateway dropdown now
    await page.locator('input[type="number"]').first().fill("25");
    await page
      .getByPlaceholder("What is this for?")
      .fill("WiPay link should fail");

    await page.getByRole("button", { name: /^Create link$/ }).click();

    // The "not supported" error from the server should surface as a toast
    await expect(
      page.getByText(/does not support payment links/i),
    ).toBeVisible();

    expect(state.createLinkCalls).toHaveLength(1);
    expect(state.createLinkCalls[0].gateway).toBe("wipay");
    // No link should have been created
    expect(state.links).toHaveLength(0);
  });

  test("issues a refund against a Stripe charge", async ({ page }) => {
    const state = freshState();
    await mockPaymentsApi(page, state);

    await page.goto("/app/payments?tab=refunds", { waitUntil: "domcontentloaded" });

    // Wait for transactions to load so the refund modal has a candidate to pick.
    await expect(page.getByText("No refunds yet")).toBeVisible();

    await page
      .getByRole("button", { name: /Issue refund/i })
      .first()
      .click();

    await expect(
      page.getByRole("heading", { name: "Issue refund" }),
    ).toBeVisible();

    // Pick the first charge from the candidate list
    await page
      .getByRole("button", { name: /Jane Acme/i })
      .first()
      .click();

    // Leave amount blank for a full refund, add a reason
    await page
      .getByPlaceholder(/Customer request, duplicate, fraud/i)
      .fill("e2e-test refund");

    await page
      .locator('form button[type="submit"]', { hasText: /Issue refund/i })
      .click();

    await expect(page.getByText("Refund issued")).toBeVisible();

    expect(state.refundCalls).toHaveLength(1);
    expect(state.refundCalls[0]).toMatchObject({
      gateway: "stripe",
      chargeId: "ch_seed_1",
    });
    // The refund mock pushed a refund row onto the transactions list.
    expect(state.transactions.find((t) => t.type === "refund")).toBeTruthy();
  });
});
