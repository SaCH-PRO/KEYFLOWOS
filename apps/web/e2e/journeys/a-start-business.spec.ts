import {
  test,
  expect,
  API_URL,
  VARIANT,
  anonymousContext,
  settle,
  signedInContext,
  type Tenant,
} from "./journey-helpers";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/**
 * GATE-JOURNEYS-A-F, journey A: start the business (product audit
 * core_journeys_v1 A; KF-JOURNEY-001, 016, 020). Each bullet of A's definition
 * of done is one test below (A1..A9), run on both journey projects (phone
 * 375x812, desktop 1440x900) in every variant (E2E_VARIANT: KEY on with AI off,
 * and KEY_DISABLED), against the production build (README.md in this folder).
 *
 *   A1  'Start free' on /pricing carries the plan and currency into /auth/signup.
 *   A2  Staging: real Supabase sign-up, email verification and password reset
 *       (@staging, GATE-STAGING-RUN).
 *   A3  Onboarding opens with the manual form at the top: business name,
 *       currency (TTD or USD), timezone and 'services, products or both'; no
 *       scrolling, no KEY card above it.
 *   A4  The answer is saved on the business and sets the visible hubs and the
 *       bottom bar on every device (phone: the bar; desktop: the hubs in the
 *       menu; read again on a second device signed in as the owner).
 *   A5  Submit lands on Today, with the business name and the Get set up checklist.
 *   A6  Each checklist step opens its real page and is ticked only when the thing exists.
 *   A7  Nothing is seeded into the books; the sample is a preview (demo ruling D-157).
 *   A8  Day one shows no percentage, no risk count, no red badge and no 'you owe 0'.
 *   A9  No KEY drawer opens by itself.
 *
 * Not encoded here: the unassisted test (5 Trinidad and Tobago owners on their
 * own phones, each sharing a quote or booking link within 5 minutes) is a
 * protocol with people, GATE-OWNER-TEST's, not a browser run.
 *
 * Contracts these steps read (the packets that turn them green build to them):
 *   - the manual form is the region named "Set up manually" with fields
 *     labelled "Business name", "Currency" (a choice of TTD or USD only:
 *     BIZ-SETTINGS-WEB), "Timezone" and "What do you sell?" (a select or a
 *     radio group offering Services, Products and Both), and "Finish setup";
 *   - the phone's bottom bar is the navigation named "Mobile navigation" and
 *     the desktop menu the navigation named "Main navigation" (NAV-A1 may rename
 *     neither without updating this spec); the bar for 'products' reads Today,
 *     Sales, New, Customers, More (intuitiveness principle 'The app fits what
 *     you sell');
 *   - Today's checklist has a heading "Get set up"; each step is a link in that
 *     block, and a ticked step says so to assistive technology (aria-checked or
 *     data-state "done", or the words Done / Completed in its accessible text).
 *
 * RED at the GATE-HARNESS head (02e498e8), observed on both projects in the
 * ai-disabled and key-disabled variants (the packet return holds the report):
 * A1 the URL carries plan=FLOW and currency=USD, but /auth/signup names
 * neither (BUG-076); A3 the page opens scrolled past the manual form to the
 * KEY chat: 'Set up manually' and 'Finish setup' are out of view (BUG-042, the
 * headline), the currency is free text (BUG-077) and there is no 'What do you
 * sell?'; A4 no 'What do you sell?' (BIZ-SETTINGS-WEB); A5 Today names no
 * business and has no Get set up checklist (TODAY-4BLOCK); A6 the same
 * (TODAY-AGGREGATE); A7 /complete seeds a 'Sample Client' contact and a
 * DEMO-... invoice (DEMO-PREVIEW), and there is no Get set up to preview the
 * sample in; A8 percentages and risk counts on Today (BUG-069); A9 the KEY
 * drawer opens by itself, in every variant (SWP-KEY-SHELL-SMOKE).
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function apiJson<T>(request: APIRequestContext, owner: Tenant, path: string): Promise<T> {
  const res = await request.get(`${API_URL}${path}`, { headers: auth(owner) });
  const text = await res.text();
  expect(res.status(), `GET ${path}: ${text.slice(0, 300)}`).toBe(200);
  return JSON.parse(text) as T;
}

/** A list endpoint's rows, whichever envelope it answers with. */
function rowsOf(body: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(body)) return body;
  const b = body as Record<string, unknown>;
  for (const k of [...keys, "data", "items", "results"]) if (Array.isArray(b?.[k])) return b[k] as unknown[];
  return [];
}

