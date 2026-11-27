import {
  test,
  expect,
  API_URL,
  RUN,
  anonymousContext,
  coveredButtonFindings,
  settle,
  type Tenant,
} from "./journey-helpers";
import { framingRefused, offeredPaymentMethods } from "./journey-text";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { APIRequestContext, BrowserContext, Locator, Page, Request } from "@playwright/test";

/**
 * GATE-JOURNEYS-G-L, journey G: sell online (product audit core_journeys_v1 G;
 * KF-JOURNEY-010, 021; D-18, D-105, D-112, D-127, D-138; rulings storelisting
 * D-185, framing D-186, alerts D-154). Each bullet of G's definition of done is
 * a test (G1..G11), on both journey projects, in every variant (README.md in
 * this folder).
 *
 * The store
 *   G1  It shows each listed product once, with its stock state.
 *   G2  The product page (/book/<slug>/product/<id>) renders from the storefront
 *       payload (GET /site/storefront/public/<slug>), and calls no route the API
 *       does not have.
 *   G3  Quantity is capped at stock, and checkout refuses an oversell in plain
 *       words (the product named, no id), writing no order: through the
 *       checkout route, and on the checkout screen itself when the stock drops
 *       under a customer's cart before Place Order (the screen says so in
 *       plain words, confirms nothing, and no order is written).
 *   G4  Only configured methods are offered: Settings > Getting paid, saved as
 *       its tab saves it (payments-tab.tsx: PATCH /identity/businesses/:id
 *       metaData), twice (bank transfer on and cash off, then the reverse); the
 *       store's Payment step offers exactly the enabled one, and never PayPal
 *       on a TTD store without its own keys.
 * After payment
 *   G5  Every paid order has an invoice, a payment and ledger postings,
 *       including COGS (the customer checks out with cash; the owner records
 *       the cash, Complete offline).
 *   G6  The owner is alerted (@staging: a real push service and mailbox;
 *       alerts ruling D-154).
 *   G7  The order shows in Sales > Orders with its number, customer, items and
 *       total in the business currency.
 * The page
 *   G8  An offline store says 'temporarily unavailable' (the owner takes it
 *       offline from Your page).
 *   G9  The in-app preview and the /widgets/* embeds render: Your page's
 *       preview shows the store; another site frames /widgets/cart/<slug> and
 *       /widgets/booking/<slug>; the full booking page frames only inside the
 *       app (framing ruling D-186): its answer forbids another site to frame
 *       it (X-Frame-Options / CSP frame-ancestors, journey-text.ts
 *       framingRefused) and the browser refuses the frame (Chrome's error
 *       page), never judged by text that has not loaded yet.
 *   G10 There are no unearned badges ('Verified Business', 'Instant Booking',
 *       'Guaranteed by KeyFlowOS'; 'Open Now' with no hours set).
 *   G11 /site/<slug> redirects to /book/<slug>, also for a business that
 *       published a page in the old builder.
 *
 * Doors (the packets that turn these green build to them):
 *   - Your page is /app/store. Its catalog (/app/store?tab=catalog, the "What's
 *     shown" list) lists each product with "Add to store" / "Remove from
 *     store" (journey B4); the online/offline switch is a button on Your page
 *     ("Take Offline" / "Go Live" today, or a switch named online / offline /
 *     unavailable); the in-app preview is an iframe of /book/<slug> on one of
 *     its tabs (Share, Launch, Design or Preview).
 *   - The store is /book/<slug>: a product's card, "Add" / "Add to Cart", the
 *     cart ("Open cart", the "Shopping cart" dialog, its quantity stepper,
 *     "Proceed to Checkout"), the Information step (first name, last name,
 *     email, phone), "Continue", the Delivery step when it asks (address,
 *     city), "Continue", the Payment step (its methods, the terms box) and
 *     "Place Order".
 *   - Sales > Orders is the "Orders" tab of Sales (/app/commerce,
 *     SALES-ORDERS-TAB) for a business that sells products; each order's row
 *     names its number, customer, items and total, and offers Complete offline
 *     for a cash order (SWP-STORE-OPS-WEB's orders panel).
 *
 * Prerequisites a test does not drive itself are made through the API, as the
 * screens before them would make them: the slug, products with tracked stock
 * (a warehouse and its stock rows, with a unit cost for COGS), Getting paid. A
 * product reaches the store only through Your page's "Add to store".
 *
 * RED at the GATE-JOURNEYS-A-F head (e63bcb1a), observed on both projects in
 * the ai-disabled and key-disabled variants (the packet return holds the
 * report): G1 the store lists the product twice, as a 'Service ... 30 min'
 * card and a 'Product' card (BUG-054), and the in-stock card shows no stock
 * state; G3 the cart takes 15 against 10 in stock, and the checkout of 50
 * answers 201 with the order PENDING (BUG-017, the headline); G4 with bank
 * transfer on and cash off the Payment step still offers cash; G7 Sales has no
 * Orders tab (SALES-ORDERS-TAB); G8 the offline store says 'Page Not Found'
 * (BUG-109); G9 Your page's preview is blank and neither widget renders inside
 * another site (BUG-056; the full booking page is refused there, as it should
 * be); G10 'Verified Business', 'Instant Booking', 'Guaranteed by KeyFlowOS'
 * and 'Open Now' are shown; G11 /site/<slug> answers 200 with the old builder's
 * page. G2 and G5 pass (the paid order has its invoice, its payment and its
 * postings, COGS included). G6 is @staging and does not run here.
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  data?: unknown,
  expected?: number,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(owner), data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(expected ?? (method === "POST" ? 201 : 200));
  return (text ? JSON.parse(text) : null) as T;
}

function rowsOf<T = Record<string, unknown>>(body: unknown, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[];
  const b = body as Record<string, unknown>;
  for (const k of [...keys, "data", "items", "results", "orders"]) if (Array.isArray(b?.[k])) return b[k] as T[];
  return [];
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A cuid-like id (the API's row ids), which a customer-facing message must never carry. */
const ROW_ID = /\bc[a-z0-9]{20,}\b/;

const alreadySelling = new Set<string>();

