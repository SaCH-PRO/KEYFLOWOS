import { test, expect } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";

// Load repo-root env so ADMIN_JWT_SECRET is available for test tokens.
require("dotenv").config({ path: "../../.env" });

const API_BASE = "http://127.0.0.1:3001";
const WEB_BASE = "http://localhost:5000";
const BUSINESS_ID = "cmpcs917u00go9z00hvf3wcw3";
const DEV_USER_ID = "381d115d-b2b4-4a32-b493-1989cf9b9355";

function buildAdminToken(userId: string, email: string, role: string): string {
  const secret = process.env.ADMIN_JWT_SECRET || "";
  if (!secret) throw new Error("ADMIN_JWT_SECRET not set");
  const now = Date.now();
  const payload = {
    sub: userId,
    email,
    role,
    iat: now,
    exp: now + 24 * 60 * 60 * 1000,
    type: "admin",
    jti: randomUUID(),
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function seedAuth(page, context) {
  const token = buildAdminToken(DEV_USER_ID, "dev@keyflow.local", "OWNER");
  await page.goto(`${WEB_BASE}/auth/login`);
  await page.evaluate(
    ({ token, bizId }) => {
      window.localStorage.setItem("kf_token", token);
      window.localStorage.setItem("kf_business_id", bizId);
    },
    { token, bizId: BUSINESS_ID },
  );
  await context.addCookies([
    { name: "kf_token", value: token, domain: "localhost", path: "/" },
    { name: "kf_business_id", value: BUSINESS_ID, domain: "localhost", path: "/" },
  ]);
}

test.describe("Key Connect hub smoke", () => {
  test("loads after auth and surfaces Google Drive connector + success toast", async ({ page, context }) => {
    await seedAuth(page, context);

    await page.goto(`${WEB_BASE}/app/key-connect?drive=success`);
    await expect(page).toHaveURL(/\/app\/key-connect/);
    await expect(page.getByRole("heading", { name: "Key Connect" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Google Drive connected")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Google Drive/i).first()).toBeVisible();
  });

  test("Drive OAuth callback route redirects back to Key Connect", async ({ page, context }) => {
    await seedAuth(page, context);
    await page.goto(`${WEB_BASE}/api/drive/callback?code=fake&state=fake`);
    await expect(page).toHaveURL(/\/app\/key-connect/);
  });

  test("renders inline Banking and Social sections", async ({ page, context }) => {
    await seedAuth(page, context);
    await page.goto(`${WEB_BASE}/app/key-connect?tab=banking`);
    await expect(page.getByRole("heading", { name: "Key Connect" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Banking", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Social", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Add connection").first()).toBeVisible();
  });
});
