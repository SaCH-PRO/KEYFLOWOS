import {
  test,
  expect,
  API_URL,
  anonymousContext,
  coveredButtonFindings,
  settle,
  type Tenant,
} from "./journey-helpers";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/**
 * GATE-JOURNEYS-G-L, journey L: quick counter sale (product audit
 * core_journeys_v1 L; quicksale ruling D-155: include it in v1; plans ruling
 * D-160: quick sales do not count toward the invoice cap; whatsapp ruling
 * D-153). Each bullet of L's definition of done is a test (L1..L7), on both
 * journey projects, in every variant (README.md in this folder).
 *
 *   L1  From + New > Quick sale, the owner picks items and quantities and takes
 *       cash or a bank transfer; naming a customer is optional (a cash sale with
 *       no customer; a bank-transfer sale naming one).
 *   L2  The sale completes in one confirm (one press, one write, no second step).
 *   L3  Stock goes down, and the ledger posts the sale and its COGS.
 *   L4  A receipt link can be shared by WhatsApp or shown as a QR code, and the
 *       customer can open it.
 *   L5  The sale appears in Sales > Orders and in Money > Money in.
 *   L6  It counts toward plan limits as the plan table says: a quick sale does
 *       not count toward the invoice cap (GET .../check-limit/invoices).
 *   L7  It works at 375px: the phone project runs the whole sale, and no
 *       primary button is covered.
 *
 * Doors (QUICK-SALE-WEB, QUICK-SALE-SERVER, SALES-ORDERS-TAB): the header's
 * "New" menu (the "+ New" of the phone's bottom bar) has "Quick sale", which
 * opens one screen (/app/commerce/quick-sale) listing the catalog; each item is
 * picked by its name and its quantity set with a quantity field or + / -; the
 * payment method is a choice named Cash or Bank transfer; the customer is an
 * optional choice; one button ("Complete sale", "Take payment", "Charge" or
 * "Confirm sale") completes it through POST .../quick-sales and shows the
 * receipt with WhatsApp and a QR code. Sales > Orders is the Orders tab of
 * /app/commerce; Money > Money in is reached as journey H reaches it.
 *
 * The catalog is made through the API (products with tracked stock at a unit
 * cost, as Sales > Products and Inventory make them).
 *
 * RED at the GATE-JOURNEYS-A-F head (e63bcb1a), observed on both projects in
 * the ai-disabled and key-disabled variants (the packet return holds the
 * report): every test stops at its first step, because quick sale is not
 * built (the headline): "+ New" offers Contact, Invoice, Quote, Event,
 * Booking, Expense, Project and Flow, and no Quick sale; neither apps/web nor
 * apps/server has a quick-sale screen or route. L7 runs on the phone project
 * only (skipped on a desktop).
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST" | "PATCH",
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

interface Item {
  id: string;
  name: string;
  price: number;
}

/** A product with `stock` tracked units at `cost` a unit, in a warehouse of its own. */
async function seedItem(request: APIRequestContext, owner: Tenant, name: string, price: number, stock: number, cost: number): Promise<Item> {
  const product = await api<{ id: string; name: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, {
    name,
    price,
    currency: owner.currency,
    category: "PRODUCT",
    inventoryMode: "tracked",
  });
  const warehouse = await api<{ id: string }>(request, owner, "POST", `/marketplace/businesses/${owner.businessId}/warehouses`, { name: `Counter ${stamp()}` });
  await api(request, owner, "POST", `/marketplace/businesses/${owner.businessId}/inventory`, { productId: product.id, warehouseId: warehouse.id, quantity: stock, costPerUnit: cost, currency: owner.currency });
  return { id: product.id, name: product.name, price };
}

async function onHand(request: APIRequestContext, owner: Tenant, productId: string): Promise<number> {
  const rows = rowsOf<{ productId?: string; product?: { id?: string }; quantity?: number }>(await api(request, owner, "GET", `/marketplace/businesses/${owner.businessId}/inventory`), "inventory");
  return rows.filter((r) => (r.productId ?? r.product?.id) === productId).reduce((s, r) => s + Number(r.quantity ?? 0), 0);
}

/** Presses a primary button, failing with what covers it when something does. */
async function press(button: Locator, what: string): Promise<void> {
  await expect(button, what).toBeVisible();
  expect(await coveredButtonFindings([{ what, locator: button }]), `${what} can be pressed`).toEqual([]);
  await button.click();
}

