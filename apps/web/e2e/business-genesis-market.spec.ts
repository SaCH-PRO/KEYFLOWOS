import { test, expect, type Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";

require("dotenv").config({ path: "../../.env" });

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
  const token = buildAdminToken(DEV_USER_ID, "dev@keyflow.local", "SUPER_ADMIN");
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

const stubStrategyPayload = {
  strategy: {
    id: "ms-e2e-001",
    businessId: BUSINESS_ID,
    generatedAt: new Date().toISOString(),
    swot: {
      strengths: ["Niche focus on Caribbean clinics", "Founder has clinical operations background"],
      weaknesses: ["Limited brand awareness", "Small initial budget"],
      opportunities: ["Underserved private clinics", "Government digital-health incentives"],
      threats: ["Incumbent practice-management tools", "Economic volatility"],
    },
    pestle: {
      political: "Stable regulatory environment with emerging digital-health policies.",
      economic: "Small-market dynamics require lean pricing and high retention.",
      social: "Clinics are increasingly open to cloud tools post-pandemic.",
      technological: "Mobile-first expectations and API integrations are table stakes.",
      legal: "Health-data privacy and patient-record retention rules apply.",
      environmental: "Remote-first delivery minimizes physical footprint.",
    },
    positioning: {
      tagline: "The clinic command centre for the Caribbean.",
      valueProposition: "All-in-one scheduling, records, and billing built for private Caribbean clinics.",
      keyMessages: ["Designed for Caribbean clinics", "Fast setup, local support", "Compliance-aware from day one"],
      differentiators: ["Local payment integrations", "T&T-specific reporting", "Affordable tiered pricing"],
      targetSegments: ["Private general practices", "Small specialist clinics"],
    },
    launchPlan: {
      summary: "A focused 90-day launch to establish credibility and onboard early clinic partners.",
      phases: [
        { name: "Foundation", duration: "Weeks 1–4", actions: ["Landing page live", "Demo video recorded", "5 pilot clinics recruited"] },
        { name: "Launch", duration: "Weeks 5–8", actions: ["Paid social campaign", "Webinar for doctors", "Onboard pilot users"] },
        { name: "Scale", duration: "Weeks 9–12", actions: ["Referral programme", "Case studies published", "Iterate pricing"] },
      ],
    },
    analysisSummary: { marketOpportunityScore: 72, keyInsight: "Strong niche opportunity with limited local competition." },
  },
  competitors: [
    { id: "comp-1", businessId: BUSINESS_ID, name: "Generic global EMR", threatLevel: "MEDIUM", strengths: ["Feature depth"], weaknesses: ["High cost", "Poor local support"], positioning: "International enterprise software" },
    { id: "comp-2", businessId: BUSINESS_ID, name: "Local spreadsheets", threatLevel: "LOW", strengths: ["Free"], weaknesses: ["No collaboration", "Error-prone"], positioning: "DIY manual workflows" },
  ],
  documentInstanceId: `market-strategy:${BUSINESS_ID}`,
  readiness: {
    overall: 65,
    legal: 75,
    finance: 80,
    market: 85,
    operations: 40,
    compliance: 30,
    blockers: [],
  },
};

async function stubBlueprintRoute(page) {
  await page.route(new RegExp(`/blueprint/businesses/${BUSINESS_ID}`), (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completeness: 60 }) }),
  );
}

test.describe("Market Strategy hub", () => {
  test("loads and displays the generated strategy", async ({ page, context }) => {
    await seedAuth(page, context);
    await stubBlueprintRoute(page);

    await page.route(new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/market-strategy`), (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubStrategyPayload) }),
    );

    await page.goto(`${WEB_BASE}/app/market`, { timeout: 60_000 });
    await page.waitForResponse(new RegExp(`/__api/business-genesis/businesses/${BUSINESS_ID}/market-strategy`));

    await expect(page.getByText("Market Strategy & Intelligence").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Market readiness").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Competitors tracked").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Launch actions").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("link", { name: /View strategy document/i })).toBeVisible({ timeout: 10000 });
  });

  test("renders empty state and generates strategy", async ({ page, context }) => {
    await seedAuth(page, context);
    await stubBlueprintRoute(page);

    await page.route(new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/market-strategy`), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategy: null, competitors: [], documentInstanceId: null, readiness: stubStrategyPayload.readiness }),
      }),
    );

    await page.route(new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/generate-market-strategy`), (route: Route) =>
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(stubStrategyPayload) }),
    );

    await page.goto(`${WEB_BASE}/app/market`, { timeout: 60_000 });
    await expect(page.getByText("Build your market strategy").first()).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Generate market strategy" }).click();
    await expect(page.getByText("Market readiness").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Generic global EMR").first()).toBeVisible({ timeout: 10000 });
  });
});
