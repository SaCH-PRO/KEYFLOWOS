import { test, expect } from "@playwright/test";

const API_BASE = "http://127.0.0.1:3001";
const WEB_BASE = "http://127.0.0.1:5000";
const BUSINESS_ID = "cmpcs917u00go9z00hvf3wcw3";

test.describe("Key Connect hub smoke", () => {
  test("loads after setting auth token and surfaces Google Drive connector", async ({ page }) => {
    // 1. Acquire a real backend access token
    const loginRes = await fetch(`${API_BASE}/identity/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dev@keyflow.local", password: "keyflowdev123" }),
    });
    expect(loginRes.ok).toBe(true);
    const login = (await loginRes.json()) as { accessToken: string; refreshToken: string };

    // 2. Seed the web app's auth state exactly like the login page does
    await page.goto(`${WEB_BASE}/auth/login`);
    await page.evaluate(
      ({ token, refresh, bizId }) => {
        window.localStorage.setItem("kf_token", token);
        window.localStorage.setItem("kf_refresh_token", refresh);
        window.localStorage.setItem("kf_business_id", bizId);
      },
      { token: login.accessToken, refresh: login.refreshToken, bizId: BUSINESS_ID },
    );

    // 3. Visit Key Connect with a simulated OAuth success callback
    await page.goto(`${WEB_BASE}/app/key-connect?drive=success`);

    // Fail fast with context if auth sent us back to login
    await expect(page).toHaveURL(/\/app\/key-connect/);

    await expect(page.getByRole("heading", { name: "Key Connect" })).toBeVisible({ timeout: 15_000 });

    // 4. Success toast from the ?drive=success query param should appear
    await expect(page.getByText("Google Drive connected")).toBeVisible({ timeout: 10_000 });

    // 5. Google Drive connector card should render
    await expect(page.getByText(/Google Drive/i).first()).toBeVisible();
  });

  test("Drive OAuth callback route redirects back to Key Connect", async ({ page }) => {
    // The frontend callback proxy should forward to the backend and land on Key Connect
    await page.goto(`${WEB_BASE}/api/drive/callback?code=fake&state=fake`);
    await expect(page).toHaveURL(/\/app\/key-connect/);
  });
});
