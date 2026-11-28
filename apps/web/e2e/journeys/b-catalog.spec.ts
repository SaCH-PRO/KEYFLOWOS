import {
  test,
  expect,
  API_URL,
  RUN,
  anonymousContext,
  coveredButtonFindings,
  signedInContext,
  settle,
  type Tenant,
} from "./journey-helpers";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { crc32, deflateSync } from "node:zlib";

/**
 * GATE-JOURNEYS-A-F, journey B: set up what I sell (product audit
 * core_journeys_v1 B, the catalog; a prerequisite of D, E, F, G and L). Each
 * bullet of B's definition of done is a test (B1..B7), on both journey
 * projects, in every variant (README.md in this folder).
 *
 *   B1  Sales > Products > New creates a product with name, price in the business
 *       currency, tax, optional SKU and stock; edit and archive work; a photo,
 *       if offered, uploads to the server and shows on another device.
 *   B2  Schedule > Services > New creates a service with name, price, duration,
 *       staff and an optional deposit (read back: the price, duration and the
 *       deposit's type and value as stored, and, after a reload, the staff
 *       member and the deposit in the service's Edit).
 *   B3  Each item appears exactly once in the quote and the invoice line picker.
 *   B4  'Add to store' shows it exactly once on /book/<slug>; 'Remove from store'
 *       removes it (storelisting ruling D-185: only products added to the store show).
 *   B5  An edit shows everywhere after one reload.
 *   B6  Archiving hides the item from new documents only (read once the line
 *       picker lists an active product, so an unread picker never passes).
 *   B7  Applying a business template twice adds nothing (products and services).
 *
 * Doors (the packets that turn these green build to them):
 *   - Sales > Products is /app/commerce/products (CATALOG-1), reached from a
 *     "Products" door on Sales (/app/commerce); its create button is named
 *     "New product" (or "Add product"), its form fields are labelled Name,
 *     Price, Tax, SKU and Stock, and each product row offers Edit and Archive
 *     (directly or behind the row's More / Actions menu).
 *   - Schedule > Services is the services editor in Schedule; today it is
 *     Bookings > Setup (/app/bookings?tab=catalog), which SWP-SERVICE-DEPOSIT
 *     extends with the deposit fields; its create button is "New service" (or
 *     "Add service"), with fields Name, Price, Duration, Staff and Deposit
 *     (a deposit type, when asked, offers a percentage); each service row
 *     offers Edit, which shows what is stored (B2 reads the staff member and
 *     the deposit back there: the service list read carries no staff).
 *   - The line picker is the product choice on each line of New invoice
 *     (/app/commerce/invoices/new) and of the New Quote sheet (Sales > Quotes >
 *     New Quote).
 *   - Your page's catalog (/app/store?tab=catalog) lists each item with an
 *     "Add to store" / "Remove from store" control.
 *
 * Prerequisites a test does not drive itself are made through the API, as the
 * screens before them would make them (a product, a service, the business's
 * slug), so each bullet fails on its own step.
 *
 * RED at the GATE-HARNESS head (02e498e8), observed on both projects in the
 * ai-disabled and key-disabled variants (the packet return holds the report):
 * B1 step 1: Sales has no Products door and /app/commerce/products is not
 * found (BUG-005, the headline); B2 Schedule has no 'New service' (BUG-048);
 * B3 the product is in the invoice and quote line pickers once, the service
 * in neither; B4 the added product shows twice on /book/<slug> (BUG-054), a
 * product never added shows too, and 'Remove from store' leaves it there
 * (BUG-055); B5 and B6 stop at the missing Products screen (BUG-005); B7 a
 * second apply doubles the products (BUG-075, 1440x900) and at 375x812
 * 'Apply Template' sits under the Mobile navigation bar.
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = unknown>(
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
  for (const k of [...keys, "data", "items", "results"]) if (Array.isArray(b?.[k])) return b[k] as T[];
  return [];
}

/** Presses a primary button, failing with what covers it when something does. */
async function press(button: Locator, what: string): Promise<void> {
  await expect(button, what).toBeVisible();
  expect(await coveredButtonFindings([{ what, locator: button }]), `${what} can be pressed`).toEqual([]);
  await button.click();
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

async function seedProduct(request: APIRequestContext, owner: Tenant, name: string, price: number) {
  return api<{ id: string; name: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, {
    name,
    price,
    currency: owner.currency,
    category: "PRODUCT",
  });
}

/** The business's products, as the list read returns them (there is no single-product read). */
async function listProducts(request: APIRequestContext, owner: Tenant) {
  return rowsOf<{ id: string; name: string; imageUrl?: string | null }>(
    await api(request, owner, "GET", `/commerce/businesses/${owner.businessId}/products?pageSize=200`),
    "products",
  );
}

/** A valid 1x1 PNG, built at runtime (signature, IHDR, IDAT, IEND, each with its CRC). */
function onePixelPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0);
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const pixel = deflateSync(Buffer.from([0, 0xd9, 0x8c, 0x4a, 0xff]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", pixel),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function seedService(request: APIRequestContext, owner: Tenant, name: string, price: number, durationMins = 60) {
  return api<{ id: string; name: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/services`, {
    name,
    duration: durationMins,
    price,
    currency: owner.currency,
  });
}

/** The business's public slug (Your page > Share names it; the API owns the field). */
async function seedSlug(request: APIRequestContext, owner: Tenant, label: string): Promise<string> {
  const slug = `${RUN.replace(/_/g, "-")}-${label}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  await api(request, owner, "PATCH", `/identity/businesses/${owner.businessId}`, { slug });
  return slug;
}

/**
 * The row of a list that holds `text`: the nearest table row, list item,
 * option or card around it. Row actions are found inside it by name, or
 * behind its More / Actions menu (rowAction).
 */
function rowOf(scope: Page | Locator, text: string): Locator {
  return scope
    .locator("tr, li, [role=row], [role=listitem], [role=option], article")
    .filter({ hasText: text })
    .last();
}

/** A row's action by name: on the row (shown on hover), or in the row's More / Actions menu. */
async function rowAction(page: Page, row: Locator, name: RegExp): Promise<Locator> {
  await row.hover().catch(() => {});
  const direct = row.getByRole("button", { name }).or(row.getByRole("link", { name })).filter({ visible: true });
  if (await direct.count()) return direct.first();
  const menu = row.getByRole("button", { name: /more|actions|options|menu/i }).filter({ visible: true });
  expect(await menu.count(), `the row offers '${name.source}' or a More / Actions menu`).toBeGreaterThan(0);
  await menu.first().click();
  const item = page.getByRole("menuitem", { name }).or(page.getByRole("button", { name })).filter({ visible: true });
  await expect(item.first(), `'${name.source}' in the row's menu`).toBeVisible();
  return item.first();
}

/** How many choices in the first line picker of `scope` are named `name`. */
async function pickerCount(scope: Locator, name: string): Promise<{ count: number; choices: string[] }> {
  const selects = scope.locator("select");
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const choices = await selects.nth(i).evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()));
    if (choices.some((c) => /product|item|catalog/i.test(c))) {
      return { count: choices.filter((c) => c === name || c.startsWith(`${name} `) || c.startsWith(`${name} (`)).length, choices };
    }
  }
  const combo = scope.getByRole("combobox", { name: /product|item|catalog/i }).first();
  if (await combo.count()) {
    await combo.click();
    const options = scope.page().getByRole("option");
    const choices = (await options.allInnerTexts()).map((t) => t.trim());
    await scope.page().keyboard.press("Escape");
    return { count: choices.filter((c) => c === name || c.startsWith(name)).length, choices };
  }
  return { count: 0, choices: [] };
}

