import { test, expect, API_URL, coveredButtonFindings, settle, type Tenant } from "./journey-helpers";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/**
 * WEDGE-WA-INBOUND-CAPTURE (P0, the D-263 wedge; D-153), the live step journeys C and D gain: "+ New > From WhatsApp".
 * A new file beside c-customer.spec.ts and d-quote-deposit.spec.ts (their steps are pinned by
 * src/__tests__/journey-specs-a-f.test.ts and are not edited); neither journey file is Release 0 bound.
 *
 *   C-WA1 (journey C) the owner pastes a customer's WhatsApp message and their local number in New > From WhatsApp:
 *         the customer is created with the number in E.164 for the business's country (+1 868), the message is on
 *         their timeline verbatim as plain text (markup shown as text), and a second message from the same number,
 *         written internationally, finds the same customer instead of adding another.
 *   D-WA1 (journey D) a customer captured from WhatsApp is quoted: New quote opens Sales > Quotes with them chosen, and
 *         the quote created is theirs.
 *
 * Both journey projects (phone 375x812, desktop 1440x900), every variant. Nothing is sent to WhatsApp (the journey
 * watch fails a request off localhost). The capture is the server half's route
 * (POST /crm/businesses/:businessId/whatsapp/inbound-capture).
 *
 * RED at the packet's base (9a65d693): the New menu has no "From WhatsApp".
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(request: APIRequestContext, owner: Tenant, method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(owner), data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
/** A Trinidad and Tobago mobile number, seven digits, unique to the run. */
const localTtNumber = () => `7${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

interface Capture {
  contact: { id: string; firstName: string | null; lastName: string | null; phone: string | null; whatsappNumber: string | null };
  created: boolean;
  normalizedPhone: string;
  note: { id: string; body: string };
}

/** Presses a button, failing with what covers it when something does. */
async function press(button: Locator, what: string): Promise<void> {
  await expect(button, what).toBeVisible();
  expect(await coveredButtonFindings([{ what, locator: button }]), `${what} can be pressed`).toEqual([]);
  await button.click();
}

/** Closes the KEY drawer if it opened by itself, so the page under it can be used. */
async function closeKeyDrawer(page: Page): Promise<void> {
  const drawer = page.getByRole("heading", { name: /^KEY$/ }).filter({ visible: true });
  await drawer.first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  for (let i = 0; i < 3 && (await drawer.count()); i++) {
    const close = page.getByRole("button", { name: /^close chat$/i }).filter({ visible: true });
    if (await close.count()) await close.first().click();
    else await page.keyboard.press("Escape");
    await drawer.first().waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  }
}

/** New > From WhatsApp: pastes the message and number (and a name), saves, and returns the sheet and the capture. */
async function captureFromWhatsApp(
  page: Page,
  owner: Tenant,
  input: { number: string; message: string; firstName?: string; lastName?: string },
): Promise<{ sheet: Locator; capture: Capture }> {
  await page.goto("/app/command-center");
  await settle(page);
  await closeKeyDrawer(page);
  const newButton = page.getByRole("button", { name: /^new\b/i }).filter({ visible: true }).first();
  await press(newButton, "New");
  const door = page.getByRole("menuitem", { name: /from whatsapp/i }).filter({ visible: true });
  await expect(door, "the New menu offers From WhatsApp").toBeVisible();
  await press(door, "New > From WhatsApp");
  const sheet = page.getByRole("dialog", { name: /new from whatsapp/i });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel(/whatsapp number/i).fill(input.number);
  await sheet.getByLabel(/their message/i).fill(input.message);
  if (input.firstName) await sheet.getByLabel(/first name/i).fill(input.firstName);
  if (input.lastName) await sheet.getByLabel(/last name/i).fill(input.lastName);
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/crm/businesses/${owner.businessId}/whatsapp/inbound-capture`,
  );
  await press(sheet.getByRole("button", { name: /^save/i }), "the sheet's Save");
  const res = await saved;
  expect(res.status(), await res.text()).toBe(201);
  const capture = (await res.json()) as Capture;
  await expect(sheet.getByText(/saved to/i).first(), "the sheet says where the message went").toBeVisible();
  return { sheet, capture };
}

