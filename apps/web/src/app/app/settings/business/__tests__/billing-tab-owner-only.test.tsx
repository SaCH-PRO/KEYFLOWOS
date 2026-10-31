/**
 * R0-08 / R0-08c-SUBSCRIPTION-AUTHORITY — the billing tab names the owner-only
 * rule when the server refuses a plan change.
 *
 * WHY this test exists: R0-08 made /app/settings/billing the one-click
 * destination of every plan-limit prompt any member sees, and R0-08c makes the
 * plan-change routes (trial, activate, cancel, checkout, record-payment) OWNER
 * only: a member who is not the owner gets 403 {code:'SUBSCRIPTION_OWNER_ONLY'}.
 * The tab must tell that member who can act — "Only the business owner can
 * change the plan." — keyed on the code, not on whatever wording the server's
 * message happens to carry, and must not report a success.
 *
 * Mounted on the real BillingTab and the real api client (lib/api.ts); only
 * `fetch` and the toast are stubbed, so the error shape under test is the one
 * apiPost really produces from the production GlobalHttpExceptionFilter body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { BillingTab } from "../billing-tab";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const BUSINESS = "biz_1";
const OWNER_ONLY_TEXT = "Only the business owner can change the plan.";

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

const DASHBOARD = {
  plan: { id: "FREE", name: "Free", tagline: "", status: "ACTIVE", trialExpired: false, subscription: null },
  billing: { totalMonthlyCost: 0, currency: "TTD", breakdown: [], periodStart: "2026-10-01", periodEnd: "2026-10-31", nextBillingDate: null },
  aiUsage: {
    creditsUsed: 0, creditsLimit: 50, creditsRemaining: 50, isUnlimited: false, overageCredits: 0,
    overageCost: 0, overageCurrency: "TTD", estimatedApiCost: 0, byFeature: [],
  },
  resourceUsage: [],
  featureAccess: [],
  featureMatrix: [],
  categories: {},
};

/** The production filter's body for the owner-only refusal (http-exception.filter.ts). */
function ownerOnly(message = OWNER_ONLY_TEXT) {
  return jsonResponse(403, {
    statusCode: 403, code: "SUBSCRIPTION_OWNER_ONLY", message, error: "Forbidden",
    timestamp: "2026-10-31T00:00:00.000Z", path: "/subscriptions",
  }, "Forbidden");
}

/** Answers the dashboard read, and every plan-change POST with `onPost`. Returns the POSTed paths. */
function stubServer(onPost: () => Response) {
  const posted: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if ((init?.method ?? "GET") === "POST") {
      posted.push(pathname);
      return onPost();
    }
    if (pathname.endsWith(`/subscriptions/businesses/${BUSINESS}/billing-dashboard`)) return jsonResponse(200, DASHBOARD);
    return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  }));
  return { posted };
}

describe("billing tab: a plan change refused as SUBSCRIPTION_OWNER_ONLY names the owner-only rule", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", BUSINESS);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("[R0-08c-W01] Start Trial refused with SUBSCRIPTION_OWNER_ONLY shows 'Only the business owner can change the plan.' and no success", async () => {
    // A server whose message wording differs: the tab keys on the code.
    const { posted } = stubServer(() => ownerOnly("Forbidden resource"));
    render(<BillingTab />);

    const [startTrial] = await screen.findAllByRole("button", { name: /Start Trial/ });
    fireEvent.click(startTrial);

    expect(await screen.findByText(OWNER_ONLY_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/trial started/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Forbidden resource")).not.toBeInTheDocument();
    expect(posted).toEqual([`/subscriptions/businesses/${BUSINESS}/trial`]);
  });

  it("[R0-08c-W02] Pay -> Activate refused with SUBSCRIPTION_OWNER_ONLY shows the owner-only message and does not report the plan activated", async () => {
    const { posted } = stubServer(() => ownerOnly());
    render(<BillingTab />);

    const [pay] = await screen.findAllByRole("button", { name: /Pay/ });
    fireEvent.click(pay);
    fireEvent.click(await screen.findByRole("button", { name: /Activate FLOW/ }));

    expect(await screen.findByText(OWNER_ONLY_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/plan activated/i)).not.toBeInTheDocument();
    expect(posted).toEqual([`/subscriptions/businesses/${BUSINESS}/record-payment`]);
  });

  it("[R0-08c-W03] control: any other refusal still shows the server's own message", async () => {
    stubServer(() => jsonResponse(400, { statusCode: 400, code: "BAD_REQUEST", message: "Business already has an active subscription" }, "Bad Request"));
    render(<BillingTab />);

    const [startTrial] = await screen.findAllByRole("button", { name: /Start Trial/ });
    fireEvent.click(startTrial);

    expect(await screen.findByText("Business already has an active subscription")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(OWNER_ONLY_TEXT)).not.toBeInTheDocument());
  });
});