/** + New > Quick sale: the header's New (the phone's + New) and its Quick sale entry. */
async function openQuickSale(page: Page): Promise<void> {
  await page.goto("/app/command-center");
  // The shell may open the KEY drawer by itself 2 s after Today loads (journey K reports it): let it, then close it.
  await settle(page);
  await page.getByRole("heading", { name: /^KEY$/ }).first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  const closeKey = page.getByRole("button", { name: /^close chat$/i }).filter({ visible: true });
  if (await closeKey.count()) await closeKey.first().click();
  await page.getByRole("heading", { name: /^KEY$/ }).first().waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  await press(page.getByRole("button", { name: /^(\+ ?)?new\b/i }).filter({ visible: true }).first(), "+ New");
  const entry = page.getByRole("menuitem", { name: /quick sale/i }).or(page.getByRole("link", { name: /quick sale/i })).or(page.getByRole("button", { name: /quick sale/i })).filter({ visible: true });
  const offered = await page.getByRole("menuitem").or(page.getByRole("link")).filter({ visible: true }).allInnerTexts();
  await expect(entry.first(), `+ New offers Quick sale (it offers ${JSON.stringify(offered.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 20))})`).toBeVisible();
  await entry.first().click();
  await settle(page, 1_000);
}

/** Picks `qty` of an item on the quick-sale screen: its quantity field, else its + (the first press adds it). */
async function pickItem(page: Page, item: Item, qty: number): Promise<void> {
  const search = page.getByRole("searchbox").or(page.getByPlaceholder(/search|find|item|product/i)).filter({ visible: true });
  if (await search.count()) await search.first().fill(item.name);
  const row = page.locator("li, [role=listitem], [role=row], tr, article, div").filter({ hasText: item.name }).filter({ has: page.locator("button, input") }).last();
  await expect(row, `the quick sale lists '${item.name}'`).toBeVisible();
  const qtyField = row.getByRole("spinbutton").or(row.locator('input[type="number"]')).filter({ visible: true });
  if (await qtyField.count()) {
    if ((await qtyField.first().inputValue().catch(() => "")) === "") await row.click();
    await qtyField.first().fill(String(qty));
    return;
  }
  const plus = row.getByRole("button", { name: /add|increase|^\+$|plus/i }).or(row.locator("button:has(svg.lucide-plus)")).first();
  for (let i = 0; i < qty; i++) await plus.click();
}

interface QuickSaleResult {
  status: number;
  body: Record<string, unknown>;
  confirms: number;
}

/**
 * A quick sale on the screen: the items, the method (Cash or Bank transfer), a
 * customer only when named, and the one confirm. Resolves with the write's
 * answer and how many confirm presses it took.
 */
async function quickSale(page: Page, items: Array<[Item, number]>, method: "cash" | "bank transfer", customer?: string): Promise<QuickSaleResult> {
  await openQuickSale(page);
  for (const [item, qty] of items) await pickItem(page, item, qty);
  const way = method === "cash" ? /^cash$/i : /^bank transfer$/i;
  const choice = page.getByRole("radio", { name: way }).or(page.getByRole("button", { name: way })).or(page.getByRole("tab", { name: way })).filter({ visible: true });
  await expect(choice.first(), `the quick sale takes ${method}`).toBeVisible();
  await choice.first().click();
  if (customer) {
    const pick = page.getByRole("combobox", { name: /customer/i }).or(page.getByPlaceholder(/customer/i)).filter({ visible: true }).first();
    await pick.fill(customer.split(" ").at(-1)!);
    await page.getByRole("option", { name: new RegExp(customer) }).first().click();
  }
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /quick-sales?/.test(new URL(r.url()).pathname)) writes.push(r.url());
  });
  const done = page.waitForResponse((r) => r.request().method() === "POST" && /quick-sales?$/.test(new URL(r.url()).pathname));
  await press(page.getByRole("button", { name: /^(complete sale|take payment|charge|confirm sale|record sale)/i }).filter({ visible: true }).first(), "the quick sale's confirm");
  const res = await done;
  const text = await res.text();
  await page.waitForTimeout(1_000);
  return { status: res.status(), body: (text ? JSON.parse(text) : {}) as Record<string, unknown>, confirms: writes.length };
}

/** The sale's order: its id and number, from the quick sale's answer. */
function orderOf(result: QuickSaleResult): { id: string; orderNumber: string; invoiceId?: string } {
  const order = (result.body.order ?? result.body) as { id: string; orderNumber: string; invoiceId?: string };
  return order;
}

