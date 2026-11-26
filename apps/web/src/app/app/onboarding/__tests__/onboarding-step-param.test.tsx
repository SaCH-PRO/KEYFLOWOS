/**
 * TODAY-4BLOCK, BUG-010 web half (SWP-CONCIERGE-TRUTH): an old setup link `?step=products|hours|storefront|payments`
 * on a COMPLETED onboarding opens that step's real page instead of bouncing the owner to Today.
 *
 * WHY: use-onboarding.ts mapped the setup-status names onto onboarding steps (products -> template, hours and
 * storefront -> configure), found the onboarding already complete, and ended with router.replace('/app/command-center'):
 * every "Add products" / "Set your hours" / "Open your store" nudge landed on Today, which then nudged again (the
 * sweep repro). The pages are the ones TODAY-AGGREGATE's Get set up names (today.service.ts buildGetSetUp):
 * catalog /app/settings/catalog, hours /app/profile, payments /app/settings/business?tab=payments, share link /app/store.
 *
 * The REAL hook (hooks/use-onboarding.ts) and the real client (lib/api/onboarding-concierge.ts, lib/api.ts) are
 * mounted; only `fetch` and the Next router are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/app/onboarding",
  useSearchParams: () => search,
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

const BIZ = "biz_t4b_onb";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 || status === 201 ? "OK" : "Service Unavailable",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

function serveState(state: { step: string; onboardingComplete: boolean }) {
  const posted: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && pathname.endsWith(`/onboarding-concierge/businesses/${BIZ}/onboarding-state`)) {
      return jsonResponse(200, {
        ...state,
        onboardingStartedAt: "2026-11-20T10:00:00.000Z",
        onboardingCompletedAt: state.onboardingComplete ? "2026-11-20T10:05:00.000Z" : null,
        threePillarMet: false,
        setupStatus: null,
      });
    }
    if (method === "POST" && pathname.endsWith(`/onboarding-concierge/businesses/${BIZ}/onboarding-step`)) {
      posted.push(String(init?.body ?? ""));
      return jsonResponse(201, { ...state });
    }
    return jsonResponse(503, { message: "Service Unavailable" });
  }));
  return { posted };
}

async function mountHook(): Promise<void> {
  const { useOnboarding } = await import("@/app/app/onboarding/hooks/use-onboarding");
  function Probe() {
    const { step, loading } = useOnboarding();
    return <p data-testid="probe">{loading ? "loading" : step}</p>;
  }
  render(<Probe />);
}

const replaced = () => router.replace.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  router.replace.mockReset();
  router.push.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  search = new URLSearchParams();
});

describe("TODAY-4BLOCK BUG-010: ?step on a completed onboarding opens that step's page", () => {
  const CASES: Array<[string, string]> = [
    ["products", "/app/settings/catalog"],
    ["catalog", "/app/settings/catalog"],
    ["hours", "/app/profile"],
    ["storefront", "/app/store"],
    ["share_link", "/app/store"],
    ["payments", "/app/settings/business?tab=payments"],
  ];

  for (const [param, page] of CASES) {
    it(`[T4B-ONB-${param}] RED-BEFORE: ?step=${param} on a completed onboarding opens ${page}, never Today`, async () => {
      search = new URLSearchParams({ step: param });
      serveState({ step: "complete", onboardingComplete: true });
      await mountHook();
      await waitFor(() => expect(replaced()).toContain(page));
      expect(replaced(), "no bounce to Today (the sweep repro)").not.toContain("/app/command-center");
      // The step's page is the only place the hook sends the owner: no detour through /app/onboarding?step=....
      expect(replaced().filter((p) => p.startsWith("/app/onboarding"))).toEqual([]);
    });
  }

  it("[T4B-ONB-C1] CONTROL: a completed onboarding opened with no ?step still goes to Today", async () => {
    serveState({ step: "complete", onboardingComplete: true });
    await mountHook();
    await waitFor(() => expect(replaced()).toContain("/app/command-center"));
  });

  it("[T4B-ONB-C2] CONTROL: an onboarding step name (?step=configure) on a completed onboarding still goes to Today", async () => {
    search = new URLSearchParams({ step: "configure" });
    serveState({ step: "complete", onboardingComplete: true });
    await mountHook();
    await waitFor(() => expect(replaced()).toContain("/app/command-center"));
  });

  it("[T4B-ONB-C3] CONTROL: ?step=products on an onboarding NOT yet complete stays in onboarding (the template step), never a settings page", async () => {
    search = new URLSearchParams({ step: "products" });
    const api = serveState({ step: "intake", onboardingComplete: false });
    await mountHook();
    await waitFor(() => expect(api.posted.length).toBeGreaterThan(0));
    // The hook shows the template step (where products are added during onboarding).
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("template"));
    await new Promise((r) => setTimeout(r, 50));
    expect(replaced()).not.toContain("/app/settings/catalog");
    expect(replaced()).not.toContain("/app/command-center");
  });
});
