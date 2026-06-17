import { test, expect, type Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";

require("dotenv").config({ path: "../../.env" });

const WEB_BASE = "http://localhost:5000";
const BUSINESS_ID = "biz-legal-e2e-0001";
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

function stubLegalHubApi(context) {
  context.route(
    new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/readiness`),
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          overall: 58,
          legal: 70,
          finance: 60,
          market: 50,
          operations: 40,
          compliance: 65,
          blockers: [],
        }),
      }),
  );

  context.route(
    new RegExp(`/blueprint/businesses/${BUSINESS_ID}`),
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          completeness: 100,
          readinessScore: 85,
          identity: { name: "ClinicFlow T&T", country: "Trinidad and Tobago", industry: "Healthcare technology" },
          legalProfile: {
            recommendedEntityType: "LIMITED_COMPANY",
            disclaimerAcceptedAt: new Date().toISOString(),
          },
          complianceProfile: {
            complianceScore: 65,
            complianceItems: [
              {
                id: "tt-name-search",
                label: "Search and reserve/register the business name through the Companies Registry",
                priority: "CRITICAL",
                authority: "Companies Registry",
                status: "NOT_STARTED",
              },
              {
                id: "tt-bir",
                label: "Register with the Board of Inland Revenue and obtain a tax file number",
                priority: "CRITICAL",
                authority: "BIR",
                status: "NOT_STARTED",
              },
            ],
          },
          documentProfile: { generatedDocuments: [], missingDocuments: [] },
        }),
      }),
  );

  context.route(
    new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/document-pack`),
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ generated: [], missing: [] }),
      }),
  );

  context.route(
    new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/generate-document-pack`),
    (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          generated: [
            {
              instanceId: "doc-registration-001",
              documentTypeSlug: "registration-checklist-tt",
              title: "Trinidad & Tobago Business Registration Checklist",
              status: "DRAFT",
              createdAt: new Date().toISOString(),
            },
          ],
          missing: ["privacy-policy", "website-terms"],
        }),
      }),
  );

  context.route(
    new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/generate-risk-register`),
    (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "risk-1", title: "Health data privacy compliance", category: "LEGAL", severity: "HIGH", status: "OPEN" },
          { id: "risk-2", title: "Slow clinic adoption", category: "MARKET", severity: "MEDIUM", status: "OPEN" },
        ]),
      }),
  );

  // Identity/bootstrap calls used by the app shell.
  context.route(/\/(identity|connect|crm|commerce|ai|onboarding-concierge|command)\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

test.describe("Business Genesis legal hub", () => {
  test("renders legal hub, generates document pack, and generates risk register", async ({ page, context }) => {
    await seedAuth(page, context);
    await stubLegalHubApi(context);

    let risksReturned = false;
    await page.route(
      new RegExp(`/governance/businesses/${BUSINESS_ID}/risks\\?status=OPEN`),
      (route: Route) => {
        const body = risksReturned
          ? JSON.stringify([
              { id: "risk-1", title: "Health data privacy compliance", category: "LEGAL", severity: "HIGH", status: "OPEN" },
              { id: "risk-2", title: "Slow clinic adoption", category: "MARKET", severity: "MEDIUM", status: "OPEN" },
            ])
          : "[]";
        return route.fulfill({ status: 200, contentType: "application/json", body });
      },
    );

    await page.goto(`${WEB_BASE}/app/legal`);

    // Hub header and score cards render.
    await expect(page.getByText("Legal & Compliance Hub")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Overall readiness", { exact: true })).toBeVisible();
    await expect(page.getByText("Legal readiness", { exact: true })).toBeVisible();
    await expect(page.getByText("Compliance score", { exact: true })).toBeVisible();

    // Compliance checklist renders with seeded items.
    await expect(page.getByText("Compliance checklist")).toBeVisible();
    await expect(page.getByText("Search and reserve/register the business name")).toBeVisible();
    await expect(page.getByText("Register with the Board of Inland Revenue")).toBeVisible();

    // Document pack generation.
    const generateDocBtn = page.getByRole("button", { name: /Generate document pack/i });
    await expect(generateDocBtn).toBeVisible();
    await generateDocBtn.click();

    await expect(page.getByText("Trinidad & Tobago Business Registration Checklist")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Missing document types")).toBeVisible();
    await expect(page.getByText("Privacy Policy")).toBeVisible();
    await expect(page.getByText("Website Terms of Use")).toBeVisible();

    // Risk register generation.
    await expect(page.getByText("Risk register")).toBeVisible();
    const generateRiskBtn = page.getByRole("button", { name: /Generate from blueprint/i });
    await expect(generateRiskBtn).toBeVisible();

    // Flip the risks stub before clicking so the post-generate refresh returns data.
    risksReturned = true;
    await generateRiskBtn.click();

    await expect(page.getByText("Health data privacy compliance")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Slow clinic adoption")).toBeVisible();
  });
});
