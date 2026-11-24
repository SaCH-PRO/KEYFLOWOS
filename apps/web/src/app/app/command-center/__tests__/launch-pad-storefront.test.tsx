/**
 * NAV-A3 (sweep BUG-108): the Launch Pad's Storefront tile opens the store.
 *
 * Before: Today > Launch > Storefront linked /app/commerce, the Sales hub; the store is /app/store.
 * The Today page is rendered for real (as approved-actions-mount.test.tsx does); only `fetch` and the router are
 * stubbed: the cockpit snapshot answers, every other read answers 503. RED-BEFORE fails on the packet's base (f6764f4c).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { GenomeProvider } from "@/contexts/genome-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/command-center",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

const BIZ = "biz_a3_launch";
const NOW = "2026-11-24T10:00:00.000Z";

/** The cockpit snapshot (business-command-center.types.ts), minimal and healthy. */
function cockpitSnapshot() {
  const ok = (label: string) => ({ label, status: "OK", fetchedAt: NOW });
  return {
    businessId: BIZ, generatedAt: NOW,
    health: {
      genomeIntegrity: 0, executiveReadinessScore: 0, genomeStage: "SEED", criticalCount: 0, highPriorityCount: 0,
      pendingApprovalCount: 0, approvedAwaitingExecutionCount: 0, urgentTemporalCount: 0, pendingGenomeProposalCount: 0,
      assetRiskCount: 0, constitutionStale: false, keyGenomeOverall: 0, keyGenomeReadiness: 0, keyGenomeConfidence: 0,
      blockedModuleCount: 0, lowReadinessModuleCount: 0, missingBlockingFactCount: 0,
    },
    summary: "Cockpit summary.",
    pulse: { overallScore: 0, dimensions: [] },
    briefing: { headline: "No urgent actions today.", bullets: [], warnings: [] },
    governance: { autoReady: 0, needsApproval: 0, dueToday: 0, urgentRisks: 0 },
    topPriorities: [], pendingApprovals: [], approvedAwaitingExecution: [], urgentItems: [], risks: [], opportunities: [],
    genome: { integrity: 0, readiness: 0, stage: "SEED", pendingProposals: [], weakestSections: [] },
    keyGenome: { overall: 0, integrity: 0, readiness: 0, confidence: 0, computedAt: NOW, sections: [], weakestSections: [] },
    moduleReadiness: [],
    constitution: { latestVersion: null, stale: false, reason: null, href: "/app/profile?tab=business-genome&section=constitution" },
    executiveModes: [], recommendedActions: [], degraded: false,
    sources: { pendingApprovals: ok("pendingApprovals"), contacts: ok("contacts"), openInvoices: ok("openInvoices"), payments: ok("payments") },
    results: {
      contacts: { label: "Contacts", count: 1, status: "OK", href: "/app/crm/contacts" },
      openInvoices: { label: "Open invoices", count: 0, status: "OK", href: "/app/commerce/invoices" },
      payments: { label: "Payments", count: 2, status: "OK", href: "/app/payments" },
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Service Unavailable",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if (pathname.endsWith(`/business-command-center/businesses/${BIZ}/snapshot`)) return jsonResponse(200, cockpitSnapshot());
    return jsonResponse(503, { message: "Service Unavailable" });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NAV-A3: the Launch Pad's Storefront tile (BUG-108)", () => {
  it("RED-BEFORE: Today > Launch > Storefront opens /app/store, not the Sales hub", async () => {
    const { default: Page } = await import("@/app/app/command-center/page");
    render(
      <GenomeProvider>
        <Page />
      </GenomeProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open module launcher" }, { timeout: 10_000 }));
    // The sheet may render more than one copy (a phone and a desktop layout): every copy's tile must agree.
    const pads = await screen.findAllByRole("dialog", { name: /launch pad/i });
    const hrefs = pads.flatMap((pad) => within(pad).getAllByRole("link", { name: /storefront/i })).map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(new Set(hrefs)).toEqual(new Set(["/app/store"]));
  }, 20_000);

  it("CONTROL: the Commerce tile still opens the Sales hub", async () => {
    const { default: Page } = await import("@/app/app/command-center/page");
    render(
      <GenomeProvider>
        <Page />
      </GenomeProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open module launcher" }, { timeout: 10_000 }));
    const pads = await screen.findAllByRole("dialog", { name: /launch pad/i });
    const hrefs = pads.flatMap((pad) => within(pad).getAllByRole("link", { name: /^commerce$/i })).map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(new Set(hrefs)).toEqual(new Set(["/app/commerce"]));
  }, 20_000);
});
