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

  // V1-46 (D-07, token links only): /pay/link/[token] is the pay page. It
  // reads GET /commerce/public/invoice-link/:token/pay (404 for an unknown,
  // deactivated or expired link) and no longer resolves the token to an
  // invoice id or navigates to /pay/[invoiceId].
  test("/pay/link/[token] expired link shows recoverable error with retry", async ({ page }) => {
    let reads = 0;
    await page.route(`${API}/commerce/public/invoice-link/dead-token/pay`, async (route: Route) => {
      reads += 1;
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 404, message: "Invoice not found" }),
      });
    });

    await page.goto("/pay/link/dead-token");
    await expect(page.getByRole("heading", { name: /Payment Link Error/i })).toBeVisible();
    await expect(page.getByText(/invalid, has expired or has been deactivated/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Try again/i })).toBeVisible();
    expect(reads).toBeGreaterThanOrEqual(1);
  });

  test("/pay/link/[token] valid link renders the invoice on the token page, with no redirect to /pay/[invoiceId]", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (req) => requested.push(new URL(req.url()).pathname));
    await page.route(`${API}/commerce/public/invoice-link/good-token/pay`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "inv_123",
          businessId: "biz_1",
          invoiceNumber: "INV-0123",
          status: "SENT",
          total: 100,
          remaining: 100,
          currency: "TTD",
          subtotal: 100,
          taxRate: 0,
          taxAmount: 0,
          discountAmount: 0,
          notes: null,
          issueDate: new Date().toISOString(),
          dueDate: null,
          items: [{ id: "it1", description: "Consulting", quantity: 1, unitPrice: 100, total: 100 }],
          contact: { firstName: "Ada", lastName: "Customer" },
          business: { name: "Acme Co", logoUrl: null, primaryColor: "#F97316" },
        }),
      });
    });
    await page.route(`${API}/payments/invoice/**`, async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ gateways: [] }) });
    });

    await page.goto("/pay/link/good-token");
    await expect(page.getByText("INV-0123").first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/pay/link/good-token");
    expect(requested.some((p) => p.startsWith("/commerce/payment-links/"))).toBe(false);
    expect(requested.some((p) => p.startsWith("/commerce/invoices/"))).toBe(false);
  });
});
