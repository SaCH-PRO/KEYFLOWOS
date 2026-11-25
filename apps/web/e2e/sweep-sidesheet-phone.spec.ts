import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import { TEST_BUSINESS_ID, e2eBaseURL, mockBaseLayout, mockCatchAll, seedWorkspace } from "./helpers/workspace";

/**
 * FU-SIDESHEET-MOBILE-OFFSET, the browser half (owner ruling D-283; journey C on a phone): "a SideSheet mounted
 * open at 375px is fully on screen". The jsdom half is src/components/ui/__tests__/side-sheet-phone-mount.test.tsx
 * (SSM-01..05).
 *
 * The shared SideSheet (components/ui/side-sheet.tsx) learned the phone width from useIsMobile(), which starts false
 * and flips in an effect, so a sheet that mounts already open rendered its desktop panel first and, on a phone, was
 * left translated off the right edge. Two real consumers are opened here, each the way a person reaches it:
 *
 *   SSB-01 the store's order sheet (store/components/orders-panel.tsx OrderDetailSheet). It is mounted, open, when an
 *          order is picked: Store > Ops (the ?tab=orders door) > All Orders > the order. RED at the base on a phone:
 *          the panel's left edge is at the right edge of the screen.
 *   SSB-02 the email composer (components/email/compose-modal.tsx), open on load from its ?compose=1 door.
 *
 * For each: once the sheet has stopped moving, its panel's bounding box is inside the viewport, its title and its
 * Close button are inside it too, the page has no sideways scroll, and no hydration error was logged. On a phone
 * the panel is the bottom sheet, the full width of the screen; from 640px up it is the right-hand panel, at the
 * right edge.
 *
 * Run at 375, 768, 1024 and 1440.
 *
 * Mocked: every API call is answered by page.route on api.test.local; skipped under E2E_LIVE.
 *   pnpm run build (NEXT_PUBLIC_API_BASE_URL=http://api.test.local), then
 *   E2E_WEB_COMMAND=standalone E2E_PORT=5400 pnpm exec playwright test e2e/sweep-sidesheet-phone.spec.ts --project=chromium
 */

test.skip(process.env.E2E_LIVE === "1", "mocked sweep: runs without a live API");

const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];

/** The edge middleware lets /app/* through only with a JWT-shaped kf_token; the mocked API never checks it. */
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT_SHAPED = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "user_e2e", exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const NOW = new Date().toISOString();
const ORDER = {
  id: "ord_ssb_1042",
  orderNumber: "KF-1042",
  status: "PENDING",
  customerName: "Dana Sheetwell",
  customerEmail: "dana@ssb.example",
  customerPhone: null,
  subtotal: 250,
  shippingFee: 0,
  taxAmount: 0,
  discountAmount: 0,
  total: 250,
  currency: "TTD",
  paymentStatus: "PENDING",
  paymentMethod: "CASH",
  type: "STOREFRONT",
  items: [{ id: "oi_ssb_1", name: "Linen tote", quantity: 1, unitPrice: 250, total: 250 }],
  createdAt: NOW,
  updatedAt: NOW,
};

/** Signs in to a mocked, onboarded business whose store has one order; collects hydration errors. */
async function signIn(page: Page): Promise<string[]> {
  const hydration: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat|did not match|#418|#423|#425/i.test(m.text())) hydration.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (/hydrat|did not match|#418|#423|#425/i.test(e.message)) hydration.push(e.message);
  });
  await seedWorkspace(page.context());
  await page.context().addCookies([{ name: "kf_token", value: JWT_SHAPED, url: e2eBaseURL(), sameSite: "Lax" }]);
  await page.context().addInitScript((token) => window.localStorage.setItem("kf_token", token), JWT_SHAPED);
  await mockCatchAll(page);
  await mockBaseLayout(page, { business: { sells: "products", advancedCrm: false } });
  await page.route(/\/identity\/businesses(\?.*)?$/, (route: Route) => json(route, 200, [{ id: TEST_BUSINESS_ID, name: "E2E Test Business" }]));
  await page.route(`**/identity/businesses/${TEST_BUSINESS_ID}/my-access**`, (route: Route) =>
    json(route, 200, { modules: Object.fromEntries(ALL.map((m) => [m, "write"])) }),
  );
  await page.route(`**/onboarding-concierge/businesses/${TEST_BUSINESS_ID}/onboarding-state**`, (route: Route) =>
    json(route, 200, { onboardingComplete: true, onboardingCompletedAt: NOW, threePillarMet: true, step: "complete" }),
  );
  // The store screen's own reads (store/hooks/use-store-data.ts): an empty store graph, as a new store has.
  await page.route(`**/commerce/businesses/${TEST_BUSINESS_ID}/store/graph**`, (route: Route) =>
    json(route, 200, { mappings: [], liveCount: 0, draftCount: 0, driftCount: 0, totalProducts: 0, totalServices: 0, serviceNameIndex: {} }),
  );
  await page.route(new RegExp(`/site/businesses/${TEST_BUSINESS_ID}/orders(\\?.*)?$`), (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return json(route, 200, { data: [ORDER], total: 1, page: 1, pageSize: 100, totalPages: 1 });
  });
  await page.route(new RegExp(`/site/businesses/${TEST_BUSINESS_ID}/orders/summary(\\?.*)?$`), (route: Route) =>
    json(route, 200, { totalOrders: 1, pendingOrders: 1, confirmedOrders: 0, shippedOrders: 0, completedOrders: 0, cancelledOrders: 0, totalRevenue: 0 }),
  );
  return hydration;
}