/** The manual onboarding form (D-03): the region headed "Set up manually". */
const manualForm = (page: Page) => page.getByRole("region", { name: /set up manually/i });

/** Fills a field that is a text input today and may become a select (Currency, Timezone). */
async function setField(field: Locator, value: string): Promise<void> {
  const tag = await field.evaluate((el) => el.tagName);
  if (tag === "SELECT") await field.selectOption(value);
  else await field.fill(value);
}

/**
 * Answers 'What do you sell?' (BIZ-SETTINGS-WEB): a select labelled so, or a
 * radio group named so with Services / Products / Both. Fails when the form
 * does not ask.
 */
async function answerWhatYouSell(form: Locator, answer: "services" | "products" | "both"): Promise<void> {
  const label = /what do you sell/i;
  const select = form.getByLabel(label);
  const group = form.getByRole("radiogroup", { name: label });
  const asked = (await select.count()) + (await group.count());
  expect(asked, "the manual form asks 'What do you sell?' (services, products or both)").toBeGreaterThan(0);
  if ((await group.count()) > 0) {
    await group.getByRole("radio", { name: new RegExp(`^${answer}`, "i") }).check();
    return;
  }
  const options = await select.first().evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, text: o.text })),
  );
  const pick = options.find((o) => new RegExp(answer, "i").test(o.value) || new RegExp(answer, "i").test(o.text));
  expect(pick, `'What do you sell?' offers ${answer}: ${JSON.stringify(options)}`).toBeTruthy();
  await select.first().selectOption(pick!.value);
}

/** Opens onboarding for a tenant that has not finished it, and waits for the manual form. */
async function openOnboarding(page: Page): Promise<Locator> {
  await page.goto("/app");
  await page.waitForURL(/\/app\/onboarding(\?|$)/);
  const form = manualForm(page);
  await expect(form).toBeAttached();
  return form;
}

/** Fills and submits the manual form; lands on Today. */
async function finishManualSetup(
  page: Page,
  form: Locator,
  values: { name: string; currency: "TTD" | "USD"; timezone: string; sells?: "services" | "products" | "both" },
): Promise<void> {
  await form.getByLabel("Business name").fill(values.name);
  await setField(form.getByLabel("Currency"), values.currency);
  await setField(form.getByLabel("Timezone"), values.timezone);
  if (values.sells) await answerWhatYouSell(form, values.sells);
  await form.getByRole("button", { name: /finish setup/i }).click();
  await page.waitForURL(/\/app\/command-center/);
}

/** Today's "Get set up" block: the smallest element holding its heading and its steps. */
function getSetUpBlock(page: Page): Locator {
  const heading = page.getByRole("heading", { name: /get set up/i });
  return page
    .locator("section, [role=region], div")
    .filter({ has: heading })
    .filter({ has: page.getByRole("link") })
    .last();
}

/** Whether a checklist step says it is done (aria-checked, data-state, or the words Done / Completed). */
async function isTicked(step: Locator): Promise<boolean> {
  return step.evaluate((el) => {
    const marked = (n: Element) =>
      n.getAttribute("aria-checked") === "true" ||
      /^(done|complete|completed)$/i.test(n.getAttribute("data-state") ?? "") ||
      /\b(done|completed)\b/i.test(n.getAttribute("aria-label") ?? "");
    const holder = el.closest("li") ?? el;
    if (marked(el) || marked(holder) || Array.from(holder.querySelectorAll("*")).some(marked)) return true;
    return /\b(done|completed)\b/i.test(holder.textContent ?? "");
  });
}