/**
 * WEDGE-HIDE-STORE part 2 (P225; owner rulings D-263, D-304, D-305): journey G is about a business that ALREADY
 * sells. The store checkout is offered only to a business with an earlier order (the `store` legacy answer,
 * `storeCheckout` on GET /site/storefront/public/:slug, server row P233), so G's business gets one before it opens
 * its store: a cash counter sale of an untracked product, made as + New > Quick sale makes it (once per tenant).
 * A brand-new business is not offered the store checkout at all; that case is pinned in the web unit tests
 * (store-checkout-gate.test.tsx), not here.
 */
async function seedPastSale(request: APIRequestContext, owner: Tenant): Promise<void> {
  if (alreadySelling.has(owner.businessId)) return;
  // The Set lasts one worker process. A retry or another worker reads the business's orders first (the owner's read
  // behind Sales > Orders), so the business gets one earlier sale, not one per process.
  const earlier = rowsOf(await api(request, owner, "GET", `/site/businesses/${owner.businessId}/orders`), "orders");
  if (earlier.length > 0) {
    alreadySelling.add(owner.businessId);
    return;
  }
  const product = await api<{ id: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, {
    name: `Earlier sale ${stamp()}`,
    price: 10,
    currency: owner.currency,
    category: "PRODUCT",
  });
  await api(request, owner, "POST", `/marketplace/businesses/${owner.businessId}/quick-sales`, {
    items: [{ productId: product.id, quantity: 1 }],
    paymentMethod: "cash",
  });
  alreadySelling.add(owner.businessId);
}