test.describe("journey L: quick counter sale", () => {
  test.use({ tenantOptions: { sells: "products" } });

  test("L1 + New > Quick sale: pick items and quantities, take cash or a bank transfer; a customer is optional", async ({ page, request, owner }) => {
    test.setTimeout(6 * 60_000);
    const doubles = await seedItem(request, owner, `Doubles ${stamp()}`, 6, 50, 2);
    const juice = await seedItem(request, owner, `Sorrel juice ${stamp()}`, 12, 30, 5);
    const last = `Walkin${stamp()}`;
    await api(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, { firstName: "Ravi", lastName: last });

    await test.step("a cash sale, no customer named: 3 doubles and 2 juices", async () => {
      const sale = await quickSale(page, [[doubles, 3], [juice, 2]], "cash");
      expect(sale.status, JSON.stringify(sale.body).slice(0, 300)).toBe(201);
      const order = orderOf(sale);
      const read = await api<{ items?: Array<{ productId: string; quantity: number }>; total?: number; paymentStatus?: string; paymentMethod?: string }>(
        request,
        owner,
        "GET",
        `/site/businesses/${owner.businessId}/orders/${order.id}`,
      );
      expect(read.items?.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) }))).toEqual(
        expect.arrayContaining([
          { productId: doubles.id, quantity: 3 },
          { productId: juice.id, quantity: 2 },
        ]),
      );
      expect(Number(read.total), "3 x 6 + 2 x 12").toBe(42);
      expect(read.paymentStatus, "paid at the counter").toBe("PAID");
    });

    await test.step("a bank-transfer sale naming the customer", async () => {
      const sale = await quickSale(page, [[juice, 1]], "bank transfer", `Ravi ${last}`);
      expect(sale.status, JSON.stringify(sale.body).slice(0, 300)).toBe(201);
      const read = await api<{ customerName?: string; paymentMethod?: string }>(request, owner, "GET", `/site/businesses/${owner.businessId}/orders/${orderOf(sale).id}`);
      expect(read.customerName ?? "", "the named customer").toContain(last);
      expect(String(read.paymentMethod ?? ""), "the method taken").toMatch(/bank|transfer/i);
    });
  });

  test("L2 the sale completes in one confirm", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const item = await seedItem(request, owner, `Pholourie ${stamp()}`, 5, 40, 1);
    const sale = await quickSale(page, [[item, 4]], "cash");
    expect(sale.status).toBe(201);
    expect(sale.confirms, "one write for one press").toBe(1);
    await expect(page.getByRole("dialog").getByRole("button", { name: /^(confirm|yes|ok)$/i }).filter({ visible: true }), "no second confirm step").toHaveCount(0);
    await expect(page.getByText(/sale (complete|recorded|done)|receipt|paid/i).first(), "the sale is done: its receipt shows").toBeVisible();
  });

  test("L3 stock goes down, and the ledger posts the sale and its COGS", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const item = await seedItem(request, owner, `Coconut bake ${stamp()}`, 15, 10, 8);
    const sale = await quickSale(page, [[item, 3]], "cash");
    expect(sale.status).toBe(201);
    const order = orderOf(sale);
    expect(await onHand(request, owner, item.id), "10 less the 3 sold").toBe(7);
    const gl = await api<{ rows: Array<{ accountType: string; debit: string | number; credit: string | number; sourceId: string | null; reference: string | null }> }>(
      request,
      owner,
      "GET",
      `/finance/businesses/${owner.businessId}/general-ledger?pageSize=500`,
    );
    const payments = order.invoiceId
      ? rowsOf<{ id: string }>(await api(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${order.invoiceId}/payments`), "payments").map((p) => p.id)
      : [];
    const ids = new Set([order.id, order.invoiceId ?? "", ...payments].filter(Boolean));
    const mine = gl.rows.filter((r) => ids.has(r.sourceId ?? "") || [...ids].some((id) => (r.reference ?? "").includes(id)));
    const revenue = mine.filter((r) => ["REVENUE", "INCOME"].includes(r.accountType)).reduce((s, r) => s + Number(r.credit) - Number(r.debit), 0);
    const cogs = mine.filter((r) => r.accountType === "COGS").reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);
    expect.soft(revenue, "the sale posted: 3 x 15").toBe(45);
    expect.soft(cogs, "its COGS posted: 3 x 8").toBe(24);
  });

  test("L4 the receipt link can be shared by WhatsApp or shown as a QR code, and the customer can open it", async ({ page, request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const item = await seedItem(request, owner, `Aloo pie ${stamp()}`, 8, 20, 3);
    const sale = await quickSale(page, [[item, 2]], "cash");
    expect(sale.status).toBe(201);
    let receiptUrl = "";

    await test.step("WhatsApp opens a chat with the receipt link", async () => {
      const control = page.getByRole("link", { name: /whatsapp/i }).or(page.getByRole("button", { name: /whatsapp/i })).filter({ visible: true }).first();
      await expect(control, "the receipt offers WhatsApp").toBeVisible();
      let href = await control.evaluate((el) => (el as HTMLAnchorElement).href ?? el.closest("a")?.href ?? "");
      if (!/wa\.me|whatsapp\.com/.test(href)) {
        await page.evaluate(() => {
          const w = window as unknown as { __kfOpened: string[] };
          w.__kfOpened = [];
          window.open = ((url?: string | URL) => {
            w.__kfOpened.push(String(url ?? ""));
            return null;
          }) as typeof window.open;
        });
        await control.click();
        href = await page.evaluate(() => (window as unknown as { __kfOpened: string[] }).__kfOpened[0] ?? "");
      }
      const target = new URL(href);
      expect(target.hostname).toMatch(/(^|\.)wa\.me$|whatsapp\.com$/);
      const text = target.searchParams.get("text") ?? "";
      const link = text.match(/https?:\/\/\S+/)?.[0] ?? "";
      expect(link, "the message carries the receipt link").toMatch(/receipt|\/pay\/link\//);
      receiptUrl = link;
    });

    await test.step("a QR code of the receipt link can be shown", async () => {
      const qr = page.getByRole("button", { name: /qr/i }).filter({ visible: true });
      if (await qr.count()) await qr.first().click();
      await expect(page.locator("canvas, svg[aria-label*='QR' i], img[alt*='QR' i], [data-qr]").filter({ visible: true }).first(), "the QR code").toBeVisible();
    });

    await test.step("the customer opens the receipt", async () => {
      const visitor = await anonymousContext(browser, { who: "customer" });
      const view = await visitor.newPage();
      await view.goto(new URL(receiptUrl).pathname);
      await settle(view, 1_000);
      const text = (await view.locator("body").innerText()).replace(/\s+/g, " ");
      expect.soft(text, "the receipt names the business").toContain(owner.businessName);
      expect.soft(text, "and the total").toContain(money(16));
    });
  });

  test("L5 the sale appears in Sales > Orders and in Money > Money in", async ({ page, request, owner }) => {
    test.setTimeout(6 * 60_000);
    const item = await seedItem(request, owner, `Kurma pack ${stamp()}`, 22, 15, 9);
    const sale = await quickSale(page, [[item, 1]], "cash");
    expect(sale.status).toBe(201);
    const order = orderOf(sale);

    await test.step("Sales > Orders lists it", async () => {
      await page.goto("/app/commerce");
      await settle(page, 1_000);
      const tab = page.getByRole("tab", { name: /^orders/i }).or(page.getByRole("link", { name: /^orders/i })).or(page.getByRole("button", { name: /^orders/i })).filter({ visible: true });
      await expect(tab.first(), "Sales > Orders (SALES-ORDERS-TAB)").toBeVisible();
      await tab.first().click();
      await settle(page, 1_000);
      await expect(page.locator("main").first().getByText(order.orderNumber).first(), `order ${order.orderNumber} in Sales > Orders`).toBeVisible();
    });

    await test.step("Money > Money in lists its payment", async () => {
      await page.goto("/app/payments");
      await settle(page, 1_500);
      const text = (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
      expect.soft(text, "the 22.00 cash payment in Money in").toMatch(/22\.00/);
    });
  });

  test("L6 a quick sale does not count toward the invoice cap (the plan table)", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const item = await seedItem(request, owner, `Saltfish bake ${stamp()}`, 18, 10, 6);
    const before = await api<{ current: number; limit: number }>(request, owner, "GET", `/subscriptions/businesses/${owner.businessId}/check-limit/invoices`);
    const sale = await quickSale(page, [[item, 1]], "cash");
    expect(sale.status).toBe(201);
    const after = await api<{ current: number; limit: number }>(request, owner, "GET", `/subscriptions/businesses/${owner.businessId}/check-limit/invoices`);
    test.info().annotations.push({ type: "invoice-cap", description: `before ${before.current}/${before.limit}, after ${after.current}/${after.limit}` });
    expect(after.current, "the invoices counted toward the cap, after the quick sale (PLAN-TABLE: quick sales do not count)").toBe(before.current);
  });

  test("L7 the quick sale works at 375px", async ({ page, request, owner }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "the 375px run is the phone project's");
    test.setTimeout(5 * 60_000);
    expect(page.viewportSize()?.width, "a 375px screen").toBe(375);
    const item = await seedItem(request, owner, `Currants roll ${stamp()}`, 7, 12, 2);
    const sale = await quickSale(page, [[item, 2]], "cash");
    expect(sale.status, "the sale completes on a phone").toBe(201);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect.soft(overflow, "no sideways scroll on the quick sale at 375px").toBeLessThanOrEqual(0);
  });
});
