import { test, expect, type Page, type Request, type Route } from "@playwright/test";
import { TEST_BUSINESS_ID, e2eBaseURL, mockBaseLayout, mockCatchAll, seedWorkspace } from "./helpers/workspace";

/**
 * FU-PUSH-OPTIN-MY-ACCOUNT (owner ruling D-282), the browser half. The jsdom half is
 * src/app/app/settings/profile/__tests__/my-account-push.test.tsx (PSH-01..11) and
 * src/app/app/settings/notifications/__tests__/notifications-push-moved.test.tsx (NPM-01..03).
 *
 * A member whose settings access is none (D-276: no Settings > Notifications) opens My account and turns push on and
 * off for their own device.
 *
 *   PSB-01 a settings-none member turns push on from My account, then off: the device is saved and removed at the API
 *          (api.test.local/api/businesses/:id/push/...) with the member's token; nothing is sent to the web origin's
 *          /api/businesses (RED at the base: My account has no push control).
 *   PSB-02 the same member's settings strip has no Notifications link, and the page does not scroll sideways (guard).
 *
 * Run at 375, 768, 1024 and 1440. The browser context has the notifications permission granted. Headless Chromium
 * cannot subscribe to a real push service, and this run must not reach one, so the init script replaces the service
 * worker registration and its PushManager with a fake that hands out a subscription to https://push.example.invalid.
 *
 * Mocked: every API call is answered by page.route on api.test.local; skipped under E2E_LIVE. It is the packet's
 * browser proof, not one of CI's fixed e2e-mocked specs.
 *   pnpm run build (NEXT_PUBLIC_API_BASE_URL=http://api.test.local), then
 *   E2E_WEB_COMMAND=standalone E2E_PORT=5400 pnpm exec playwright test e2e/sweep-push-optin.spec.ts --project=chromium
 */

test.skip(process.env.E2E_LIVE === "1", "mocked sweep: runs without a live API");

/**
 * The full Chromium in its new headless mode, not the default headless shell: the shell reports
 * Notification.permission "denied" even after grantPermissions(["notifications"]) (navigator.permissions says
 * "granted"), so the page would show a member who blocked notifications. Probed on Playwright's chromium-1243.
 */
test.use({ channel: "chromium" });

const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];
const FRONT_DESK = { modules: Object.fromEntries(ALL.map((m) => [m, m === "bookings" || m === "crm" ? "read" : "none"])) };

/** A VAPID public key's shape: 65 bytes, base64url. */
const VAPID_PUBLIC = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i * 7 + 4) % 256)).toString("base64url");
const ENDPOINT = "https://push.example.invalid/send/e2e-device";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT_SHAPED = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "user_e2e", exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;

interface Seen { method: string; url: string; auth: string | null; body: unknown }

/** Replaces the service worker registration and its PushManager: no push service is contacted. */
function fakePush(endpoint: string): void {
  const state: { sub: unknown; subscribed: number; unsubscribed: number } = { sub: null, subscribed: 0, unsubscribed: 0 };
  const makeSub = () => ({
    endpoint,
    expirationTime: null,
    options: { userVisibleOnly: true },
    getKey: () => null,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "e2e-p256dh", auth: "e2e-auth" } }),
    unsubscribe: async () => {
      state.sub = null;
      state.unsubscribed += 1;
      return true;
    },
  });
  const pushManager = {
    getSubscription: async () => state.sub,
    permissionState: async () => "granted",
    subscribe: async () => {
      state.sub = makeSub();
      state.subscribed += 1;
      return state.sub;
    },
  };
  const registration = { scope: `${location.origin}/`, pushManager, active: { state: "activated" }, unregister: async () => true };
  const container = ServiceWorkerContainer.prototype;
  Object.defineProperty(container, "getRegistration", { value: async () => registration, configurable: true });
  Object.defineProperty(container, "register", { value: async () => registration, configurable: true });
  Object.defineProperty(container, "ready", { get: () => Promise.resolve(registration), configurable: true });
  (window as unknown as { __kfPush: typeof state }).__kfPush = state;
}