test.describe("journeys C and D: New > From WhatsApp", () => {
  test("C-WA1 a pasted WhatsApp message lands on the customer's timeline, found or created by E.164", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const digits = localTtNumber();
    const e164 = `+1868${digits}`;
    const last = `Wa${stamp()}`;
    const message = `Hi! Can I get a price for <b>3</b> shirts by Friday?\nThanks, Keisha ${last}`;
    let contactId = "";

    await test.step(`capture from ${digits.slice(0, 3)} ${digits.slice(3)}: a new customer at ${e164}`, async () => {
      const { sheet, capture } = await captureFromWhatsApp(page, owner, {
        number: `${digits.slice(0, 3)} ${digits.slice(3)}`,
        message,
        firstName: "Keisha",
        lastName: last,
      });
      expect(capture.created, "a new customer").toBe(true);
      expect(capture.normalizedPhone).toBe(e164);
      contactId = capture.contact.id;
      await expect(sheet.getByText(/new customer added/i)).toBeVisible();
      await expect(sheet.getByTestId("wa-saved-message")).toHaveText(message);
      await expect(sheet.getByTestId("wa-saved-message").locator("b")).toHaveCount(0);
    });

    await test.step("the customer is stored in E.164 and the message is on their timeline, verbatim", async () => {
      const detail = await api<{ contact: { phone?: string | null; whatsappNumber?: string | null }; notes: Array<{ body: string; source?: string | null }> }>(
        request, owner, "GET", `/crm/businesses/${owner.businessId}/contacts/${contactId}`,
      );
      expect(detail.contact.phone).toBe(e164);
      expect(detail.contact.whatsappNumber).toBe(e164);
      expect(detail.notes.map((n) => ({ body: n.body, source: n.source }))).toContainEqual({ body: message, source: "whatsapp_inbound" });
      await page.goto(`/app/crm/contacts/${contactId}/notes`);
      await expect(page.getByText(`Thanks, Keisha ${last}`).first(), "the note shows on the customer's page").toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("<b>3</b>", { exact: false }).first(), "its markup shows as text").toBeVisible();
    });

    await test.step("a second message from the same number, written internationally, finds them: no duplicate", async () => {
      const again = `Also, do you deliver? ${stamp()}`;
      const { sheet, capture } = await captureFromWhatsApp(page, owner, { number: `+1 868 ${digits.slice(0, 3)} ${digits.slice(3)}`, message: again });
      expect(capture.created, "found, not created").toBe(false);
      expect(capture.contact.id).toBe(contactId);
      await expect(sheet.getByText(/already a customer/i)).toBeVisible();
      const list = await api<{ contacts: Array<{ id: string; phone?: string | null }> }>(
        request, owner, "GET", `/crm/businesses/${owner.businessId}/contacts?search=${digits}`,
      );
      expect(list.contacts.filter((c) => c.phone === e164).map((c) => c.id)).toEqual([contactId]);
    });
  });

  test("D-WA1 a customer captured from WhatsApp is quoted: New quote opens with them chosen", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const product = await api<{ id: string; name: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, {
      name: `Shirt print ${stamp()}`,
      price: 120,
      currency: owner.currency,
      category: "PRODUCT",
    });
    const digits = localTtNumber();
    const last = `Quote${stamp()}`;

    const { sheet, capture } = await test.step("capture the customer's WhatsApp message", () =>
      captureFromWhatsApp(page, owner, {
        number: digits,
        message: "Hi, how much for 3 printed shirts?",
        firstName: "Dev",
        lastName: last,
      }),
    );

    await test.step("New quote opens Sales > Quotes with the customer chosen", async () => {
      await press(sheet.getByRole("button", { name: /^new quote$/i }), "the sheet's New quote");
      await page.waitForURL(/\/app\/commerce/);
      const quote = page.getByRole("dialog", { name: /new quote/i });
      await expect(quote).toBeVisible({ timeout: 30_000 });
      await expect(quote.getByText(`Dev ${last}`).first(), "the captured customer is chosen").toBeVisible();
      expect(new URL(page.url()).searchParams.get("contactId"), "the one-shot id has left the URL").toBeNull();
    });

    await test.step("3 of the catalog item: the quote created is the captured customer's", async () => {
      const quote = page.getByRole("dialog", { name: /new quote/i });
      await quote.locator("select").filter({ has: page.locator(`option[value="${product.id}"]`) }).first().selectOption(product.id);
      await quote.locator('input[type="number"]').first().fill("3");
      const created = page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${owner.businessId}/quotes`,
      );
      await press(quote.getByRole("button", { name: /^create quote$/i }), "the sheet's Create Quote");
      const res = await created;
      expect(res.status(), await res.text()).toBe(201);
      const body = (await res.json()) as { contactId: string; items: Array<{ productId: string | null; quantity: number | string }> };
      expect(body.contactId).toBe(capture.contact.id);
      expect(body.items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) }))).toEqual([{ productId: product.id, quantity: 3 }]);
    });
  });
});
