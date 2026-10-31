/**
 * R0-06-WEB-ONBOARD-MANUAL — onboarding completes in the browser without AI.
 *
 * Owner ruling D-03 (2026-10-31): a manual minimal profile (business name,
 * currency, timezone) completes onboarding; AI onboarding is optional
 * enrichment. The server half is R0-32: POST
 * /onboarding-concierge/businesses/:id/complete accepts a business whose
 * name, currency and timezone are valid (refusing otherwise with 403
 * ONBOARDING_PROFILE_INCOMPLETE {details: {missingFields}}), with no model
 * call, proven on a real database.
 *
 * Before this packet /app/onboarding rendered only the KEY chat, so with the
 * AI down a new owner had no way to finish. Here every /ai/* request answers
 * 503 "No AI providers available", the real onboarding page is mounted, and
 * the owner finishes through the manual step: the profile goes to PATCH
 * /identity/businesses/:id (the route R0-32 proves sets those fields), the
 * completion to POST .../complete, and a 2xx lands on the command center.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import { GenomeProvider } from "@/contexts/genome-context";
import { TtsProvider } from "@/components/tts";

const nav = vi.hoisted(() => {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
  return { router, searchParams: new URLSearchParams() };
});

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/app/onboarding",
  useSearchParams: () => nav.searchParams,
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

import OnboardingPage from "../onboarding/page";

const BIZ = "biz_k06a_manual";

type Call = { method: string; path: string; body: unknown };

interface Stub {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): Stub => ({ status, body });

const NO_AI = json(503, {
  statusCode: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "No AI providers available",
  error: "Service Unavailable",
});

const FRESH_STATE = json(200, {
  step: "welcome",
  onboardingComplete: false,
  onboardingStartedAt: null,
  onboardingCompletedAt: null,
  threePillarMet: false,
  setupStatus: null,
});

const BUSINESS = json(200, {
  id: BIZ,
  name: "k06a Bakery",
  currency: "TTD",
  timezone: "America/Port_of_Spain",
});

const COMPLETE_OK = json(201, {
  complete: true,
  demoData: { contactId: "c_demo", invoiceId: "i_demo", invoiceNumber: "DEMO-001" },
  genomeRecommendation: { threePillarMinimumMet: false, genomeIntegrity: 13, missingPillars: ["founder", "business", "market"] },
});

let calls: Call[] = [];
let routes: Record<string, Stub | (() => Stub)> = {};
/** A route listed here answers only once its promise settles. */
let holds: Partial<Record<string, Promise<void>>> = {};
let fetchSpy: MockInstance<typeof fetch>;

function key(method: string, path: string) {
  return `${method} ${path}`;
}