/** The labelled field of a form, whichever control it is. */
const field = (scope: Locator, label: RegExp) => scope.getByLabel(label).first();

/**
 * Opens the New Quote sheet from Sales > Quotes: its "New Quote" button, or
 * the Sales "New" menu's "New quote". /app/commerce?tab=pipeline&view=quotes
 * is the Quotes door today and lands on Sales > Quotes after MOUNT-QUOTES.
 */
async function openNewQuote(page: Page): Promise<void> {
  await page.goto("/app/commerce?tab=pipeline&view=quotes");
  await settle(page, 1_000);
  const direct = page.getByRole("button", { name: /^new quote$/i }).filter({ visible: true });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  await page.getByRole("button", { name: "New", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("menuitem", { name: /new quote/i }).or(page.getByRole("button", { name: /new quote/i })).filter({ visible: true }).first().click();
}

/** Opens Sales > Products (CATALOG-1). */
async function openProducts(page: Page): Promise<void> {
  await page.goto("/app/commerce");
  await expect
    .soft(page.getByRole("link", { name: /^products$/i }).or(page.getByRole("tab", { name: /^products$/i })).first(), "Sales offers a Products door")
    .toBeVisible();
  await page.goto("/app/commerce/products");
  await expect(page.getByRole("heading", { name: /page not found|404/i }), "Sales > Products exists (/app/commerce/products)").toHaveCount(0);
  await expect(page.getByRole("button", { name: /new product|add product/i }).first(), "Sales > Products offers New product").toBeVisible();
}

test.describe("journey B: set up what I sell", () => {
  test("B1 Sales > Products > New creates a product (name, price in the business currency, tax, SKU, stock); edit and archive work; a photo shows on another device", async ({
    page,
    request,
    owner,
    browser,
  }) => {
    test.setTimeout(5 * 60_000);
    const name = `Sponge cake ${stamp()}`;
    let productId = "";

    await test.step("open Sales > Products and New product", async () => {
      await openProducts(page);
      await page.getByRole("button", { name: /new product|add product/i }).first().click();
    });

    await test.step("create it with name, price, tax, SKU and stock; the price is in the business currency", async () => {
      const form = page.getByRole("dialog").filter({ visible: true }).last();
      await expect(form).toBeVisible();
      await field(form, /^name/i).fill(name);
      await field(form, /^price/i).fill("45");
      await expect(form.getByText(new RegExp(owner.currency)).first(), `the price is in ${owner.currency}`).toBeVisible();
      const tax = field(form, /^tax/i);
      if ((await tax.evaluate((el) => el.tagName)) === "SELECT") await tax.selectOption({ index: 1 });
      else await tax.fill("12.5");
      await field(form, /^sku/i).fill(`SKU-${stamp()}`);
      await field(form, /^stock/i).fill("12");
      const created = page.waitForResponse((r) => r.request().method() === "POST" && /\/products$/.test(new URL(r.url()).pathname));
      await form.getByRole("button", { name: /^(save|create|add)( product)?$/i }).click();
      const res = await created;
      expect(res.status(), await res.text()).toBe(201);
      productId = ((await res.json()) as { id: string }).id;
      await expect(rowOf(page, name)).toBeVisible();
    });

    await test.step("edit the price; the edit is read back after a reload", async () => {
      await (await rowAction(page, rowOf(page, name), /^edit/i)).click();
      const form = page.getByRole("dialog").filter({ visible: true }).last();
      await field(form, /^price/i).fill("50");
      await form.getByRole("button", { name: /^(save|update)/i }).click();
      await page.reload();
      await expect(rowOf(page, name)).toContainText(/50/);
    });

    await test.step("a photo, if offered, is stored on the server and shows on another device", async () => {
      await (await rowAction(page, rowOf(page, name), /^edit/i)).click();
      const form = page.getByRole("dialog").filter({ visible: true }).last();
      const upload = form.locator('input[type="file"]');
      if ((await upload.count()) === 0) {
        test.info().annotations.push({ type: "photo", description: "no photo field offered (v1 may ship without photos)" });
        await page.keyboard.press("Escape");
        return;
      }
      await upload.first().setInputFiles({ name: "cake.png", mimeType: "image/png", buffer: onePixelPng() });
      await form.getByRole("button", { name: /^(save|update)/i }).click();
      // There is no single-product read: the list carries imageUrl.
      await expect
        .poll(async () => (await listProducts(request, owner)).find((p) => p.id === productId)?.imageUrl ?? "", {
          message: "the photo's address is stored with the product",
        })
        .not.toBe("");
      const stored = (await listProducts(request, owner)).find((p) => p.id === productId)?.imageUrl ?? "";
      // Not an address only this browser can read (BUG-005: lib/image-store.ts keeps photos in IndexedDB).
      expect(stored, "the photo is stored on the server, not in this browser").not.toMatch(/^(data|blob|idb|indexeddb):/i);
      const second = await signedInContext(browser, owner, { who: "owner, second device" });
      const other = await second.newPage();
      await other.goto("/app/commerce/products");
      const img = rowOf(other, name).locator("img").first();
      await expect(img, "the photo on another device").toBeVisible();
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0), {
          message: "the photo loads on another device",
        })
        .toBe(true);
    });

    await test.step("archive it; it leaves the active list", async () => {
      await (await rowAction(page, rowOf(page, name), /^archive/i)).click();
      const confirm = page.getByRole("button", { name: /^(archive|confirm|yes)/i }).filter({ visible: true });
      if (await confirm.count()) await confirm.first().click();
      await page.reload();
      await expect(rowOf(page, name)).toHaveCount(0);
    });
  });

  test("B2 Schedule > Services > New creates a service with name, price, duration, staff and an optional deposit", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const name = `Haircut ${stamp()}`;
    const staff = await api<{ id: string; name: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/staff`, { name: `Kerry ${stamp()}` });

    await test.step("open Schedule > Services and New service", async () => {
      await page.goto("/app/bookings?tab=catalog");
      await settle(page, 1_000);
      const create = page.getByRole("button", { name: /new service|add service/i }).filter({ visible: true });
      await expect(create.first(), "Schedule > Services offers New service").toBeVisible();
      await create.first().click();
    });

    await test.step("fill name, price, duration, staff and a 25% deposit, and save", async () => {
      const form = page.getByRole("dialog").filter({ visible: true }).last();
      await field(form, /^name/i).fill(name);
      await field(form, /^price/i).fill("120");
      await field(form, /^duration/i).fill("45");
      const staffField = form.getByLabel(/staff/i).first();
      if ((await staffField.evaluate((el) => el.tagName)) === "SELECT") await staffField.selectOption({ label: staff.name });
      else await form.getByRole("checkbox", { name: staff.name }).check();
      await form.getByLabel(/deposit/i).first().check().catch(async () => form.getByLabel(/deposit/i).first().click());
      // A percentage deposit: the type, when the form asks, is the percentage one.
      const type = form.getByLabel(/deposit type/i);
      const percent = form.getByRole("radio", { name: /percent|%/i });
      if (await type.count()) {
        const options = await type.first().evaluate((el) =>
          el.tagName === "SELECT" ? Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, text: o.text })) : [],
        );
        const pick = options.find((o) => /percent|%/i.test(o.text) || /percent/i.test(o.value));
        if (pick) await type.first().selectOption(pick.value);
      } else if (await percent.count()) await percent.first().check();
      const amount = form.getByLabel(/deposit (amount|value|%)|percent/i).first();
      await amount.fill("25");
      const created = page.waitForResponse((r) => r.request().method() === "POST" && /\/services$/.test(new URL(r.url()).pathname));
      await form.getByRole("button", { name: /^(save|create|add)( service)?$/i }).click();
      const res = await created;
      expect(res.status(), await res.text()).toBe(201);
    });

    await test.step("the service is stored with its price, duration and a 25% deposit", async () => {
      const services = rowsOf<Record<string, unknown>>(await api(request, owner, "GET", `/bookings/businesses/${owner.businessId}/services`), "services");
      const service = services.find((s) => s.name === name);
      expect(service, `the service ${name}`).toBeTruthy();
      expect(Number(service!.price)).toBe(120);
      expect(Number(service!.duration ?? service!.durationMins)).toBe(45);
      expect({ depositRequired: service!.depositRequired, depositType: service!.depositType, depositValue: Number(service!.depositValue) }).toEqual({
        depositRequired: true,
        depositType: "PERCENT",
        depositValue: 25,
      });
    });

    // The service list read carries no staff, so the stored staff link is read back where the owner
    // reads it: the service's Edit, after a reload (nothing kept in the browser).
    await test.step("after a reload, the service's Edit shows its staff member and its 25% deposit", async () => {
      await page.reload();
      await settle(page, 1_000);
      const row = rowOf(page, name);
      await expect(row, `the service ${name} in Schedule > Services`).toBeVisible();
      await (await rowAction(page, row, /^edit/i)).click();
      const form = page.getByRole("dialog").filter({ visible: true }).last();
      await expect(form).toBeVisible();
      const staffField = form.getByLabel(/staff/i).first();
      if ((await staffField.count()) && (await staffField.evaluate((el) => el.tagName)) === "SELECT") {
        const selectedStaff = await staffField.evaluate((el) => Array.from((el as HTMLSelectElement).selectedOptions).map((o) => o.text.trim()));
        expect(selectedStaff, "the service's staff, as stored").toContain(staff.name);
      } else {
        await expect(form.getByRole("checkbox", { name: staff.name }), "the service's staff, as stored").toBeChecked();
      }
      await expect(form.getByLabel(/deposit (amount|value|%)|percent/i).first(), "the deposit, as stored").toHaveValue(/^25(\.0+)?$/);
    });
  });

  test("B3 each product and service appears exactly once in the invoice and the quote line picker", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const product = await seedProduct(request, owner, `Curry powder ${stamp()}`, 18);
    const service = await seedService(request, owner, `Consultation ${stamp()}`, 300);

    await test.step("New invoice: the line picker lists each once", async () => {
      await page.goto("/app/commerce/invoices/new");
      await expect(page.getByRole("heading", { name: "New Invoice" })).toBeVisible();
      const form = page.locator("main").first();
      await expect.poll(async () => (await pickerCount(form, product.name)).choices.length, { message: "the invoice line picker loads" }).toBeGreaterThan(1);
      const p = await pickerCount(form, product.name);
      const s = await pickerCount(form, service.name);
      expect.soft(p.count, `'${product.name}' in the invoice picker ${JSON.stringify(p.choices)}`).toBe(1);
      expect.soft(s.count, `'${service.name}' in the invoice picker ${JSON.stringify(s.choices)}`).toBe(1);
    });

    await test.step("New quote: the line picker lists each once", async () => {
      await openNewQuote(page);
      const sheet = page.getByRole("dialog", { name: /new quote/i });
      await expect(sheet).toBeVisible();
      await expect.poll(async () => (await pickerCount(sheet, product.name)).choices.length, { message: "the quote line picker loads" }).toBeGreaterThan(1);
      const p = await pickerCount(sheet, product.name);
      const s = await pickerCount(sheet, service.name);
      expect.soft(p.count, `'${product.name}' in the quote picker ${JSON.stringify(p.choices)}`).toBe(1);
      expect.soft(s.count, `'${service.name}' in the quote picker ${JSON.stringify(s.choices)}`).toBe(1);
    });
  });

  test("B4 'Add to store' lists a product exactly once on /book/<slug>; 'Remove from store' takes it off", async ({ page, request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const product = await seedProduct(request, owner, `Pepper sauce ${stamp()}`, 35);
    const other = await seedProduct(request, owner, `Not listed ${stamp()}`, 10);
    const slug = await seedSlug(request, owner, "b4");
    const customer = await anonymousContext(browser, { who: "customer" });
    const shop = await customer.newPage();
    const listings = async () => {
      await shop.goto(`/book/${slug}`);
      await settle(shop, 1_500);
      return {
        product: await shop.getByText(product.name, { exact: true }).count(),
        other: await shop.getByText(other.name, { exact: true }).count(),
      };
    };

    await test.step("the owner adds the product to the store from Your page", async () => {
      await page.goto("/app/store?tab=catalog");
      const row = rowOf(page, product.name);
      await expect(row).toBeVisible();
      const done = page.waitForResponse((r) => ["POST", "PATCH", "PUT"].includes(r.request().method()) && r.status() < 400 && r.url().startsWith(API_URL));
      await row.getByRole("button", { name: /add to store/i }).click();
      await done;
      await expect(row.getByRole("button", { name: /remove from store/i })).toBeVisible();
    });

    await test.step("the customer sees it exactly once on /book/<slug>, and not the product never added", async () => {
      const seen = await listings();
      expect.soft(seen.product, `'${product.name}' cards on /book/${slug}`).toBe(1);
      expect.soft(seen.other, `'${other.name}' (never added) on /book/${slug}`).toBe(0);
    });

    await test.step("the owner removes it; the customer no longer sees it", async () => {
      await page.goto("/app/store?tab=catalog");
      const row = rowOf(page, product.name);
      await row.getByRole("button", { name: /remove from store/i }).click();
      const confirm = row.getByRole("button", { name: /^confirm$/i }).or(page.getByRole("button", { name: /^(confirm|remove)$/i })).filter({ visible: true });
      if (await confirm.count()) await confirm.first().click();
      await expect(row.getByRole("button", { name: /add to store/i })).toBeVisible();
      const seen = await listings();
      expect(seen.product, `'${product.name}' on /book/${slug} after 'Remove from store'`).toBe(0);
    });
  });

  test("B5 an edit shows everywhere after one reload (line picker, store page)", async ({ page, request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const product = await seedProduct(request, owner, `Sorrel ${stamp()}`, 20);
    const slug = await seedSlug(request, owner, "b5");
    const renamed = `${product.name} large`;

    await test.step("the product is on the store (Your page > Add to store)", async () => {
      await page.goto("/app/store?tab=catalog");
      await rowOf(page, product.name).getByRole("button", { name: /add to store/i }).click();
      await expect(rowOf(page, product.name).getByRole("button", { name: /remove from store/i })).toBeVisible();
    });

    await test.step("the owner renames it and changes its price in Sales > Products", async () => {
      await openProducts(page);
      await (await rowAction(page, rowOf(page, product.name), /^edit/i)).click();
      const form = page.getByRole("dialog").filter({ visible: true }).last();
      await field(form, /^name/i).fill(renamed);
      await field(form, /^price/i).fill("27");
      await form.getByRole("button", { name: /^(save|update)/i }).click();
      await expect(form, "the edit is saved (the form closes) before the owner moves on").toBeHidden({ timeout: 30_000 });
    });

    await test.step("after one reload the new name and price show in the line picker and on /book/<slug>", async () => {
      await page.goto("/app/commerce/invoices/new");
      const form = page.locator("main").first();
      await expect.poll(async () => (await pickerCount(form, renamed)).choices.length, { message: "the invoice line picker loads" }).toBeGreaterThan(1);
      const p = await pickerCount(form, renamed);
      expect.soft(p.count, `'${renamed}' in the invoice picker ${JSON.stringify(p.choices)}`).toBe(1);
      const customer = await anonymousContext(browser, { who: "customer" });
      const shop = await customer.newPage();
      await shop.goto(`/book/${slug}`);
      await expect.soft(shop.getByText(renamed, { exact: true }).first()).toBeVisible();
      await expect.soft(shop.getByText(/27(\.00)?/).first()).toBeVisible();
    });
  });

  test("B6 archiving hides the item from new documents only", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const product = await seedProduct(request, owner, `Archived item ${stamp()}`, 12);
    // An active product the picker must still list: proof it has loaded before an absence is read.
    const kept = await seedProduct(request, owner, `Kept item ${stamp()}`, 9);
    const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, { firstName: "Archie", lastName: `Ves ${stamp()}` });
    const invoice = await api<{ id: string; invoiceNumber: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
      contactId: contact.id,
      currency: owner.currency,
      items: [{ description: product.name, quantity: 1, unitPrice: 12, productId: product.id }],
    });

    await test.step("archive it in Sales > Products", async () => {
      await openProducts(page);
      await (await rowAction(page, rowOf(page, product.name), /^archive/i)).click();
      const confirm = page.getByRole("button", { name: /^(archive|confirm|yes)/i }).filter({ visible: true });
      if (await confirm.count()) await confirm.first().click();
    });

    await test.step("New invoice no longer offers it (and still offers the active product)", async () => {
      await page.goto("/app/commerce/invoices/new");
      await expect(page.getByRole("heading", { name: "New Invoice" })).toBeVisible();
      const form = page.locator("main").first();
      await expect
        .poll(async () => (await pickerCount(form, kept.name)).count, { message: `the line picker has loaded: it lists '${kept.name}'` })
        .toBe(1);
      const archived = await pickerCount(form, product.name);
      expect(archived.count, `the archived '${product.name}' in New invoice's picker ${JSON.stringify(archived.choices)}`).toBe(0);
    });

    await test.step("the invoice that already used it still shows the line", async () => {
      await page.goto(`/app/commerce/invoices/${invoice.id}`);
      await expect(page.getByText(product.name).first()).toBeVisible();
    });
  });

  test("B7 applying a business template twice adds nothing the second time", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    // A template adds products and services (templates.service.ts applyTemplate): both are counted.
    const count = async () => ({
      products: rowsOf(await api(request, owner, "GET", `/commerce/businesses/${owner.businessId}/products?pageSize=200`), "products").length,
      services: rowsOf(await api(request, owner, "GET", `/bookings/businesses/${owner.businessId}/services`), "services").length,
    });
    const apply = async () => {
      await page.goto("/app/templates");
      const card = page.locator("div").filter({ has: page.getByRole("heading", { level: 3 }) }).filter({ has: page.getByRole("button", { name: /apply template/i }) }).last();
      await expect(card).toBeVisible();
      await press(card.getByRole("button", { name: /apply template/i }), "Apply Template");
      const applied = page.waitForResponse((r) => r.request().method() === "POST" && /template/i.test(r.url()) && r.url().startsWith(API_URL));
      await press(page.getByRole("button", { name: /yes, apply/i }), "Yes, Apply");
      const res = await applied;
      return res.status();
    };

    let afterFirst = { products: 0, services: 0 };
    await test.step("apply a template once: it adds its products and services", async () => {
      const before = await count();
      const status = await apply();
      expect(status, "the first apply").toBeLessThan(400);
      afterFirst = await count();
      test.info().annotations.push({ type: "template", description: `before ${JSON.stringify(before)}, after the first apply ${JSON.stringify(afterFirst)}` });
      expect(afterFirst.products + afterFirst.services, "items after the first apply").toBeGreaterThan(before.products + before.services);
    });

    await test.step("apply the same template again: nothing is added", async () => {
      await apply();
      expect(await count(), "products and services after the second apply").toEqual(afterFirst);
    });
  });
});
