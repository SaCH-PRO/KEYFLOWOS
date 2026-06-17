import { test, expect, type Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";

// Load repo-root env so ADMIN_JWT_SECRET is available for test tokens.
require("dotenv").config({ path: "../../.env" });

const WEB_BASE = "http://localhost:5000";
const BUSINESS_ID = "biz-genesis-e2e-0001";
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

function stubGenesisApi(context) {
  // Initial readiness check — low score so the user stays in the Genesis flow.
  context.route(
    new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/readiness$`),
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          overall: 15,
          legal: 10,
          finance: 5,
          market: 20,
          operations: 10,
          compliance: 0,
          blockers: ["Legal readiness is low — confirm your entity type."],
        }),
      }),
  );

  // Idea analysis returns a structured extraction and 3 follow-up questions.
  context.route(
    new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/analyze-idea$`),
    (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          summary:
            "A digital clinic management platform in Trinidad for private doctors, starting with TTD 40,000 and targeting TTD 50,000/month.",
          extracted: {
            identity: {
              archetype: "Clinic management platform",
              industry: "Healthcare technology",
              oneLiner:
                "Digital clinic management platform for private doctors in Trinidad.",
            },
            operatingModel: { revenueModel: "SaaS subscription" },
            customerModel: {
              idealCustomer: "Private doctors and small clinics in Trinidad",
            },
            legalProfile: { recommendedEntityType: "LIMITED_COMPANY" },
            projectionProfile: { startupCapital: 40000 },
          },
          readiness: {
            overall: 22,
            legal: 40,
            finance: 10,
            market: 30,
            operations: 10,
            compliance: 0,
            blockers: [],
          },
          suggestedEntityType: "LIMITED_COMPANY",
          nextQuestions: [
            {
              id: "monthly-fixed-costs",
              section: "projectionProfile",
              field: "monthlyFixedCosts",
              label: "What are your estimated monthly fixed costs?",
              helper: "Rent, software, salaries, utilities, etc.",
              type: "currency",
              priority: 8,
            },
            {
              id: "expected-monthly-units",
              section: "projectionProfile",
              field: "expectedMonthlyUnits",
              label: "How many clinics do you expect to serve per month?",
              helper: "Number of paying clinics or doctors.",
              type: "number",
              priority: 7,
            },
            {
              id: "has-employees",
              section: "registrationProfile",
              field: "hasEmployees",
              label: "Will you hire employees in the next 12 months?",
              type: "boolean",
              priority: 9,
            },
          ],
        }),
      }),
  );

  // Answer submission returns updated readiness and the next question batch.
  context.route(
    new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/answers$`),
    (route: Route) => {
      const postData = route.request().postDataJSON?.() || {};
      const answers = postData.answers || {};
      const answerKeys = Object.keys(answers);

      // If this is the disclaimer acceptance payload, treat it as a legal-profile save.
      const isDisclaimer = answerKeys.includes("legalProfile.disclaimerAcceptedAt");

      // First /answers call comes from the review cards and should surface the first batch.
      const isFirstBatch = answerKeys.some((key) =>
        ["identity.archetype", "customerModel.idealCustomer", "legalProfile.recommendedEntityType"].includes(key),
      );
      const isSecondBatch = answerKeys.some((key) => key.startsWith("projectionProfile.") || key === "registrationProfile.hasEmployees");
      const isThirdBatch = answerKeys.includes("legalProfile.hasPhysicalLocation");

      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          blueprint: {
            identity: { name: "ClinicFlow T&T" },
            legalProfile: { recommendedEntityType: "LIMITED_COMPANY" },
            projectionProfile: {
              startupCapital: 40000,
              monthlyFixedCosts: 8000,
              breakEvenRevenue: 12000,
              runwayMonths: 5,
            },
          },
          readiness: {
            overall: isDisclaimer ? 68 : 55,
            legal: isDisclaimer ? 70 : 50,
            finance: 60,
            market: 50,
            operations: 40,
            compliance: 40,
            blockers: [],
          },
          nextQuestions: isDisclaimer || isThirdBatch
            ? []
            : isFirstBatch
              ? [
                  {
                    id: "monthly-fixed-costs",
                    section: "projectionProfile",
                    field: "monthlyFixedCosts",
                    label: "What are your estimated monthly fixed costs?",
                    helper: "Rent, software, salaries, utilities, etc.",
                    type: "currency",
                    priority: 8,
                  },
                  {
                    id: "expected-monthly-units",
                    section: "projectionProfile",
                    field: "expectedMonthlyUnits",
                    label: "How many clinics do you expect to serve per month?",
                    helper: "Number of paying clinics or doctors.",
                    type: "number",
                    priority: 7,
                  },
                  {
                    id: "has-employees",
                    section: "registrationProfile",
                    field: "hasEmployees",
                    label: "Will you hire employees in the next 12 months?",
                    type: "boolean",
                    priority: 9,
                  },
                ]
              : [
                  {
                    id: "physical-location",
                    section: "legalProfile",
                    field: "hasPhysicalLocation",
                    label: "Will you operate from a physical location?",
                    type: "boolean",
                    priority: 7,
                  },
                ],
          complianceItems: [
            {
              id: "tt-bir",
              label: "Register with the Board of Inland Revenue (BIR)",
              authority: "BIR",
              status: "NOT_STARTED",
              priority: "CRITICAL",
            },
            {
              id: "tt-name",
              label: "Search and reserve your business name",
              authority: "Companies Registry",
              status: "NOT_STARTED",
              priority: "CRITICAL",
            },
          ],
        }),
      });
    },
  );

  // Action plan generation returns a deterministic roadmap.
  context.route(
    new RegExp(`/business-genesis/businesses/${BUSINESS_ID}/generate-roadmap$`),
    (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          roadmap: {
            today: ["Confirm your business name", "Open a dedicated business bank account"],
            sevenDayPlan: ["Reserve business name", "Draft initial service packages"],
            thirtyDayPlan: ["Complete BIR registration", "Set up bookkeeping"],
          },
          complianceItems: [
            {
              id: "tt-bir",
              label: "Register with the Board of Inland Revenue (BIR)",
              authority: "BIR",
              status: "NOT_STARTED",
              priority: "CRITICAL",
            },
          ],
          nextActions: [
            "Confirm your business name with the Companies Registry.",
            "Register with the Board of Inland Revenue (BIR).",
            "Open a dedicated business bank account.",
            "Set up a simple bookkeeping system for TTD revenue and expenses.",
            "Review health-data handling requirements with a local attorney.",
          ],
          projectedRunwayMonths: 5,
          breakEvenRevenue: 12000,
        }),
      }),
  );

  // Identity/bootstrap calls used by the app shell.
  context.route(/\/(identity|connect|crm|commerce|ai)\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

test.describe("Business Genesis onboarding", () => {
  test("completes idea capture, review, questions, readiness dashboard, and action plan", async ({
    page,
    context,
  }) => {
    await seedAuth(page, context);
    await stubGenesisApi(context);

    await page.goto(`${WEB_BASE}/app/onboarding`);

    // Step 1: idea capture
    await expect(page.getByText("Tell KEY what you're building.")).toBeVisible({ timeout: 15_000 });
    await page
      .getByPlaceholder(/digital clinic management platform/i)
      .fill(
        "I want to start a digital clinic management platform in Trinidad for private doctors. I have TTD 40000 to start and want to reach TTD 50000 per month.",
      );
    await page.getByRole("button", { name: /Analyze my business/i }).click();

    // Step 2: extracted profile review
    await expect(page.getByText("Here's what KEY understood")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Business type")).toBeVisible();
    await expect(page.getByText("Target customer")).toBeVisible();
    await page.getByRole("button", { name: /Looks right — continue/i }).click();

    // Step 3: progressive questions (first batch of 3)
    await expect(page.getByText("A few quick questions")).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder(/Rent, software/i).fill("8000");
    await page.getByPlaceholder(/Number of paying clinics/i).fill("20");

    // Boolean toggles are inside the question card next to the label.
    await page
      .locator("div.kf-card", { hasText: /^Will you hire employees in the next 12 months\?$/ })
      .locator("button")
      .first()
      .click();
    await page.getByRole("button", { name: /Submit answers/i }).click();

    // Second batch of questions in the stub.
    await expect(page.getByText("A few quick questions")).toBeVisible({ timeout: 15_000 });
    await page
      .locator("div.kf-card", { hasText: /^Will you operate from a physical location\?$/ })
      .locator("button")
      .first()
      .click();
    await page.getByRole("button", { name: /Submit answers/i }).click();

    // Step 4: readiness dashboard
    await expect(page.getByText("Your Business Readiness")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Overall")).toBeVisible();

    // The overall score is the span immediately before the "Overall" label.
    const scoreText = await page.getByText("Overall").locator("xpath=preceding-sibling::span").textContent();
    const score = Number(scoreText);
    expect(score, "readiness score should be greater than 0").toBeGreaterThan(0);

    // Step 5: generate action plan
    await page.getByRole("button", { name: /Generate action plan/i }).click();

    // Disclaimer modal appears before legal/compliance outputs.
    await expect(page.getByText(/does not replace a licensed attorney/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /I understand/i }).click();

    await expect(page.getByText("Next actions")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Confirm your business name")).toBeVisible();
    await expect(page.locator("ol li")).toHaveCount(5);
  });
});