async function signIn(page: Page): Promise<{ push: Seen[]; webOrigin: string[] }> {
  await page.context().grantPermissions(["notifications"], { origin: e2eBaseURL() });
  await seedWorkspace(page.context());
  await page.context().addCookies([{ name: "kf_token", value: JWT_SHAPED, url: e2eBaseURL(), sameSite: "Lax" }]);
  await page.context().addInitScript((token) => window.localStorage.setItem("kf_token", token), JWT_SHAPED);
  await page.context().addInitScript(fakePush, ENDPOINT);
  await mockCatchAll(page);
  await mockBaseLayout(page, { business: { sells: "services", advancedCrm: false } });
  await page.route(/\/identity\/businesses(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: TEST_BUSINESS_ID, name: "E2E Test Business" }]) }),
  );
  await page.route(`**/identity/businesses/${TEST_BUSINESS_ID}/my-access**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FRONT_DESK) }),
  );
  await page.route("**/identity/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "user_e2e", email: "frontdesk@example.com", name: "Front Desk", firstName: "Front", lastName: "Desk", phone: null, avatarUrl: null }),
    }),
  );

  const push: Seen[] = [];
  await page.route(`**/api.test.local/api/businesses/${TEST_BUSINESS_ID}/push/**`, async (route: Route) => {
    const req = route.request();
    const body = req.postData() ? (JSON.parse(req.postData() as string) as unknown) : undefined;
    push.push({ method: req.method(), url: req.url(), auth: req.headers()["authorization"] ?? null, body });
    if (req.url().endsWith("/push/config")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ publicKey: VAPID_PUBLIC, enabled: true }) });
    }
    if (req.url().endsWith("/push/subscribe")) return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "psub_e2e" }) });
    if (req.url().endsWith("/push/unsubscribe")) return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ count: 1 }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
  });

  // What the base's hook sent: /api/businesses/... on the web origin, which has no such route.
  const webOrigin: string[] = [];
  page.on("request", (req: Request) => {
    if (req.url().startsWith(`${e2eBaseURL()}/api/businesses`)) webOrigin.push(req.url());
  });
  return { push, webOrigin };
}

for (const [width, height] of [[375, 812], [768, 1024], [1024, 900], [1440, 900]] as const) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test(`PSB-01 a settings-none member turns push on and off from My account (${width})`, async ({ page }, info) => {
      const seen = await signIn(page);
      await page.goto("/app/settings/profile");
      const heading = page.getByRole("heading", { name: /push notifications on this device/i });
      await expect(heading).toBeVisible({ timeout: 20_000 });
      const section = page.locator("section").filter({ has: heading });
      await expect(section.getByText(/off for this device/i)).toBeVisible();
      // The section is the last on the page. Scrolled to the bottom, its button is not under the phone's fixed bottom
      // nav (the scroll root's pb-28 clears it): what is at the button's centre is the button.
      const turnOn = section.getByRole("button", { name: /turn on/i });
      await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[data-scroll-root="app"]');
        if (root) root.scrollTop = root.scrollHeight;
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      await page.waitForTimeout(300);
      expect(
        await turnOn.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (hit === el || el.contains(hit));
        }),
        "Turn on is not covered at the bottom of the page",
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`push-off-${width}.png`) });

      await turnOn.click();
      await expect(section.getByText(/on for this device/i)).toBeVisible();
      await expect(section.getByRole("button", { name: /turn off/i })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`push-on-${width}.png`) });

      const saves = seen.push.filter((r) => r.url.endsWith("/push/subscribe"));
      expect(saves).toHaveLength(1);
      expect(saves[0].method).toBe("POST");
      expect(saves[0].auth).toBe(`Bearer ${JWT_SHAPED}`);
      expect((saves[0].body as { subscription: { endpoint: string } }).subscription.endpoint).toBe(ENDPOINT);
      expect(await page.evaluate(() => (window as unknown as { __kfPush: { subscribed: number } }).__kfPush.subscribed)).toBe(1);

      await section.getByRole("button", { name: /turn off/i }).click();
      await expect(section.getByText(/off for this device/i)).toBeVisible();
      const removes = seen.push.filter((r) => r.url.endsWith("/push/unsubscribe"));
      expect(removes).toHaveLength(1);
      expect(removes[0].auth).toBe(`Bearer ${JWT_SHAPED}`);
      expect(removes[0].body).toEqual({ endpoint: ENDPOINT });
      expect(await page.evaluate(() => (window as unknown as { __kfPush: { unsubscribed: number } }).__kfPush.unsubscribed)).toBe(1);

      expect(seen.webOrigin, "nothing is sent to the web origin's /api/businesses").toEqual([]);
      await expect(section.getByRole("alert")).toHaveCount(0);
    });

    test(`PSB-02 the settings-none member's strip has no Notifications link, and nothing scrolls sideways (${width})`, async ({ page }) => {
      await signIn(page);
      await page.goto("/app/settings/profile");
      await expect(page.getByRole("heading", { name: /my account/i })).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1_500);
      await expect(page.locator('a[href="/app/settings/notifications"]').filter({ visible: true })).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