test.describe("journey A: start the business", () => {
  test("A1 'Start free' on /pricing carries the plan and currency into /auth/signup", async ({ browser }) => {
    test.setTimeout(3 * 60_000);
    const visitor = await anonymousContext(browser, { who: "visitor" });
    const page = await visitor.newPage();

    await test.step("the visitor picks USD and starts the Flow plan from /pricing", async () => {
      await page.goto("/pricing");
      await page.getByRole("button", { name: /^USD/ }).click();
      const card = page
        .locator("div")
        .filter({ has: page.getByRole("heading", { name: "Flow", exact: true }) })
        .filter({ has: page.getByRole("link", { name: /start free/i }) })
        .last();
      await card.getByRole("link", { name: /start free/i }).click();
      await page.waitForURL(/\/auth\/signup/);
    });

    await test.step("/auth/signup carries the plan and the currency, and says so", async () => {
      const url = new URL(page.url());
      expect.soft(url.searchParams.get("plan")?.toUpperCase(), "the plan in the sign-up URL").toBe("FLOW");
      expect.soft(url.searchParams.get("currency"), "the currency in the sign-up URL").toBe("USD");
      await expect(page.locator('input[placeholder="John"]')).toBeVisible();
      // The sign-up page names what the visitor chose (BUG-076: it is dropped silently).
      await expect.soft(page.getByText(/\bFlow\b/).first(), "the sign-up page names the chosen plan").toBeVisible();
      await expect.soft(page.getByText(/\bUSD\b/).first(), "the sign-up page names the chosen currency").toBeVisible();
    });
  });

  test("A2 sign-up, email verification and password reset work against the staging Supabase", { tag: "@staging" }, async ({ browser }) => {
    // GATE-STAGING-RUN: a sandbox Supabase project and a mailbox it can read.
    // E2E_STAGING_MAILBOX_URL answers GET ?to=<address>&kind=verify|reset with
    // { link } for the newest message of that kind (the staging run provides it).
    test.setTimeout(10 * 60_000);
    const mailbox = process.env.E2E_STAGING_MAILBOX_URL ?? "";
    expect(mailbox, "E2E_STAGING_MAILBOX_URL (GATE-STAGING-RUN) reads the sandbox mailbox").not.toBe("");
    const address = `v62j_a2_${Date.now().toString(36)}@${process.env.E2E_STAGING_MAIL_DOMAIN ?? "example.test"}`;
    const password = ["Gate", "Journey", String(Date.now()).slice(-6), "!"].join("-");
    const visitor = await anonymousContext(browser, { who: "new owner" });
    const page = await visitor.newPage();
    const linkFor = async (kind: "verify" | "reset"): Promise<string> => {
      let link = "";
      await expect
        .poll(
          async () => {
            const res = await page.request.get(`${mailbox}?to=${encodeURIComponent(address)}&kind=${kind}`);
            link = res.ok() ? (((await res.json()) as { link?: string }).link ?? "") : "";
            return link;
          },
          { timeout: 120_000, message: `the ${kind} email reaches ${address}` },
        )
        .not.toBe("");
      return link;
    };

    await test.step("sign up", async () => {
      await page.goto("/auth/signup");
      await page.locator('input[placeholder="John"]').fill("Gate");
      await page.getByLabel(/last name/i).fill("Journey");
      await page.getByLabel(/email/i).fill(address);
      await page.getByLabel(/^password/i).first().fill(password);
      await page.getByRole("button", { name: /continue|sign up|create account/i }).first().click();
      await expect(page.getByText(/check your email|verify your email/i).first()).toBeVisible();
    });

    await test.step("the verification email's link signs the owner in and opens onboarding", async () => {
      await page.goto(await linkFor("verify"));
      await page.waitForURL(/\/app\/onboarding|\/app\/command-center/);
    });

    await test.step("a password reset email arrives and its link sets a new password", async () => {
      await page.goto("/auth/login");
      await page.getByRole("link", { name: /forgot/i }).click();
      await page.getByLabel(/email/i).fill(address);
      await page.getByRole("button", { name: /reset|send/i }).first().click();
      await page.goto(await linkFor("reset"));
      await page.getByLabel(/new password/i).first().fill(`${password}2`);
      await page.getByRole("button", { name: /update|save|reset/i }).first().click();
      await expect(page.getByText(/password (was )?(updated|changed|reset)/i).first()).toBeVisible();
    });
  });

  test.describe("onboarding, driven in the browser", () => {
    test.use({ tenantOptions: { onboard: false } });

    test("A3 onboarding opens with the manual form at the top: name, currency (TTD or USD), timezone, what you sell; no scrolling, no KEY card above it", async ({ page }) => {
      test.setTimeout(3 * 60_000);
      const form = await openOnboarding(page);
      // BUG-042: the page scrolls itself to the KEY chat card about a second after it opens.
      await settle(page, 1_500);

      await test.step("the manual form is on screen without scrolling (heading and Finish setup in view)", async () => {
        await expect.soft(form.getByRole("heading", { name: /set up manually/i }), "the 'Set up manually' heading, unscrolled").toBeInViewport({ ratio: 1 });
        await expect
          .soft(form.getByRole("button", { name: /finish setup/i }), "'Finish setup', without scrolling")
          .toBeInViewport({ ratio: 1 });
      });

      await test.step("no KEY card sits above the manual form", async () => {
        const above = await page.evaluate(() => {
          const region = Array.from(document.querySelectorAll("section")).find((s) =>
            /set up manually/i.test(s.querySelector("h1,h2,h3")?.textContent ?? ""),
          );
          if (!region) return ["the manual form is not on the page"];
          const top = region.getBoundingClientRect().top;
          const out: string[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const text = n.textContent ?? "";
            if (!/\bKEY\b/.test(text)) continue;
            const el = n.parentElement;
            if (!el || region.contains(el)) continue;
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
            if (r.top < top) out.push(`"${text.replace(/\s+/g, " ").trim().slice(0, 60)}" at y=${Math.round(r.top)} (form at y=${Math.round(top)})`);
          }
          return out;
        });
        expect.soft(above, "KEY text above the manual form").toEqual([]);
      });

      await test.step("the form asks for the business name, a currency of TTD or USD only, and the timezone", async () => {
        await expect(form.getByLabel("Business name")).toBeVisible();
        await expect(form.getByLabel("Timezone")).toBeVisible();
        const currency = form.getByLabel("Currency");
        await expect(currency).toBeVisible();
        const offered = await currency.evaluate((el) =>
          el.tagName === "SELECT"
            ? Array.from((el as HTMLSelectElement).options).map((o) => o.value).filter(Boolean).sort()
            : `free text (${el.tagName.toLowerCase()} type=${(el as HTMLInputElement).type})`,
        );
        // BUG-077: any three letters (e.g. 'ABC') is accepted today.
        expect.soft(offered, "the currency choice").toEqual(["TTD", "USD"]);
      });

      await test.step("the form asks 'What do you sell?': services, products or both", async () => {
        const select = form.getByLabel(/what do you sell/i);
        const group = form.getByRole("radiogroup", { name: /what do you sell/i });
        expect((await select.count()) + (await group.count()), "a 'What do you sell?' question on the manual form").toBeGreaterThan(0);
        const choices = (await group.count())
          ? await group.getByRole("radio").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") || e.closest("label")?.textContent || e.getAttribute("value") || "").trim()))
          : await select.first().evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()).filter(Boolean));
        expect(choices.map((c) => c.toLowerCase().replace(/[^a-z]/g, "")).sort()).toEqual(expect.arrayContaining(["both", "products", "services"]));
      });
    });

    test("A4 the 'what you sell' answer is saved on the business and sets the hubs and the bottom bar on every device", async ({ page, request, owner, browser }, testInfo) => {
      test.setTimeout(4 * 60_000);
      const form = await openOnboarding(page);

      await test.step("the owner answers 'products' and finishes setup", async () => {
        await finishManualSetup(page, form, {
          name: owner.businessName,
          currency: "TTD",
          timezone: "America/Port_of_Spain",
          sells: "products",
        });
      });

      await test.step("the answer is stored on the business (Business.metaData.sells)", async () => {
        const business = await apiJson<{ metaData?: { sells?: unknown } }>(request, owner, `/identity/businesses/${owner.businessId}`);
        expect(business.metaData?.sells).toBe("products");
      });

      // The hubs the answer sets, as this project's device shows them: the phone's bottom bar
      // (Today, Sales, New, Customers, More for a products business: intuitiveness principle
      // 'The app fits what you sell'), or the desktop menu (Sales, and no Schedule hub).
      const checkHubs = async (p: Page, device: string) => {
        await p.goto("/app/command-center");
        await settle(p, 1_000);
        if (testInfo.project.name === "phone") {
          const bar = p.getByRole("navigation", { name: /mobile navigation/i });
          await expect(bar).toBeVisible();
          const names = await bar
            .locator("a, button")
            .filter({ visible: true })
            .evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/[^A-Za-z ]/g, "").trim()));
          expect(names.filter(Boolean), `the bottom bar on ${device}`).toEqual(["Today", "Sales", "New", "Customers", "More"]);
        } else {
          const menu = p.getByRole("navigation", { name: /main navigation/i });
          await expect(menu).toBeVisible();
          await expect.soft(menu.getByRole("link", { name: /^Sales$/ }).or(menu.getByRole("button", { name: /^Sales$/ })).first(), `the Sales hub on ${device}`).toBeVisible();
          await expect.soft(menu.getByText(/^Schedule$/), `a products business has no Schedule hub (${device})`).toHaveCount(0);
        }
      };

      await test.step(
        testInfo.project.name === "phone"
          ? "the phone's bottom bar is Today, Sales, New, Customers, More"
          : "the desktop menu shows the Sales hub and not the Schedule hub",
        () => checkHubs(page, "this device"),
      );

      await test.step("the same hubs on another device the owner signs in on (the answer is the business's, not this browser's)", async () => {
        const second = await signedInContext(browser, owner, { who: "owner, second device" });
        await checkHubs(await second.newPage(), "a second device");
      });
    });

    test("A5 Finish setup lands on Today, with the business name and the Get set up checklist", async ({ page, owner }) => {
      test.setTimeout(3 * 60_000);
      const form = await openOnboarding(page);
      await test.step("the owner finishes the manual form", async () => {
        await finishManualSetup(page, form, { name: owner.businessName, currency: "TTD", timezone: "America/Port_of_Spain" });
      });
      await test.step("Today names the business and shows Get set up", async () => {
        await expect(page).toHaveURL(/\/app\/command-center/);
        await expect.soft(page.getByText(owner.businessName).first(), "the business name on Today").toBeVisible();
        await expect(page.getByRole("heading", { name: /get set up/i }), "Today's 'Get set up' checklist").toBeVisible();
      });
    });
  });

  test("A6 each Get set up step opens its real page and is ticked only when the thing exists", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    let steps: Array<{ name: string; href: string; ticked: boolean }> = [];

    await test.step("Today lists the Get set up steps", async () => {
      await page.goto("/app/command-center");
      await expect(page.getByRole("heading", { name: /get set up/i }), "Today's 'Get set up' checklist").toBeVisible();
      const block = getSetUpBlock(page);
      const links = block.getByRole("link");
      const count = await links.count();
      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        steps.push({
          name: ((await link.getAttribute("aria-label")) ?? (await link.innerText())).replace(/\s+/g, " ").trim(),
          href: (await link.getAttribute("href")) ?? "",
          ticked: await isTicked(link),
        });
      }
      expect(steps.length, "Get set up has steps").toBeGreaterThan(0);
    });

    await test.step("on day one the 'first product or service' and 'how you get paid' steps are not ticked", async () => {
      const product = steps.find((s) => /product|service/i.test(s.name));
      const paid = steps.find((s) => /get paid|payment/i.test(s.name));
      expect(product, `a 'first product or service' step in ${JSON.stringify(steps.map((s) => s.name))}`).toBeTruthy();
      expect(paid, `a 'how you get paid' step in ${JSON.stringify(steps.map((s) => s.name))}`).toBeTruthy();
      expect.soft(product!.ticked, `'${product!.name}' ticked with no product or service`).toBe(false);
      expect.soft(paid!.ticked, `'${paid!.name}' ticked with no payment method`).toBe(false);
    });

    await test.step("each step opens its real page (no bounce back to Today, no 404)", async () => {
      const bounced: string[] = [];
      for (const s of steps) {
        expect(s.href, `step '${s.name}' has a link`).not.toBe("");
        await page.goto(s.href);
        await page.waitForLoadState("domcontentloaded");
        await settle(page, 1_500);
        const path = new URL(page.url()).pathname;
        const notFound = await page.getByRole("heading", { name: /page not found|404/i }).count();
        if (path === "/app/command-center" || /\/app\/onboarding/.test(path) || notFound) bounced.push(`'${s.name}' (${s.href}) ended on ${path}${notFound ? " (not found)" : ""}`);
      }
      expect.soft(bounced, "steps that do not open their page (BUG-010)").toEqual([]);
    });

    await test.step("once a product exists, the product step is ticked", async () => {
      const res = await request.post(`${API_URL}/commerce/businesses/${owner.businessId}/products`, {
        headers: auth(owner),
        data: { name: "Gate sponge cake", price: 45, currency: owner.currency, category: "PRODUCT" },
      });
      expect(res.status(), await res.text()).toBe(201);
      await page.goto("/app/command-center");
      await expect(page.getByRole("heading", { name: /get set up/i })).toBeVisible();
      const step = getSetUpBlock(page).getByRole("link", { name: /product|service/i }).first();
      expect(await isTicked(step), "the 'first product or service' step once a product exists").toBe(true);
    });
  });

  test("A7 nothing is seeded into the books at onboarding; the sample is a preview", async ({ page, request, owner }) => {
    test.setTimeout(3 * 60_000);
    await test.step("the onboarded business has no contact, invoice or quote rows", async () => {
      const contacts = rowsOf(await apiJson(request, owner, `/crm/businesses/${owner.businessId}/contacts`), "contacts");
      const invoices = rowsOf(await apiJson(request, owner, `/commerce/businesses/${owner.businessId}/invoices`), "invoices");
      const quotes = rowsOf(await apiJson(request, owner, `/commerce/businesses/${owner.businessId}/quotes`), "quotes");
      const describe = (rows: unknown[]) =>
        rows.map((r) => {
          const o = r as Record<string, unknown>;
          return String(o.invoiceNumber ?? o.quoteNumber ?? [o.firstName, o.lastName].filter(Boolean).join(" ") ?? o.id);
        });
      expect.soft(describe(contacts), "contacts seeded at onboarding").toEqual([]);
      expect.soft(describe(invoices), "invoices seeded at onboarding").toEqual([]);
      expect.soft(describe(quotes), "quotes seeded at onboarding").toEqual([]);
    });
    await test.step("Today's Get set up offers the sample as a preview", async () => {
      await page.goto("/app/command-center");
      await expect(page.getByRole("heading", { name: /get set up/i }), "Today's 'Get set up' checklist").toBeVisible();
      await expect(getSetUpBlock(page).getByText(/sample/i).first(), "a sample preview in Get set up").toBeVisible();
    });
  });

  test("A8 day one shows no percentage, no risk count, no red badge and no 'you owe 0'", async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await page.goto("/app/command-center");
    await settle(page);
    // Close a KEY drawer that opened by itself (A9 records it), so Today is readable.
    await page.keyboard.press("Escape");
    const main = page.locator("main").first();
    await expect(main).toBeVisible();
    const text = (await main.innerText()).replace(/\s+/g, " ");

    await test.step("no percentage", async () => {
      expect.soft(text.match(/\d+(?:\.\d+)?\s?%/g) ?? [], "percentages on day one").toEqual([]);
    });
    await test.step("no risk count", async () => {
      expect.soft(text.match(/\b\d+\s+(?:risks?|high-priority|critical)\b|\brisks?\s*\d+/gi) ?? [], "risk counts on day one").toEqual([]);
    });
    await test.step("no 'you owe 0'", async () => {
      expect.soft(text.match(/you owe\s*(?:TTD|USD|TT\$|US\$|\$)?\s*0(?:\.00)?\b/gi) ?? [], "'you owe 0' on day one").toEqual([]);
    });
    await test.step("no red badge", async () => {
      const badges = await main.evaluate((root) => {
        const out: string[] = [];
        for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || r.width > 64 || r.height > 32) continue;
          const text = (el.textContent ?? "").trim();
          if (!/^\d+\+?$/.test(text)) continue;
          const m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
          if (!m) continue;
          const [red, green, blue, alpha = "1"] = m.map(Number) as unknown as [number, number, number, number];
          if (Number(alpha) > 0.3 && red > 150 && green < 110 && blue < 110) out.push(`"${text}" (${getComputedStyle(el).backgroundColor})`);
        }
        return out;
      });
      expect.soft(badges, "red count badges on day one").toEqual([]);
    });
  });

  test("A9 no KEY drawer opens by itself", async ({ page }) => {
    test.setTimeout(2 * 60_000);
    await page.goto("/app/command-center");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    // The shell used to open the drawer 2 s after Today loads for a new owner; wait well past that.
    await page.waitForTimeout(6_000);
    await expect(page.getByRole("heading", { name: /^KEY$/ }).filter({ visible: true }), `a KEY drawer opened by itself (${VARIANT})`).toHaveCount(0);
  });
});
