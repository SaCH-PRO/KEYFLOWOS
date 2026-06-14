import { test, expect } from "@playwright/test";

const API_BASE = "http://127.0.0.1:3001";
const WEB_BASE = "http://127.0.0.1:5000";

test("debug auth flow", async ({ page }) => {
  const loginRes = await fetch(`${API_BASE}/identity/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "dev@keyflow.local", password: "keyflowdev123" }),
  });
  expect(loginRes.ok).toBe(true);
  const login = (await loginRes.json()) as { accessToken: string };

  await page.goto(`${WEB_BASE}/auth/login`);
  await page.evaluate(
    ({ token }) => {
      window.localStorage.setItem("kf_token", token);
      window.localStorage.setItem("kf_business_id", "cmpcs917u00go9z00hvf3wcw3");
    },
    { token: login.accessToken },
  );

  const stored = await page.evaluate(() => window.localStorage.getItem("kf_token"));
  console.log("stored token length:", stored?.length);

  const meRes = await page.evaluate(async (api) => {
    const token = window.localStorage.getItem("kf_token");
    const res = await fetch(`${api}/identity/me`, {
      headers: { Authorization: `Bearer ${token || ""}` },
    });
    return { status: res.status, body: await res.text().catch(() => "") };
  }, `${WEB_BASE}/__api`);
  console.log("/identity/me response:", meRes);

  await page.goto(`${WEB_BASE}/app/key-connect?drive=success`);
  console.log("page url:", page.url());
  console.log("page title:", await page.title());
});