/** The sheet's panel: the dialog's child that holds its title (the other child is the backdrop). */
function panelOf(dialog: Locator): Locator {
  return dialog.locator(":scope > div").filter({ has: dialog.page().locator("#side-sheet-title") });
}

type Box = { x: number; y: number; width: number; height: number };

/** The panel's box once it has stopped moving (two reads 150ms apart agree). */
async function settledBox(panel: Locator): Promise<Box> {
  let last: Box | null = null;
  let settled: Box | null = null;
  await expect
    .poll(
      async () => {
        const now = await panel.boundingBox();
        const same = !!now && !!last && ["x", "y", "width", "height"].every((k) => Math.abs(now[k as keyof Box] - last![k as keyof Box]) < 0.5);
        last = now;
        if (same) settled = now;
        return same;
      },
      { message: "the sheet stops moving", intervals: [150], timeout: 10_000 },
    )
    .toBe(true);
  return settled as unknown as Box;
}

/** The DoD: the panel, its title and its Close button are inside the viewport; nothing scrolls sideways; no hydration error. */
async function expectOnScreen(page: Page, dialog: Locator, hydration: string[]) {
  const vw = page.viewportSize()!.width;
  const vh = page.viewportSize()!.height;
  const panel = panelOf(dialog);
  await expect(panel).toHaveCount(1);
  const box = await settledBox(panel);
  const where = `panel at x=${box.x.toFixed(1)} y=${box.y.toFixed(1)} w=${box.width.toFixed(1)} h=${box.height.toFixed(1)} in ${vw}x${vh}`;
  expect(box.x, `${where}: its left edge is on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(box.y, `${where}: its top edge is on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${where}: its right edge is on screen`).toBeLessThanOrEqual(vw + 0.5);
  expect(box.y + box.height, `${where}: its bottom edge is on screen`).toBeLessThanOrEqual(vh + 0.5);
  if (vw < 640) {
    expect(box.width, `${where}: on a phone the bottom sheet spans the screen`).toBeGreaterThanOrEqual(vw - 0.5);
    expect(box.y + box.height, `${where}: on a phone it sits at the bottom`).toBeGreaterThanOrEqual(vh - 0.5);
  } else {
    expect(box.x + box.width, `${where}: from 640px up it is the right-hand panel`).toBeGreaterThanOrEqual(vw - 0.5);
  }
  for (const part of [panel.locator("#side-sheet-title"), panel.getByRole("button", { name: "Close", exact: true })]) {
    const b = await part.boundingBox();
    expect(b, "the title and the Close button are laid out").not.toBeNull();
    expect(b!.x, `${where}: ${await part.evaluate((e) => e.outerHTML.slice(0, 60))} is on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(b!.x + b!.width, `${where}: ${await part.evaluate((e) => e.outerHTML.slice(0, 60))} is on screen`).toBeLessThanOrEqual(vw + 0.5);
  }
  const sideways = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ left: 400, top: window.scrollY });
    const moved = window.scrollX;
    window.scrollTo({ left: 0, top: window.scrollY });
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, moved };
  });
  expect(sideways.moved, `no sideways page scroll (${JSON.stringify(sideways)})`).toBe(0);
  expect(sideways.scrollWidth, `no sideways page scroll (${JSON.stringify(sideways)})`).toBeLessThanOrEqual(sideways.clientWidth + 1);
  expect(hydration, "no hydration error").toEqual([]);
}

for (const width of [375, 768, 1024, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 812 : 900 } });

    test(`SSB-01 the store's order sheet, mounted open when an order is picked, is fully on screen (${width})`, async ({ page }) => {
      const hydration = await signIn(page);
      await page.goto("/app/store?tab=orders");
      const allOrders = page.getByRole("button", { name: /All Orders/ }).filter({ visible: true }).first();
      await expect(allOrders).toBeVisible({ timeout: 30_000 });
      await allOrders.click();
      const order = page.getByRole("button", { name: /KF-1042/ }).filter({ visible: true }).first();
      await expect(order).toBeVisible({ timeout: 10_000 });
      await order.click();
      const dialog = page.getByRole("dialog", { name: "Order KF-1042" });
      await expect(dialog).toBeVisible();
      await expectOnScreen(page, dialog, hydration);
    });

    test(`SSB-02 the email composer, open on load from ?compose=1, is fully on screen (${width})`, async ({ page }) => {
      const hydration = await signIn(page);
      await page.goto("/app/store?compose=1&to=dana%40ssb.example&subject=Your%20order");
      const dialog = page.getByRole("dialog").filter({ has: page.locator("#side-sheet-title") });
      await expect(dialog).toHaveCount(1, { timeout: 30_000 });
      await expect(dialog).toBeVisible();
      await expectOnScreen(page, dialog, hydration);
    });
  });
}