function installFetch() {
  fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method, path, body });
    const hold = holds[key(method, path)];
    if (hold) await hold;
    let stub: Stub | (() => Stub) | undefined = routes[key(method, path)];
    if (!stub && path.startsWith("/ai/")) stub = NO_AI;
    if (!stub) stub = json(404, { statusCode: 404, code: "NOT_FOUND", message: `not stubbed: ${method} ${path}` });
    const resolved = typeof stub === "function" ? stub() : stub;
    return new Response(JSON.stringify(resolved.body), {
      status: resolved.status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

const statePath = `/onboarding-concierge/businesses/${BIZ}/onboarding-state`;
const businessPath = `/identity/businesses/${BIZ}`;
const completePath = `/onboarding-concierge/businesses/${BIZ}/complete`;

function renderPage() {
  // The providers the app layout wraps every /app route in.
  return render(
    <TtsProvider>
      <GenomeProvider>
        <OnboardingPage />
      </GenomeProvider>
    </TtsProvider>,
  );
}

/** The manual step: its heading, then the region it labels. */
async function manualStep() {
  const heading = await screen.findByRole("heading", { name: /set up manually/i }, { timeout: 3000 });
  const region = heading.closest("section") ?? heading.parentElement!;
  return within(region as HTMLElement);
}

async function fillProfile(step: ReturnType<typeof within>, profile: { name: string; currency: string; timezone: string }) {
  fireEvent.change(step.getByLabelText(/business name/i), { target: { value: profile.name } });
  fireEvent.change(step.getByLabelText(/currency/i), { target: { value: profile.currency } });
  fireEvent.change(step.getByLabelText(/timezone/i), { target: { value: profile.timezone } });
}

const callsTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

describe("onboarding: the manual path completes without AI (D-03)", () => {
  beforeEach(() => {
    calls = [];
    holds = {};
    routes = {
      [key("GET", statePath)]: FRESH_STATE,
      [key("GET", businessPath)]: BUSINESS,
      [key("PATCH", businessPath)]: json(200, { id: BIZ }),
      [key("POST", completePath)]: COMPLETE_OK,
    };
    nav.router.replace.mockReset();
    nav.router.push.mockReset();
    window.localStorage.setItem("kf_token", "k06a-token");
    window.localStorage.setItem("kf_business_id", BIZ);
    installFetch();
  });

  afterEach(() => {
    cleanup();
    fetchSpy.mockRestore();
    window.localStorage.clear();
  });

  it("with every /ai/* request failing, the page offers a 'Set up manually' step", async () => {
    renderPage();
    const step = await manualStep();
    expect(step.getByLabelText(/business name/i)).toBeInTheDocument();
    expect(step.getByLabelText(/currency/i)).toBeInTheDocument();
    expect(step.getByLabelText(/timezone/i)).toBeInTheDocument();
    expect(step.getByRole("button", { name: /finish setup/i })).toBeInTheDocument();
  });

  it("the chat failing is not fatal: the manual step stays usable after the AI answers 503", async () => {
    renderPage();
    const step = await manualStep();
    // The chat's own requests (session restore) hit /ai/* and fail.
    await waitFor(() => expect(calls.some((c) => c.path.startsWith("/ai/"))).toBe(true), { timeout: 3000 });
    expect(step.getByRole("button", { name: /finish setup/i })).toBeEnabled();
    expect(nav.router.replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/app\/(?!onboarding)/));
  });

  it("Finish saves the minimal profile, POSTs /complete once, and lands on the command center", async () => {
    renderPage();
    const step = await manualStep();
    await fillProfile(step, { name: "  k06a Bread House ", currency: "usd", timezone: "America/New_York" });
    const aiBefore = calls.filter((c) => c.path.startsWith("/ai/")).length;

    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(callsTo("PATCH", businessPath)).toEqual([
      { method: "PATCH", path: businessPath, body: { name: "k06a Bread House", currency: "USD", timezone: "America/New_York" } },
    ]);
    expect(callsTo("POST", completePath)).toHaveLength(1);
    // The profile is saved before completion is asked for.
    const patchAt = calls.findIndex((c) => c.method === "PATCH" && c.path === businessPath);
    const completeAt = calls.findIndex((c) => c.method === "POST" && c.path === completePath);
    expect(patchAt).toBeGreaterThanOrEqual(0);
    expect(completeAt).toBeGreaterThan(patchAt);
    // Finishing needs no model call.
    expect(calls.filter((c) => c.path.startsWith("/ai/")).length).toBe(aiBefore);
  });

  it("the profile fields are prefilled from the business record", async () => {
    renderPage();
    const step = await manualStep();
    await waitFor(() => expect((step.getByLabelText(/business name/i) as HTMLInputElement).value).toBe("k06a Bakery"));
    expect((step.getByLabelText(/currency/i) as HTMLInputElement).value).toBe("TTD");
    expect((step.getByLabelText(/timezone/i) as HTMLInputElement).value).toBe("America/Port_of_Spain");
  });

  it("a double click posts /complete once", async () => {
    let release: () => void = () => {};
    holds[key("POST", completePath)] = new Promise<void>((r) => (release = r));
    renderPage();
    const step = await manualStep();
    await fillProfile(step, { name: "k06a Bakery", currency: "TTD", timezone: "America/Port_of_Spain" });
    const finish = step.getByRole("button", { name: /finish setup/i });
    fireEvent.click(finish);
    fireEvent.click(finish);
    await waitFor(() => expect(callsTo("POST", completePath)).toHaveLength(1));
    fireEvent.click(finish);
    release();
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(callsTo("POST", completePath)).toHaveLength(1);
    expect(callsTo("PATCH", businessPath)).toHaveLength(1);
  });

  it("an invalid profile is refused in the browser before any request", async () => {
    renderPage();
    const step = await manualStep();
    await fillProfile(step, { name: "   ", currency: "dollars", timezone: "Mars/Olympus_Mons" });
    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
    const alert = await step.findByRole("alert");
    expect(alert).toHaveTextContent(/business name/i);
    expect(alert).toHaveTextContent(/currency/i);
    expect(alert).toHaveTextContent(/timezone/i);
    expect(callsTo("PATCH", businessPath)).toHaveLength(0);
    expect(callsTo("POST", completePath)).toHaveLength(0);
    expect(nav.router.replace).not.toHaveBeenCalledWith("/app/command-center");
  });

  it("403 ONBOARDING_PROFILE_INCOMPLETE renders the missing fields and stays on onboarding", async () => {
    routes[key("POST", completePath)] = json(403, {
      statusCode: 403,
      code: "ONBOARDING_PROFILE_INCOMPLETE",
      message: "Add your business name, currency and timezone before finishing onboarding.",
      details: { missingFields: ["currency", "timezone"] },
    });
    renderPage();
    const step = await manualStep();
    await fillProfile(step, { name: "k06a Bakery", currency: "TTD", timezone: "America/Port_of_Spain" });
    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
    const alert = await step.findByRole("alert");
    expect(alert).toHaveTextContent(/currency/i);
    expect(alert).toHaveTextContent(/timezone/i);
    expect(alert).not.toHaveTextContent(/business name/i);
    expect(nav.router.replace).not.toHaveBeenCalledWith("/app/command-center");
    expect(step.getByRole("button", { name: /finish setup/i })).toBeEnabled();
  });

  it("403 GENOME_GATE_BLOCKED renders the missing pillars with a link to the profile genome editor", async () => {
    routes[key("POST", completePath)] = json(403, {
      statusCode: 403,
      code: "GENOME_GATE_BLOCKED",
      message: "Three-Pillar Minimum not met. Complete Founder, Business, and Market DNA before finishing onboarding.",
      details: { genomeIntegrity: 13, missingPillars: ["founder", "market"] },
    });
    renderPage();
    const step = await manualStep();
    await fillProfile(step, { name: "k06a Bakery", currency: "TTD", timezone: "America/Port_of_Spain" });
    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
    const alert = await step.findByRole("alert");
    expect(alert).toHaveTextContent(/founder/i);
    expect(alert).toHaveTextContent(/market/i);
    expect(within(alert).getByRole("link")).toHaveAttribute("href", "/app/profile?tab=business-genome");
    expect(nav.router.replace).not.toHaveBeenCalledWith("/app/command-center");
  });

  it("a failed profile save shows the error and does not ask for completion", async () => {
    routes[key("PATCH", businessPath)] = json(403, { statusCode: 403, code: "FORBIDDEN", message: "You cannot edit this business." });
    renderPage();
    const step = await manualStep();
    await fillProfile(step, { name: "k06a Bakery", currency: "TTD", timezone: "America/Port_of_Spain" });
    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
    const alert = await step.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot edit this business/i);
    expect(callsTo("POST", completePath)).toHaveLength(0);
    expect(nav.router.replace).not.toHaveBeenCalledWith("/app/command-center");
  });

  it("an already-complete business also lands on the command center", async () => {
    routes[key("POST", completePath)] = json(201, { complete: true, alreadyComplete: true });
    renderPage();
    const step = await manualStep();
    await fillProfile(step, { name: "k06a Bakery", currency: "TTD", timezone: "America/Port_of_Spain" });
    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/app/command-center"));
  });

  it("when the onboarding state cannot be loaded, the manual step is still offered", async () => {
    routes[key("GET", statePath)] = json(500, { statusCode: 500, code: "INTERNAL_SERVER_ERROR", message: "Internal server error" });
    renderPage();
    const step = await manualStep();
    expect(step.getByRole("button", { name: /finish setup/i })).toBeInTheDocument();
    expect(screen.getByText(/internal server error/i)).toBeInTheDocument();
  });
});
