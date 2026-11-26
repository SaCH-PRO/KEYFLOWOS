import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, settle, type Tenant } from "./journeys/journey-helpers";

/**
 * SWP-CRM-WEB-POLISH, the browser half (sweep BUG-080, BUG-130, BUG-082; journey C). The jsdom half is
 * src/app/app/crm/__tests__/crm-web-polish.test.tsx.
 *
 * Three customers are seeded through the API (Kwame, Ama, Kofi; one of them a CLIENT). Then, at 375x812, 768x1024,
 * 1024x768 and 1440x900, in the light AND the dark theme:
 *
 *   1. BUG-130  /app/crm/dashboard: the "CRM Dashboard" heading reads against the page (contrast at least 3:1 between
 *               its colour and the background under it), and the segment of CLIENT contacts is labelled "Clients".
 *   2. BUG-082  /app/crm/dashboard: no "Next actions" card (it stood empty while the customers screen listed next
 *               actions; fixed by removal).
 *   3. BUG-080  /app/crm/contacts?view=table: "Kwame" typed in the screen's own search ("Search contacts") leaves
 *               only Kwame's row in the table, and the table's count and pager say 1 of 1, as the rows do.
 *
 * Journey C step C8 (the first customer row in the top half at 375x812) is not asserted here: it is
 * e2e/journeys/c-customer.spec.ts C8, run separately.
 *
 * Live only (E2E_LIVE=1, a production build, a real API and database: the journey harness's own fixtures, README in
 * e2e/journeys); without E2E_LIVE every case is skipped. Run it in the "chromium" project.
 *
 * Each check is a soft assertion (D-274 A7), so the base run shows every step's own RED, not only the first.
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });
const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

async function seed(request: APIRequestContext, owner: Tenant, firstName: string, lastName: string, extra: Record<string, unknown> = {}) {
  const res = await request.fetch(`${API_URL}/crm/businesses/${owner.businessId}/contacts`, {
    method: "POST",
    headers: auth(owner),
    data: { firstName, lastName, ...extra },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** WCAG contrast ratio between an element's text colour and the first opaque background behind it. */
async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a: a === undefined ? 1 : a };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fg = parse(getComputedStyle(el).color)!;
    let node: Element | null = el;
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.5) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  });
}

async function useTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
}

const WIDTHS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

for (const viewport of WIDTHS) {
  for (const theme of ["light", "dark"] as const) {
    test(`CRM polish at ${viewport.width}x${viewport.height}, ${theme} theme`, async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      await page.setViewportSize(viewport);
      await useTheme(page, theme);
      const tag = stamp();
      await seed(request, owner, "Kwame", `Mensah${tag}`);
      await seed(request, owner, "Ama", `Owusu${tag}`, { status: "CLIENT" });
      await seed(request, owner, "Kofi", `Boateng${tag}`);

      // 1. BUG-130: the dashboard heading reads in this theme; CLIENT contacts are "Clients".
      await page.goto("/app/crm/dashboard");
      await settle(page, 1_500);
      const heading = page.getByRole("heading", { name: "CRM Dashboard" });
      await expect.soft(heading, "the dashboard heading").toBeVisible();
      if (await heading.count()) {
        const ratio = await contrastOf(page, "h1:has-text('CRM Dashboard')");
        expect.soft(ratio, `the heading's contrast against the page (${theme})`).toBeGreaterThanOrEqual(3);
      }
      await expect.soft(page.getByText("Clients", { exact: true }).first(), "the CLIENT segment is labelled Clients").toBeVisible();

      // 2. BUG-082: the dashboard draws no Next actions card (it stood empty: "0 contacts", while the customers
      // screen listed next actions; fixed by removal).
      await expect.soft(page.getByText(/^next actions$/i), "no Next actions card on the CRM dashboard").toHaveCount(0);

      // 3. BUG-080: the table view honours the screen's search, and its count agrees with its rows.
      await page.goto("/app/crm/contacts?view=table");
      await settle(page, 1_500);
      const table = page.getByRole("grid", { name: "Contacts database table" });
      const row = (last: string) => table.getByRole("row").filter({ hasText: `${last}${tag}` });
      await expect.soft(row("Boateng"), "before the search, the table shows every customer").toHaveCount(1);
      await page.getByRole("textbox", { name: "Search contacts", exact: true }).fill("Kwame");
      await settle(page, 1_500);
      await expect.soft(row("Mensah"), "Kwame's row").toHaveCount(1);
      await expect.soft(row("Owusu"), "no row for Ama").toHaveCount(0);
      await expect.soft(row("Boateng"), "no row for Kofi").toHaveCount(0);
      // The tenant holds the three customers and the harness's own sample one; only Kwame matches.
      await expect.soft(page.getByText("1 of 1", { exact: true }).first(), "the table's count says 1 of 1").toBeVisible();
      // The pager's "Showing" line is hidden below 640px by design (hidden sm:inline), so its text is checked, not shown.
      await expect.soft(page.getByText(/^Showing 1-1 of 1$/), "the table's pager says 1 of 1").toHaveCount(1);
    });
  }
}
