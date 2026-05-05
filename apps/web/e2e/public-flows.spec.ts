import { test, expect, type Route } from "@playwright/test";

const API = "http://api.test.local";

test.describe("Public flows: failure paths recover with CTAs", () => {
  test("/order/[token] not-found offers retry and back-to-store when business is known", async ({ page }) => {
    let calls = 0;
    await page.route(`${API}/marketplace/order-status/**`, async (route: Route) => {
      calls += 1;
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Not found",
          business: { name: "Acme Co", slug: "acme", whatsapp: "+18681234567" },
        }),
      });
    });

    await page.goto("/order/missing-token");
    await expect(page.getByRole("heading", { name: /Order Not Found/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Try again/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to store/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Message Acme Co on WhatsApp/i })).toBeVisible();
    await page.getByRole("button", { name: /Try again/i }).click();
    await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
  });

  test("/order/[token] not-found shows error with retry-friendly message and back-to-home", async ({ page }) => {
    await page.route(`${API}/marketplace/order-status/**`, async (route: Route) => {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not found" }) });
    });

    await page.goto("/order/missing-token");
    await expect(page.getByRole("heading", { name: /Order Not Found/i })).toBeVisible();
    await expect(page.getByText(/We couldn't find this order/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to home/i })).toBeVisible();
  });

  test("/order/[token] success surfaces WhatsApp CTA when business has it", async ({ page }) => {
    await page.route(`${API}/marketplace/order-status/**`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "o1",
          orderNumber: "ORD-001",
          status: "PROCESSING",
          customerName: "Test Customer",
          total: 99.99,
          currency: "USD",
          createdAt: new Date().toISOString(),
          items: [{ id: "i1", name: "Test Item", quantity: 1, unitPrice: 99.99, total: 99.99 }],
          shipments: [],
          business: {
            name: "Acme Co",
            email: "hello@acme.test",
            phone: "+18681234567",
            whatsapp: "+18681234567",
            slug: "acme",
          },
          statusTimeline: [],
        }),
      });
    });

    await page.goto("/order/good-token");
    await expect(page.getByText("ORD-001")).toBeVisible();
    const wa = page.getByRole("link", { name: /Message on WhatsApp/i });
    await expect(wa).toBeVisible();
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\//);
  });

  test("/pay/link/[token] expired link shows recoverable error with retry", async ({ page }) => {
    await page.route(`${API}/commerce/payment-links/**`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invoiceId: "x", active: false, expiresAt: null }),
      });
    });

    await page.goto("/pay/link/dead-token");
    await expect(page.getByRole("heading", { name: /Payment Link Error/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Try again/i })).toBeVisible();
  });

  test("/pay/link/[token] valid link redirects to /pay/[invoiceId]", async ({ page }) => {
    await page.route(`${API}/commerce/payment-links/**`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invoiceId: "inv_123", active: true, expiresAt: null }),
      });
    });
    // Stub invoice endpoint so the redirect target doesn't error
    await page.route(`${API}/commerce/invoices/**`, async (route: Route) => {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
    await page.route(`${API}/payments/invoice/**`, async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ gateways: [] }) });
    });

    await page.goto("/pay/link/good-token");
    await page.waitForURL("**/pay/inv_123", { timeout: 10_000 });
  });
});