/** The business's store: a business that already sells (seedPastSale), its slug, and the store switched on. */
async function seedStore(request: APIRequestContext, owner: Tenant, label: string): Promise<string> {
  await seedPastSale(request, owner);
  const slug = `${RUN.replace(/_/g, "-")}-${label}-${stamp()}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  await api(request, owner, "PATCH", `/identity/businesses/${owner.businessId}`, { slug, storeEnabled: true });
  return slug;
}

interface StockedProduct {
  id: string;
  name: string;
  price: number;
  /** Its stock rows, one per warehouse, in the order given. */
  stockIds: string[];
}

const warehouses = new Map<string, string[]>();

/** The business's warehouses (made once per tenant, as Inventory > Warehouses makes them). */
async function warehousesOf(request: APIRequestContext, owner: Tenant, count: number): Promise<string[]> {
  const have = warehouses.get(owner.businessId) ?? [];
  while (have.length < count) {
    const w = await api<{ id: string }>(request, owner, "POST", `/marketplace/businesses/${owner.businessId}/warehouses`, { name: `Shop ${have.length + 1} ${stamp()}` });
    have.push(w.id);
  }
  warehouses.set(owner.businessId, have);
  return have.slice(0, count);
}

/**
 * A product with tracked stock, as Sales > Products and Inventory make one: a
 * PRODUCT at `price`, tracked, shown as out of stock when none is left, and
 * `stock` units (split over the given warehouses) at `cost` a unit.
 */
async function seedStockedProduct(
  request: APIRequestContext,
  owner: Tenant,
  name: string,
  price: number,
  stock: number[],
  cost = Math.round(price * 0.4),
): Promise<StockedProduct> {
  const product = await api<{ id: string; name: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, {
    name,
    price,
    currency: owner.currency,
    category: "PRODUCT",
    description: `${name}, made in Trinidad`,
    inventoryMode: "tracked",
    outOfStockBehavior: "show_oos",
  });
  const ws = await warehousesOf(request, owner, stock.length);
  const stockIds: string[] = [];
  for (let i = 0; i < stock.length; i++) {
    const row = await api<{ id: string }>(request, owner, "POST", `/marketplace/businesses/${owner.businessId}/inventory`, {
      productId: product.id,
      warehouseId: ws[i],
      quantity: stock[i],
      costPerUnit: cost,
      currency: owner.currency,
    });
    stockIds.push(row.id);
  }
  return { id: product.id, name: product.name, price, stockIds };
}

/** Units on hand for a product, over every warehouse (the inventory read). */
async function onHand(request: APIRequestContext, owner: Tenant, productId: string): Promise<number> {
  const rows = rowsOf<{ productId?: string; product?: { id?: string }; quantity?: number }>(
    await api(request, owner, "GET", `/marketplace/businesses/${owner.businessId}/inventory`),
    "inventory",
  );
  return rows.filter((r) => (r.productId ?? r.product?.id) === productId).reduce((s, r) => s + Number(r.quantity ?? 0), 0);
}

/** The row of a list that holds `text`: the nearest table row, list item, option or card around it. */
function rowOf(scope: Page | Locator, text: string): Locator {
  return scope.locator("tr, li, [role=row], [role=listitem], [role=option], article").filter({ hasText: text }).last();
}

/** The owner puts products on the store from Your page's catalog ("Add to store"), each answered by the API. */
async function addToStore(page: Page, names: string[]): Promise<void> {
  await page.goto("/app/store?tab=catalog");
  await settle(page, 1_000);
  for (const name of names) {
    const row = rowOf(page, name);
    await expect(row, `Your page lists '${name}'`).toBeVisible();
    const done = page.waitForResponse((r) => ["POST", "PATCH", "PUT"].includes(r.request().method()) && r.status() < 400 && r.url().startsWith(API_URL));
    await row.getByRole("button", { name: /add to store/i }).click();
    await done;
    await expect(row.getByRole("button", { name: /remove from store/i }), `'${name}' is on the store`).toBeVisible();
  }
}

/** Presses a primary button, failing with what covers it when something does. */
async function press(button: Locator, what: string): Promise<void> {
  await expect(button, what).toBeVisible();
  expect(await coveredButtonFindings([{ what, locator: button }]), `${what} can be pressed`).toEqual([]);
  await button.click();
}

/**
 * The text of each catalog card on the store page that names `name` exactly:
 * one entry per card (the name's element, widened to the nearest ancestor that
 * also holds a button or a picture, as a product card does).
 */
async function cardTexts(page: Page, name: string): Promise<string[]> {
  return page.locator("main, body").first().evaluate((root, wanted) => {
    const named = Array.from(root.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && (el.textContent ?? "").replace(/\s+/g, " ").trim() === wanted && (el as HTMLElement).offsetParent !== null,
    );
    return named.map((el) => {
      // Up to the card: the nearest ancestor that also holds the card's own button (its Add, or a
      // disabled one when sold out), or an image (a card's picture, where stock badges sit).
      let card: Element = el;
      for (let up = 0; up < 10 && card.parentElement; up++) {
        card = card.parentElement;
        if (card.querySelector("button, img, [role=img]")) break;
      }
      return ((card as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
    });
  }, name);
}

/**
 * Puts a product in the cart from its card on the store: the card's Add (or its
 * detail's Add to Cart). The product's card is the one that is not a booking
 * (no "Service" label, no "30 min"): BUG-054 also lists each product as a service.
 */
async function putInCart(page: Page, name: string): Promise<void> {
  await expect(page.getByText(name, { exact: true }).first(), `the store lists '${name}'`).toBeVisible();
  const marked = await page.locator("body").evaluate((root, wanted) => {
    const leaves = Array.from(root.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && (el.textContent ?? "").replace(/\s+/g, " ").trim() === wanted && (el as HTMLElement).offsetParent !== null,
    );
    for (const leaf of leaves) {
      let card: Element = leaf;
      for (let up = 0; up < 10 && card.parentElement; up++) {
        card = card.parentElement;
        if (card.querySelector("button")) break;
      }
      const text = (card as HTMLElement).innerText ?? "";
      if (/\bservice\b|\b\d+\s*min\b/i.test(text)) continue;
      card.setAttribute("data-journey-card", "product");
      return true;
    }
    return false;
  }, name);
  expect(marked, `the store shows '${name}' as a product`).toBe(true);
  const card = page.locator('[data-journey-card="product"]').first();
  const add = card.getByRole("button", { name: /^add( to cart)?$/i });
  if (await add.count()) await add.first().click();
  else {
    await card.getByText(name, { exact: true }).first().click();
    await page.getByRole("button", { name: /^add to cart$/i }).filter({ visible: true }).first().click();
  }
  // A detail that stays open after the add is closed (its X, the backdrop, or Escape), so the cart can open.
  await page.waitForTimeout(500);
  const detail = page.getByRole("dialog").filter({ visible: true }).filter({ hasNot: page.getByRole("button", { name: /proceed to checkout/i }) });
  if (await detail.count()) {
    const close = detail.first().getByRole("button", { name: /^close$/i }).filter({ visible: true });
    if (await close.count()) await close.first().click().catch(() => {});
    else await page.keyboard.press("Escape");
    await expect(detail, "the item's detail closes").toHaveCount(0, { timeout: 5_000 }).catch(() => {});
  }
}

/** The open cart (the "Shopping cart" dialog), opening it when it is closed. */
async function openCart(page: Page): Promise<Locator> {
  const cart = page.getByRole("dialog", { name: /shopping cart|^(your )?cart$/i });
  if (!(await cart.isVisible().catch(() => false))) {
    const door = page.getByRole("button", { name: /open cart|^cart\b|view cart/i }).filter({ visible: true }).first();
    // A sheet still over the page (the item's detail at 375px is a bottom sheet with no dialog role) is
    // closed first: Escape, then a tap on its backdrop.
    for (const close of [() => page.keyboard.press("Escape"), () => page.mouse.click(5, 5)]) {
      if (await door.click({ trial: true, timeout: 3_000 }).then(() => true).catch(() => false)) break;
      await close();
      await page.waitForTimeout(500);
    }
    await door.click();
  }
  await expect(cart, "the cart opens").toBeVisible();
  return cart;
}

/** The cart line's increase control: a button named so, else the stepper's plus. */
function increaseOf(cart: Locator): Locator {
  return cart
    .getByRole("button", { name: /increase|add one|one more|^\+$|plus/i })
    .or(cart.locator("button:has(svg.lucide-plus)"))
    .first();
}

/** The quantity the cart line shows: an input's value, else the stepper's number. */
async function cartQuantity(cart: Locator): Promise<number> {
  return cart.evaluate((el) => {
    const input = el.querySelector('input[type="number"]') as HTMLInputElement | null;
    if (input) return Number(input.value);
    const numbers = Array.from(el.querySelectorAll("span, div, p"))
      .filter((n) => n.children.length === 0 && /^\d+$/.test((n.textContent ?? "").trim()))
      .map((n) => Number((n.textContent ?? "").trim()));
    return numbers.length ? Math.max(...numbers) : Number.NaN;
  });
}

/**
 * The customer's way from an open cart to the Payment step: Proceed to
 * Checkout, their details, Continue, the delivery address when asked, Continue.
 */
async function toPaymentStep(page: Page, customer: { first: string; last: string }): Promise<void> {
  const cart = await openCart(page);
  await cart.getByRole("button", { name: /proceed to checkout|checkout/i }).first().click();
  const input = (placeholder: string | RegExp) => page.getByPlaceholder(placeholder, typeof placeholder === "string" ? { exact: true } : undefined).filter({ visible: true }).first();
  await input("John").fill(customer.first);
  await input("Doe").fill(customer.last);
  await input("john@example.com").fill(`${customer.first.toLowerCase()}.${stamp()}@v62j.test.local`);
  const phone = page.getByPlaceholder(/555|868/).filter({ visible: true });
  if (await phone.count()) await phone.first().fill("+18687004321");
  await page.getByRole("button", { name: /^continue$/i }).filter({ visible: true }).first().click();
  const street = page.getByPlaceholder("123 Main Street").filter({ visible: true });
  await street.first().waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
  if (await street.count()) {
    await street.first().fill("5 Southern Main Road");
    const city = page.getByPlaceholder("Port of Spain").filter({ visible: true });
    if (await city.count()) await city.first().fill("Chaguanas");
    await page.getByRole("button", { name: /^continue$/i }).filter({ visible: true }).first().click();
  }
  await expect(page.getByRole("button", { name: /place order/i }).first(), "the Payment step").toBeVisible();
}

/** The methods the Payment step offers (its choices: buttons, radios, options, labels). */
async function paymentChoices(page: Page): Promise<string[]> {
  const choices = await page.locator("button, [role=radio], [role=option], label").filter({ visible: true }).allInnerTexts();
  return offeredPaymentMethods(choices.join("\n"));
}

/** Chooses cash, agrees to the terms when asked and places the order; resolves with the checkout's answer. */
async function placeCashOrder(page: Page, slug: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const cash = page.getByRole("button", { name: /cash/i }).or(page.getByRole("radio", { name: /cash/i })).or(page.getByText(/cash/i)).filter({ visible: true });
  if (await cash.count()) await cash.first().click();
  const terms = page.getByText(/i agree to the terms/i).filter({ visible: true });
  if (await terms.count()) await terms.first().click();
  const placed = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/site/storefront/public/${slug}/checkout`);
  // What covers Place Order is recorded (the store's checkout has no covered-button bullet of its own here; F9 holds it for bookings).
  const place = page.getByRole("button", { name: /place order/i }).first();
  const covered = await coveredButtonFindings([{ what: "Place Order", locator: place }]);
  if (covered.length) test.info().annotations.push({ type: "covered", description: covered.join("; ") });
  await place.click({ force: covered.length > 0 });
  const res = await placed;
  const text = await res.text();
  return { status: res.status(), body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

interface StoreOrder {
  id: string;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  total?: number;
  currency?: string;
  invoiceId?: string | null;
}

/** The business's store orders (the owner's orders read). */
async function storeOrders(request: APIRequestContext, owner: Tenant): Promise<StoreOrder[]> {
  return rowsOf<StoreOrder>(await api(request, owner, "GET", `/site/businesses/${owner.businessId}/orders`), "orders");
}

/** A customer's cash order of `qty` of `product`, placed on /book/<slug> in the customer's own browser. */
async function customerCashOrder(browser: Parameters<typeof anonymousContext>[0], slug: string, product: StockedProduct, qty: number, who: string) {
  const visitor = await anonymousContext(browser, { who });
  const shop = await visitor.newPage();
  await shop.goto(`/book/${slug}`);
  await settle(shop, 1_000);
  await putInCart(shop, product.name);
  const cart = await openCart(shop);
  for (let i = 1; i < qty; i++) await increaseOf(cart).click();
  await expect.poll(() => cartQuantity(cart), { message: `${qty} in the cart` }).toBe(qty);
  await toPaymentStep(shop, { first: "Keisha", last: `Buyer${stamp()}` });
  const placed = await placeCashOrder(shop, slug);
  expect(placed.status, `the cash order is placed: ${JSON.stringify(placed.body).slice(0, 300)}`).toBe(201);
  const order = (placed.body.order ?? placed.body) as StoreOrder & { customerName?: string };
  return { order, shop };
}

test.describe("journey G: sell online", () => {
  test.use({ tenantOptions: { sells: "products" } });

  test("G1 the store shows each listed product once, with its stock state", async ({ page, request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const slug = await seedStore(request, owner, "g1");
    const inStock = await seedStockedProduct(request, owner, `Pepper sauce ${stamp()}`, 35, [10]);
    const soldOut = await seedStockedProduct(request, owner, `Sorrel cordial ${stamp()}`, 20, [0]);

    await test.step("the owner adds both to the store from Your page", async () => {
      await addToStore(page, [inStock.name, soldOut.name]);
    });

    const visitor = await anonymousContext(browser, { who: "customer" });
    const shop = await visitor.newPage();
    await shop.goto(`/book/${slug}`);
    await settle(shop, 1_500);

    for (const [product, state, label] of [
      [inStock, /in stock|\bavailable\b|\b\d+\s+(?:left|in stock)\b/i, "in stock"],
      [soldOut, /out of stock|sold out/i, "out of stock"],
    ] as const) {
      await test.step(`'${product.name}' is shown once, ${label}`, async () => {
        const cards = await cardTexts(shop, product.name);
        test.info().annotations.push({ type: "cards", description: `${product.name}: ${JSON.stringify(cards)}` });
        expect.soft(cards.length, `cards naming '${product.name}' on /book/${slug} (BUG-054 lists a product twice): ${JSON.stringify(cards)}`).toBe(1);
        expect.soft(cards.some((c) => state.test(c)), `'${product.name}' shows its stock state (${label}): ${JSON.stringify(cards)}`).toBe(true);
      });
    }
  });

  test("G2 the product page renders from the storefront payload and calls no missing route", async ({ page, request, owner, browser }) => {
    test.setTimeout(4 * 60_000);
    const slug = await seedStore(request, owner, "g2");
    const product = await seedStockedProduct(request, owner, `Chadon beni pesto ${stamp()}`, 60, [12]);
    await addToStore(page, [product.name]);

    const visitor = await anonymousContext(browser, { who: "customer" });
    const shop = await visitor.newPage();
    const calls: Array<{ method: string; path: string; status: number }> = [];
    shop.on("response", (r) => {
      if (r.url().startsWith(`${API_URL}/`)) calls.push({ method: r.request().method(), path: new URL(r.url()).pathname, status: r.status() });
    });
    await shop.goto(`/book/${slug}/product/${product.id}`);
    await settle(shop, 1_500);

    await test.step("the page shows the product: its name, price and description", async () => {
      await expect(shop.getByRole("heading", { name: product.name }).first(), "the product's name as the page heading").toBeVisible();
      const text = (await shop.locator("body").innerText()).replace(/\s+/g, " ");
      expect.soft(text.includes(money(product.price)), `its price ${money(product.price)}`).toBe(true);
      expect.soft(text.includes(`${product.name}, made in Trinidad`), "its description").toBe(true);
    });

    await test.step("it is read from GET /site/storefront/public/<slug>, and no call answers 404 (a missing route)", async () => {
      test.info().annotations.push({ type: "product-page-calls", description: calls.map((c) => `${c.status} ${c.method} ${c.path}`).join("; ") });
      expect.soft(calls.some((c) => c.method === "GET" && c.path === `/site/storefront/public/${slug}` && c.status === 200), "the storefront payload is read").toBe(true);
      expect.soft(calls.filter((c) => c.status === 404).map((c) => `${c.method} ${c.path}`), "calls to routes the API does not have").toEqual([]);
    });
  });

  test("G3 the cart stops at the stock, and checkout refuses an oversell in plain words", async ({ page, request, owner, browser }) => {
    test.setTimeout(6 * 60_000);
    const slug = await seedStore(request, owner, "g3");
    // 10 in stock over two warehouses (6 + 4), as SWP-STORE-OVERSELL's case counts them.
    const product = await seedStockedProduct(request, owner, `Curry powder ${stamp()}`, 15, [6, 4]);
    await addToStore(page, [product.name]);
    expect(await onHand(request, owner, product.id), "10 on hand").toBe(10);

    await test.step("the cart's quantity stops at the 10 in stock", async () => {
      const visitor = await anonymousContext(browser, { who: "customer" });
      const shop = await visitor.newPage();
      await shop.goto(`/book/${slug}`);
      await settle(shop, 1_000);
      await putInCart(shop, product.name);
      const cart = await openCart(shop);
      const plus = increaseOf(cart);
      for (let i = 0; i < 14; i++) {
        if (!(await plus.isEnabled().catch(() => false))) break;
        await plus.click();
      }
      const qty = await cartQuantity(cart);
      test.info().annotations.push({ type: "cart-cap", description: `after 14 presses of + the cart holds ${qty}` });
      expect.soft(qty, "the cart's quantity, after pressing + 14 times from 1 (10 in stock)").toBeLessThanOrEqual(10);
    });

    await test.step("a checkout of 50 against the 10 in stock is refused in plain words, and writes no order", async () => {
      const before = (await storeOrders(request, owner)).length;
      const res = await request.post(`${API_URL}/site/storefront/public/${slug}/checkout`, {
        data: {
          items: [{ productId: product.id, quantity: 50 }],
          customer: { name: "Anil Persad", email: `anil.${stamp()}@v62j.test.local`, phone: "+18687009876" },
          paymentMethod: "CASH",
        },
      });
      const text = await res.text();
      test.info().annotations.push({ type: "oversell", description: `${res.status()} ${text.slice(0, 300)}` });
      expect.soft(res.status(), `the checkout of 50 answers a refusal (BUG-017: 201, the order confirmed): ${text.slice(0, 300)}`).toBeGreaterThanOrEqual(400);
      expect.soft(res.status(), "the refusal is not a server error").toBeLessThan(500);
      let message = "";
      try {
        message = String((JSON.parse(text) as { message?: unknown }).message ?? "");
      } catch {
        message = text;
      }
      expect.soft(message, "the refusal names the product").toContain(product.name);
      expect.soft(message, "the refusal carries no internal id").not.toMatch(ROW_ID);
      expect.soft((await storeOrders(request, owner)).length, "no order is written for the oversell").toBe(before);
      expect.soft(await onHand(request, owner, product.id), "the stock is untouched").toBe(10);
    });

    await test.step("the checkout screen refuses an oversell in plain words when the stock drops under the cart", async () => {
      // A customer has 5 in the cart and reaches the Payment step; meanwhile the owner counts the stock down to 3
      // (Inventory's adjustment: 6 -> 0 and 4 -> 3). Place Order must then be refused on the screen.
      const visitor = await anonymousContext(browser, { who: "customer, stock dropped" });
      const shop = await visitor.newPage();
      await shop.goto(`/book/${slug}`);
      await settle(shop, 1_000);
      await putInCart(shop, product.name);
      const cart = await openCart(shop);
      for (let i = 1; i < 5; i++) await increaseOf(cart).click();
      await expect.poll(() => cartQuantity(cart), { message: "5 in the cart" }).toBe(5);
      await toPaymentStep(shop, { first: "Anil", last: `Persad${stamp()}` });
      for (const [stockId, change] of [
        [product.stockIds[0], -6],
        [product.stockIds[1], -1],
      ] as const) {
        await api(request, owner, "POST", `/marketplace/businesses/${owner.businessId}/inventory/adjust`, { stockId, quantityChange: change, reasonCode: "COUNT_CORRECTION" });
      }
      expect(await onHand(request, owner, product.id), "3 on hand now").toBe(3);
      const before = (await storeOrders(request, owner)).length;

      // The customer chooses cash, agrees to the terms when asked, and presses the screen's own Place Order. A
      // checkout that refuses before the order is sent (Place Order disabled, the shortfall shown) is a refusal too.
      const cash = shop.getByRole("button", { name: /cash/i }).or(shop.getByRole("radio", { name: /cash/i })).or(shop.getByText(/cash/i)).filter({ visible: true });
      if (await cash.count()) await cash.first().click();
      const terms = shop.getByText(/i agree to the terms/i).filter({ visible: true });
      if (await terms.count()) await terms.first().click();
      const place = shop.getByRole("button", { name: /place order/i }).first();
      const pressable = await expect(place).toBeEnabled({ timeout: 3_000 }).then(() => true).catch(() => false);
      let answered = "not sent: Place Order is not pressable";
      if (pressable) {
        const placed = shop.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/site/storefront/public/${slug}/checkout`, { timeout: 30_000 }).catch(() => null);
        await place.click();
        const res = await placed;
        if (res) {
          answered = `${res.status()} ${(await res.text().catch(() => "")).slice(0, 300)}`;
          expect.soft(res.status(), `the checkout of 5 against 3 (BUG-017): ${answered}`).toBeGreaterThanOrEqual(400);
          expect.soft(res.status(), "the refusal is not a server error").toBeLessThan(500);
        }
      }
      test.info().annotations.push({ type: "oversell-screen", description: answered });
      const OVERSELL_REFUSAL = /only \d+ (?:left|in stock|available)|not enough|out of stock|sold out|no longer available|(?:is|are)n['’]?t available|not available|insufficient|exceeds? (?:the )?(?:available )?stock|more than (?:we have|(?:is|are) (?:in stock|available))/i;
      // Anywhere on the screen: the step's own text, a dialog, or a toast (the root sonner toaster).
      const notice = shop.getByText(OVERSELL_REFUSAL).filter({ visible: true }).first();
      await expect.soft(notice, "the checkout screen says, in plain words, that there is not enough stock").toBeVisible({ timeout: 10_000 });
      if (await notice.count()) expect.soft(await notice.innerText(), "the screen's refusal carries no internal id").not.toMatch(ROW_ID);
      await expect.soft(shop.getByText(/order (placed|confirmed)|thank you for your order|order received/i), "no order confirmation on the screen").toHaveCount(0);
      expect.soft((await storeOrders(request, owner)).length, "no order is written for the oversell").toBe(before);
      expect.soft(await onHand(request, owner, product.id), "the stock is untouched by the refused order").toBe(3);
    });
  });

  test("G4 only the payment methods Settings > Getting paid enables are offered at checkout", async ({ page, request, owner, browser }) => {
    test.setTimeout(6 * 60_000);
    const slug = await seedStore(request, owner, "g4");
    const product = await seedStockedProduct(request, owner, `Tamarind balls ${stamp()}`, 12, [30]);
    await addToStore(page, [product.name]);
    /** Saves Settings > Getting paid as payments-tab.tsx's Save does (the metaData keys it writes), and reads it back. */
    const gettingPaid = async (methods: { cashEnabled: boolean; bankTransferEnabled: boolean }) => {
      const bank = methods.bankTransferEnabled ? { bankName: "Republic Bank", bankAccountNumber: String(Date.now()).slice(-10) } : {};
      await api(request, owner, "PATCH", `/identity/businesses/${owner.businessId}`, { metaData: { ...methods, ...bank } });
      const read = await api<{ metaData?: Record<string, unknown> }>(request, owner, "GET", `/identity/businesses/${owner.businessId}`);
      expect({ cashEnabled: read.metaData?.cashEnabled, bankTransferEnabled: read.metaData?.bankTransferEnabled }, "Getting paid, as stored").toEqual(methods);
    };
    const offered = async (who: string): Promise<string[]> => {
      const visitor = await anonymousContext(browser, { who });
      const shop = await visitor.newPage();
      await shop.goto(`/book/${slug}`);
      await settle(shop, 1_000);
      await putInCart(shop, product.name);
      await toPaymentStep(shop, { first: "Devi", last: `Shopper${stamp()}` });
      return paymentChoices(shop);
    };

    await test.step("Getting paid: bank transfer on, cash off; the checkout offers bank transfer only", async () => {
      await gettingPaid({ cashEnabled: false, bankTransferEnabled: true });
      const methods = await offered("customer, bank transfer on");
      test.info().annotations.push({ type: "methods", description: `bank transfer on, cash off: ${methods.join(", ") || "none"}` });
      expect.soft(methods.filter((m) => m === "paypal"), "PayPal on a TTD store with no PayPal keys").toEqual([]);
      expect.soft(methods, "the methods offered are exactly those Getting paid enables").toEqual(["bank transfer"]);
    });

    await test.step("Getting paid: cash on, bank transfer off; the checkout offers cash only", async () => {
      await gettingPaid({ cashEnabled: true, bankTransferEnabled: false });
      const methods = await offered("customer, cash on");
      test.info().annotations.push({ type: "methods", description: `cash on, bank transfer off: ${methods.join(", ") || "none"}` });
      expect.soft(methods.filter((m) => m === "paypal"), "PayPal on a TTD store with no PayPal keys").toEqual([]);
      expect.soft(methods, "the methods offered are exactly those Getting paid enables").toEqual(["cash"]);
    });
  });

  test("G5 a paid order has an invoice, a payment and ledger postings, including COGS", async ({ page, request, owner, browser }) => {
    test.setTimeout(6 * 60_000);
    const slug = await seedStore(request, owner, "g5");
    const product = await seedStockedProduct(request, owner, `Coconut drops ${stamp()}`, 25, [20], 10);
    await addToStore(page, [product.name]);
    const { order } = await customerCashOrder(browser, slug, product, 2, "customer");
    expect(order.id, "the order the checkout wrote").toBeTruthy();

    await test.step("the owner records the cash (Complete offline)", async () => {
      await api(request, owner, "POST", `/site/businesses/${owner.businessId}/orders/${order.id}/complete-offline`, {});
    });

    let invoiceId = "";
    let paymentIds: string[] = [];
    await test.step("the paid order has its invoice (PAID, the order's total), a payment, and stock down by 2", async () => {
      const read = await api<StoreOrder & { orderNumber: string; metadata?: Record<string, unknown> | null }>(request, owner, "GET", `/site/businesses/${owner.businessId}/orders/${order.id}`);
      expect(read.paymentStatus, "the order is paid").toBe("PAID");
      // The order's invoice: the one it names, else the one that names it (its number, INV-<order number>, or its notes).
      const named = read.invoiceId ?? (read.metadata?.invoiceId as string | undefined) ?? null;
      const invoices = rowsOf<{ id: string; invoiceNumber: string; notes?: string | null }>(
        await api(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices?pageSize=200`),
        "invoices",
      );
      const found = named ? invoices.find((i) => i.id === named) : invoices.find((i) => i.invoiceNumber.includes(read.orderNumber) || (i.notes ?? "").includes(read.orderNumber));
      expect(found, `an invoice for order ${read.orderNumber} (invoices: ${invoices.map((i) => i.invoiceNumber).join(", ")})`).toBeTruthy();
      invoiceId = found!.id;
      const invoice = await api<{ status: string; total: number }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoiceId}`);
      expect(invoice.status).toBe("PAID");
      expect(Number(invoice.total), "the invoice is for the order's total").toBe(50);
      const payments = rowsOf<{ id: string; amount: number; status: string }>(
        await api(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoiceId}/payments`),
        "payments",
      );
      const settled = payments.filter((p) => /succe|paid|complete/i.test(p.status));
      paymentIds = settled.map((p) => p.id);
      expect(settled.map((p) => Number(p.amount)), "one payment of 50").toEqual([50]);
      expect(await onHand(request, owner, product.id), "20 less the 2 sold").toBe(18);
    });

    await test.step("the ledger posts the sale and its COGS (2 x 10)", async () => {
      const gl = await api<{ rows: Array<{ accountType: string; accountName: string; debit: string | number; credit: string | number; sourceType: string | null; sourceId: string | null; reference: string | null }> }>(
        request,
        owner,
        "GET",
        `/finance/businesses/${owner.businessId}/general-ledger?pageSize=500`,
      );
      const ids = new Set([order.id, invoiceId, ...paymentIds].filter(Boolean));
      const mine = gl.rows.filter((r) => ids.has(r.sourceId ?? "") || [...ids].some((id) => (r.reference ?? "").includes(id)));
      test.info().annotations.push({ type: "postings", description: mine.map((r) => `${r.sourceType} ${r.accountType} ${r.accountName} Dr ${r.debit} Cr ${r.credit}`).join("; ") });
      const revenue = mine.filter((r) => ["REVENUE", "INCOME"].includes(r.accountType)).reduce((s, r) => s + Number(r.credit) - Number(r.debit), 0);
      const cogs = mine.filter((r) => r.accountType === "COGS").reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);
      expect.soft(revenue, "revenue posted for the sale").toBe(50);
      expect.soft(cogs, "COGS posted for the 2 units at 10").toBe(20);
    });
  });

  test("G6 the owner is alerted of a paid order (push, else email)", { tag: "@staging" }, async ({ page, request, owner, browser }) => {
    // GATE-STAGING-RUN: the owner's device subscribed to push (or none, for the email fallback) and a sandbox mailbox.
    test.setTimeout(6 * 60_000);
    const slug = await seedStore(request, owner, "g6");
    const product = await seedStockedProduct(request, owner, `Kurma ${stamp()}`, 18, [10]);
    await addToStore(page, [product.name]);
    const { order } = await customerCashOrder(browser, slug, product, 1, "customer");
    await api(request, owner, "POST", `/site/businesses/${owner.businessId}/orders/${order.id}/complete-offline`, {});
    const mailbox = process.env.E2E_STAGING_MAILBOX_URL ?? "";
    expect(mailbox, "E2E_STAGING_MAILBOX_URL (GATE-STAGING-RUN) reads the owner's alert").not.toBe("");
    await expect
      .poll(async () => {
        const res = await request.get(`${mailbox}?to=${encodeURIComponent(owner.email)}&kind=alert`);
        return res.ok() ? JSON.stringify(await res.json()) : "";
      }, { timeout: 60_000, message: "the owner's paid-order alert arrives within a minute" })
      .toMatch(/order|paid/i);
  });

  test("G7 the order shows in Sales > Orders with its number, customer, items and total in the business currency", async ({ page, request, owner, browser }) => {
    test.setTimeout(6 * 60_000);
    const slug = await seedStore(request, owner, "g7");
    const product = await seedStockedProduct(request, owner, `Benne balls ${stamp()}`, 17.5, [10]);
    await addToStore(page, [product.name]);
    const { order } = await customerCashOrder(browser, slug, product, 2, "customer");
    const read = await api<StoreOrder & { customerName?: string; customer?: { name?: string } }>(request, owner, "GET", `/site/businesses/${owner.businessId}/orders/${order.id}`);

    await test.step("Sales has an Orders tab", async () => {
      await page.goto("/app/commerce");
      await settle(page, 1_000);
      const tab = page.getByRole("tab", { name: /^orders/i }).or(page.getByRole("link", { name: /^orders/i })).or(page.getByRole("button", { name: /^orders/i })).filter({ visible: true });
      await expect(tab.first(), "Sales > Orders (SALES-ORDERS-TAB)").toBeVisible();
      await tab.first().click();
      await settle(page, 1_000);
    });

    await test.step("the order's row names its number, customer, items and total in TTD", async () => {
      const number = read.orderNumber ?? order.orderNumber ?? order.id;
      const main = page.locator("main").first();
      await expect(main.getByText(number).first(), `Sales > Orders lists order ${number}`).toBeVisible();
      // The order's row: the innermost block showing its number (a table row, list item or card), widened to hold its items too.
      const row = main.locator("tr, li, [role=row], [role=listitem], article, div").filter({ hasText: number }).filter({ hasText: product.name }).last();
      await expect(row, `the row of order ${number} names its items`).toBeVisible();
      const text = (await row.innerText()).replace(/\s+/g, " ");
      expect.soft(text, "the customer").toMatch(/Keisha/);
      expect.soft(text, "the items").toContain(product.name);
      expect.soft(text, "the total in the business currency, with separators (BUG-105: '$35.00')").toMatch(new RegExp(`(TTD|TT\\$)\\s?${escapeRe(money(35))}`));
    });
  });

  test("G8 an offline store says 'temporarily unavailable'", async ({ page, request, owner, browser }) => {
    test.setTimeout(4 * 60_000);
    const slug = await seedStore(request, owner, "g8");

    await test.step("the owner takes the store offline from Your page", async () => {
      await page.goto("/app/store");
      await settle(page, 1_000);
      const off = page
        .getByRole("button", { name: /take offline|go offline|unpublish/i })
        .or(page.getByRole("switch", { name: /online|offline|store (is )?(live|open)|accepting orders/i }))
        .filter({ visible: true });
      await expect(off.first(), "Your page's online/offline switch").toBeVisible();
      const saved = page.waitForResponse((r) => ["PATCH", "PUT", "POST"].includes(r.request().method()) && r.url().startsWith(API_URL) && r.status() < 400);
      await off.first().click();
      const confirm = page.getByRole("dialog").getByRole("button", { name: /^(take offline|confirm|yes)/i }).filter({ visible: true });
      if (await confirm.count()) await confirm.first().click();
      await saved;
      const read = await api<{ storeEnabled?: boolean }>(request, owner, "GET", `/identity/businesses/${owner.businessId}`);
      expect(read.storeEnabled, "the store is offline").toBe(false);
    });

    await test.step("the customer reads 'temporarily unavailable', not 'Page Not Found'", async () => {
      const visitor = await anonymousContext(browser, { who: "customer" });
      const shop = await visitor.newPage();
      await shop.goto(`/book/${slug}`);
      await settle(shop, 1_000);
      await expect.soft(shop.getByText(/temporarily unavailable/i).first(), "'temporarily unavailable' (BUG-109: 'Page Not Found')").toBeVisible();
      await expect.soft(shop.getByText(/page not found|could not be found/i), "no 'Page Not Found'").toHaveCount(0);
    });
  });

  test("G9 the in-app preview and the /widgets/* embeds render; the full booking page frames only inside the app", async ({ page, request, owner, browser, baseURL }) => {
    test.setTimeout(5 * 60_000);
    const slug = await seedStore(request, owner, "g9");
    const product = await seedStockedProduct(request, owner, `Guava cheese ${stamp()}`, 22, [10]);
    await addToStore(page, [product.name]);
    const web = new URL(baseURL ?? "http://127.0.0.1:5000");

    await test.step("Your page's preview shows the store", async () => {
      await page.goto("/app/store");
      await settle(page, 1_000);
      const preview = page.locator(`iframe[src*="/book/${slug}"]`);
      for (const tab of [/^share/i, /^launch/i, /^design/i, /preview/i]) {
        if (await preview.count()) break;
        const door = page.getByRole("tab", { name: tab }).or(page.getByRole("button", { name: tab })).filter({ visible: true });
        if (await door.count()) {
          await door.first().click();
          await settle(page, 1_000);
        }
      }
      await expect(preview.first(), `Your page has a preview of /book/${slug}`).toBeAttached();
      await expect.soft(page.frameLocator(`iframe[src*="/book/${slug}"]`).first().getByText(product.name).first(), "the preview shows the store (BUG-056: blank, X-Frame-Options DENY)").toBeVisible({ timeout: 30_000 });
    });

    // Another website: a real site on this machine, another origin (a loopback server of the test's own, named
    // localhost; the app is 127.0.0.1, or the reverse). Not a page Playwright fulfils: such a page has no
    // address, so Chromium's local-network checks block every frame on it that points at the app
    // (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS), the embeds included, whatever the app's headers say.
    const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const server: Server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://another.site").searchParams.get("path") ?? "/";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body><h1>Another site</h1><iframe id="kf" src="${attr(`${web.origin}${path}`)}" width="420" height="700"></iframe></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const otherSite = `http://${web.hostname === "localhost" ? "127.0.0.1" : "localhost"}:${(server.address() as AddressInfo).port}`;
    try {
      const visitor: BrowserContext = await anonymousContext(browser, { who: "another website" });
      const site = await visitor.newPage();
      /**
       * What another website's frame of `path` comes to, and the app's answer (its headers): "refused" when the
       * browser refused to frame it (the frame's load blocked by its response, or Chrome's error page),
       * "rendered" once the frame shows `shows`, "still loading" when neither happens in 30 s; any other failed
       * load is named. Never judged by text that has not loaded yet.
       */
      const framed = async (path: string, shows: RegExp): Promise<{ verdict: string; text: string; headers: Record<string, string> | null }> => {
        const target = `${web.origin}${path}`;
        let failure = "";
        const onFailed = (r: Request) => {
          if (r.url() === target && r.resourceType() === "document") failure = r.failure()?.errorText ?? "failed";
        };
        site.on("requestfailed", onFailed);
        const answer = site.waitForResponse((r) => r.url() === target && r.request().resourceType() === "document", { timeout: 30_000 }).catch(() => null);
        await site.goto(`${otherSite}/embed?path=${encodeURIComponent(path)}`);
        const res = await answer;
        let verdict = "still loading";
        let text = "";
        for (const until = Date.now() + 30_000; Date.now() < until; ) {
          if (failure) {
            verdict = /ERR_BLOCKED_BY_RESPONSE/.test(failure) ? "refused" : `failed (${failure})`;
            break;
          }
          const frame = site.frames().find((f) => f !== site.mainFrame());
          if (frame?.url().startsWith("chrome-error:")) {
            verdict = "refused";
            break;
          }
          if (frame && frame.url().startsWith(web.origin)) {
            text = (await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "")).replace(/\s+/g, " ");
            if (shows.test(text)) {
              verdict = "rendered";
              break;
            }
          }
          await site.waitForTimeout(500);
        }
        site.off("requestfailed", onFailed);
        test.info().annotations.push({ type: "framed", description: `${path}: ${verdict}; X-Frame-Options ${res?.headers()["x-frame-options"] ?? "none"}; CSP ${res?.headers()["content-security-policy"] ?? "none"}` });
        return { verdict, text, headers: res ? res.headers() : null };
      };

      await test.step("another website frames /widgets/cart/<slug> and /widgets/booking/<slug>", async () => {
        const cart = await framed(`/widgets/cart/${slug}`, /order now|checkout|add/i);
        expect.soft(cart.verdict, `the cart widget renders inside another site (BUG-056: X-Frame-Options DENY; it shows '${cart.text.slice(0, 120)}')`).toBe("rendered");
        const booking = await framed(`/widgets/booking/${slug}`, /book/i);
        expect.soft(booking.verdict, `the booking widget renders inside another site (it shows '${booking.text.slice(0, 120)}')`).toBe("rendered");
      });

      await test.step("the full booking page does not render inside another website (framing ruling D-186)", async () => {
        // Judged by the page's own answer and by the browser, never by absent text: /book is a client page that
        // renders the catalog only after hydration and a storefront read.
        const docPath = `/book/${slug}`;
        const full = await framed(docPath, new RegExp(escapeRe(product.name)));
        expect.soft(full.headers, `the framed ${docPath} answers`).not.toBeNull();
        const headers = full.headers ?? {};
        expect
          .soft(framingRefused(headers, otherSite, web.origin), `${docPath}'s answer forbids another site to frame it (X-Frame-Options ${headers["x-frame-options"] ?? "none"}; CSP ${headers["content-security-policy"] ?? "none"})`)
          .toBe(true);
        expect.soft(full.verdict, "the browser refuses to frame the full booking page for another site").toBe("refused");
      });
    } finally {
      server.close();
    }
  });

  test("G10 no unearned badge on the store page", async ({ request, owner, browser }) => {
    test.setTimeout(3 * 60_000);
    const slug = await seedStore(request, owner, "g10");
    // No opening hours are set: nothing on the page may say the business is open now.
    const visitor = await anonymousContext(browser, { who: "customer" });
    const shop = await visitor.newPage();
    await shop.goto(`/book/${slug}`);
    await settle(shop, 1_500);
    const text = (await shop.locator("body").innerText()).replace(/\s+/g, " ");
    const unearned = ["Verified Business", "Instant Booking", "Guaranteed by KeyFlowOS", "Open Now"].filter((badge) => new RegExp(escapeRe(badge), "i").test(text));
    expect(unearned, "badges the business has not earned (no verification, no guarantee, no hours set)").toEqual([]);
  });

  test("G11 /site/<slug> redirects to /book/<slug>, also for a business that published a page in the old builder", async ({ request, owner, browser }) => {
    test.setTimeout(3 * 60_000);
    const slug = await seedStore(request, owner, "g11");

    await test.step("the business has a page published in the old builder", async () => {
      await api(request, owner, "PUT", `/site/presence/businesses/${owner.businessId}/draft`, {
        payload: { hero: { headline: `${owner.businessName}: hot sauces` }, sections: [] },
      });
      await api(request, owner, "POST", `/site/presence/businesses/${owner.businessId}/publish`, {});
      const pub = await request.get(`${API_URL}/site/presence/public/${slug}`);
      expect(pub.status(), "the published page is public").toBe(200);
    });

    await test.step("a customer opening /site/<slug> lands on /book/<slug>", async () => {
      const visitor = await anonymousContext(browser, { who: "customer" });
      const shop = await visitor.newPage();
      const res = await shop.goto(`/site/${slug}`);
      await settle(shop, 500);
      test.info().annotations.push({ type: "site-redirect", description: `${res?.status()} ${shop.url()}` });
      expect(new URL(shop.url()).pathname, "/site/<slug> ends on /book/<slug>").toBe(`/book/${slug}`);
    });
  });
});
