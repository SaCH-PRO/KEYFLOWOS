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
 *
 * Review repairs:
 * - SEC-R006-1: nothing may be written before the server accepts who is
 *   acting. Since R0-SEC-03 and R0-09 (owner ruling D-11), POST .../complete
 *   and PATCH /identity/businesses/:id both admit only the owner (or a
 *   SUPER_ADMIN on the platform bypass); a granted settings scope admits no
 *   ADMIN or STAFF member. The stubs answer every other member the way the real
 *   server does (POST .../complete 403 ONBOARDING_COMPLETE_FORBIDDEN, "Only the
 *   business owner can finish onboarding."), and the page changes nothing.
 *   R0-SEC-04 (SEC03-3, CR-SEC03-1) retired the "settings write may finish"
 *   copy and cases.
 * - SEC-R006-2: the form writes only to the business it was loaded for.
 * - CR-R006-1: "no model call" is asserted by method, not by timing. The KEY
 *   chat beside the step reads its session with a GET that fetchWithRetry
 *   retries on 503 on its own schedule; and each test signs in with its own
 *   token, so a retry left over from an earlier test is answered but never
 *   recorded against a later one.
 * - CR-R006-2: a step change remounts the shell's per-step container; the
 *   owner's input and any refusal survive it.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type MockInstance } from "vitest";
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
const OWNER = "usr_k06a_owner";
const STAFF = "usr_k06a_staff";
/** An ADMIN member whose scopes grant settings:write: the server still refuses them (D-11). */
const ADMIN = "usr_k06a_admin";
/**
 * A second owner: an OWNER membership, not Business.ownerId. The server admits
 * them (BusinessGuard's two owner arms), but the browser, which knows only
 * ownerId, cannot tell them from any other member, so completion is asked first.
 */
const CO_OWNER = "usr_k06a_coowner";

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
  ownerId: OWNER,
  name: "k06a Bakery",
  currency: "TTD",
  timezone: "America/Port_of_Spain",
});

const SIGNED_IN_AS = (id: string, role = "USER") => json(200, { id, email: `${id}@k06a.test`, role });

const COMPLETE_OK = json(201, {
  complete: true,
  demoData: { contactId: "c_demo", invoiceId: "i_demo", invoiceNumber: "DEMO-001" },
  genomeRecommendation: { threePillarMinimumMet: false, genomeIntegrity: 13, missingPillars: ["founder", "business", "market"] },
});

/** The real server's message for every non-owner member (R0-SEC-03, owner ruling D-11). */
const OWNER_ONLY_MESSAGE = "Only the business owner can finish onboarding.";

/** What the real server answers any member who is not the owner, whatever their scopes (R0-SEC-03). */
const COMPLETE_FORBIDDEN = json(403, {
  statusCode: 403,
  code: "ONBOARDING_COMPLETE_FORBIDDEN",
  message: OWNER_ONLY_MESSAGE,
});

const PROFILE_INCOMPLETE = json(403, {
  statusCode: 403,
  code: "ONBOARDING_PROFILE_INCOMPLETE",
  message: "Add your business name, currency and timezone before finishing onboarding.",
  details: { missingFields: ["currency", "timezone"] },
});

let calls: Call[] = [];
let routes: Record<string, Stub | (() => Stub)> = {};
/** A route listed here answers only once its promise settles. */
let holds: Partial<Record<string, Promise<void>>> = {};
let fetchSpy: MockInstance<typeof fetch>;
/** This test's session token; requests carrying any other are not recorded. */
let token = "";
let testSeq = 0;

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
    // A request built under an earlier test's session (a chat read still in
    // fetchWithRetry's backoff when that test ended) is answered, not recorded.
    if (new Headers(init?.headers).get("Authorization") === `Bearer ${token}`) {
      calls.push({ method, path, body });
    }
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
const stepPath = `/onboarding-concierge/businesses/${BIZ}/onboarding-step`;
const businessPath = `/identity/businesses/${BIZ}`;
const completePath = `/onboarding-concierge/businesses/${BIZ}/complete`;
const sessionsPath = `/ai/businesses/${BIZ}/flow/sessions`;
const mePath = "/identity/me";

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

const valueOf = (step: ReturnType<typeof within>, label: RegExp) => (step.getByLabelText(label) as HTMLInputElement).value;

async function prefilled(step: ReturnType<typeof within>) {
  await waitFor(() => expect(valueOf(step, /business name/i)).toBe("k06a Bakery"));
}

const callsTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

/** Every write the page made outside the KEY chat, in order. */
const writes = () => calls.filter((c) => c.method !== "GET" && !c.path.startsWith("/ai/")).map((c) => key(c.method, c.path));

describe("onboarding: the manual path completes without AI (D-03)", () => {
  beforeAll(() => {
    installFetch();
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  beforeEach(() => {
    calls = [];
    holds = {};
    routes = {
      [key("GET", statePath)]: FRESH_STATE,
      [key("GET", businessPath)]: BUSINESS,
      [key("GET", mePath)]: SIGNED_IN_AS(OWNER),
      [key("PATCH", businessPath)]: json(200, { id: BIZ }),
      [key("POST", completePath)]: COMPLETE_OK,
    };
    nav.router.replace.mockReset();
    nav.router.push.mockReset();
    token = `k06a-token-${++testSeq}`;
    window.localStorage.setItem("kf_token", token);
    window.localStorage.setItem("kf_business_id", BIZ);
  });

  afterEach(() => {
    cleanup();
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

    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(callsTo("PATCH", businessPath)).toEqual([
      { method: "PATCH", path: businessPath, body: { name: "k06a Bread House", currency: "USD", timezone: "America/New_York" } },
    ]);
    expect(callsTo("POST", completePath)).toHaveLength(1);
    // The owner's profile is saved before completion is asked for.
    const patchAt = calls.findIndex((c) => c.method === "PATCH" && c.path === businessPath);
    const completeAt = calls.findIndex((c) => c.method === "POST" && c.path === completePath);
    expect(patchAt).toBeGreaterThanOrEqual(0);
    expect(completeAt).toBeGreaterThan(patchAt);
    // Finishing needs no model call: nothing was sent to /ai/* but the KEY
    // chat's background reads (GETs fetchWithRetry repeats on 503 on its own
    // schedule), and the only writes are the profile save and the completion.
    expect(calls.filter((c) => c.path.startsWith("/ai/") && c.method !== "GET")).toEqual([]);
    expect(calls.filter((c) => c.method !== "GET").map((c) => key(c.method, c.path))).toEqual([
      key("PATCH", businessPath),
      key("POST", completePath),
    ]);
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
    routes[key("POST", completePath)] = PROFILE_INCOMPLETE;
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
    // A refusal the real PATCH route sends: UpdateBusinessDto's MaxLength(200)
    // on name, through the global ValidationPipe. (Since R0-09 it also refuses
    // a non-owner on authority; the page sends a non-owner's PATCH only after
    // the server accepted the actor: see the SEC-R006-1 cases below.)
    routes[key("PATCH", businessPath)] = json(400, {
      statusCode: 400,
      message: ["name must be shorter than or equal to 200 characters"],
      error: "Bad Request",
    });
    renderPage();
    const step = await manualStep();
    await fillProfile(step, { name: "k06a Bakery", currency: "TTD", timezone: "America/Port_of_Spain" });
    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
    const alert = await step.findByRole("alert");
    expect(alert).toHaveTextContent(/name must be shorter than or equal to 200 characters/i);
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

  describe("SEC-R006-1: nothing is written before the server accepts who is acting", () => {
    it("a STAFF member is refused before any write: no PATCH, and the form gives way to 'ask the owner'", async () => {
      // How the real server answers a STAFF member with role-default scopes:
      // POST .../complete refuses (and so, since R0-09, would the PATCH).
      routes[key("GET", mePath)] = SIGNED_IN_AS(STAFF);
      routes[key("POST", completePath)] = COMPLETE_FORBIDDEN;
      renderPage();
      const step = await manualStep();
      await prefilled(step);
      await fillProfile(step, { name: "Renamed by staff", currency: "USD", timezone: "Asia/Tokyo" });
      fireEvent.click(step.getByRole("button", { name: /finish setup/i }));

      const alert = await step.findByRole("alert");
      expect(alert).toHaveTextContent(OWNER_ONLY_MESSAGE);
      expect(alert).not.toHaveTextContent(/settings write/i);
      expect(alert).toHaveTextContent(/ask the business owner/i);
      expect(callsTo("PATCH", businessPath)).toHaveLength(0);
      expect(writes()).toEqual([key("POST", completePath)]);
      expect(step.queryByRole("button", { name: /finish setup/i })).not.toBeInTheDocument();
      expect(step.queryByLabelText(/business name/i)).not.toBeInTheDocument();
      expect(nav.router.replace).not.toHaveBeenCalledWith("/app/command-center");
    });

    it("when who is signed in cannot be read, completion is still asked for before any write", async () => {
      routes[key("GET", mePath)] = json(500, { statusCode: 500, message: "Internal server error" });
      routes[key("POST", completePath)] = COMPLETE_FORBIDDEN;
      renderPage();
      const step = await manualStep();
      await prefilled(step);
      await fillProfile(step, { name: "Renamed", currency: "USD", timezone: "Asia/Tokyo" });
      fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
      expect(await step.findByRole("alert")).toHaveTextContent(/ask the business owner/i);
      expect(writes()).toEqual([key("POST", completePath)]);
    });

    /** A member the server refuses: the ask-the-owner notice, and nothing changed. */
    async function expectAskTheOwner(step: ReturnType<typeof within>) {
      const alert = await step.findByRole("alert");
      expect(alert).toHaveTextContent(OWNER_ONLY_MESSAGE);
      expect(alert).not.toHaveTextContent(/settings write/i);
      expect(alert).toHaveTextContent(/ask the business owner/i);
      expect(alert).toHaveTextContent(/nothing was changed/i);
      expect(callsTo("PATCH", businessPath)).toHaveLength(0);
      expect(writes()).toEqual([key("POST", completePath)]);
      expect(step.queryByRole("button", { name: /finish setup/i })).not.toBeInTheDocument();
      expect(nav.router.replace).not.toHaveBeenCalledWith("/app/command-center");
    }

    it("R0-SEC-04: an ADMIN granted settings write is refused (403 ONBOARDING_COMPLETE_FORBIDDEN): the ask-the-owner notice, and the changed profile is not saved", async () => {
      routes[key("GET", mePath)] = SIGNED_IN_AS(ADMIN);
      routes[key("POST", completePath)] = COMPLETE_FORBIDDEN;
      renderPage();
      const step = await manualStep();
      await prefilled(step);
      await fillProfile(step, { name: "k06a Bread House", currency: "usd", timezone: "America/New_York" });
      fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
      await expectAskTheOwner(step);
    });

    it("R0-SEC-04: an ADMIN granted settings write, with the stored profile unchanged, is refused: the ask-the-owner notice, and nothing changes", async () => {
      routes[key("GET", mePath)] = SIGNED_IN_AS(ADMIN);
      routes[key("POST", completePath)] = COMPLETE_FORBIDDEN;
      renderPage();
      const step = await manualStep();
      await prefilled(step);
      fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
      await expectAskTheOwner(step);
    });

    it("R0-SEC-04: a refusal without a server message falls back to the owner-only copy", async () => {
      routes[key("GET", mePath)] = SIGNED_IN_AS(ADMIN);
      routes[key("POST", completePath)] = json(403, { statusCode: 403, code: "ONBOARDING_COMPLETE_FORBIDDEN" });
      renderPage();
      const step = await manualStep();
      await prefilled(step);
      fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
      await expectAskTheOwner(step);
    });

    it("an owner the browser cannot recognise (an OWNER membership, not Business.ownerId), whom the server admits: completion first, then the changed profile is saved", async () => {
      routes[key("GET", mePath)] = SIGNED_IN_AS(CO_OWNER);
      renderPage();
      const step = await manualStep();
      await prefilled(step);
      await fillProfile(step, { name: "k06a Bread House", currency: "usd", timezone: "America/New_York" });
      fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/app/command-center"));
      expect(writes()).toEqual([key("POST", completePath), key("PATCH", businessPath)]);
      expect(callsTo("PATCH", businessPath)[0].body).toEqual({ name: "k06a Bread House", currency: "USD", timezone: "America/New_York" });
    });

    it("that owner, with the stored profile unchanged: completion only, no PATCH", async () => {
      routes[key("GET", mePath)] = SIGNED_IN_AS(CO_OWNER);
      renderPage();
      const step = await manualStep();
      await prefilled(step);
      fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/app/command-center"));
      expect(writes()).toEqual([key("POST", completePath)]);
    });

    it("ONBOARDING_PROFILE_INCOMPLETE proves that owner may finish: the profile is saved, then completion asked again", async () => {
      routes[key("GET", mePath)] = SIGNED_IN_AS(CO_OWNER);
      let asked = 0;
      routes[key("POST", completePath)] = () => (++asked === 1 ? PROFILE_INCOMPLETE : COMPLETE_OK);
      renderPage();
      const step = await manualStep();
      await prefilled(step);
      await fillProfile(step, { name: "k06a Bakery", currency: "TTD", timezone: "America/Port_of_Spain" });
      fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/app/command-center"));
      expect(writes()).toEqual([key("POST", completePath), key("PATCH", businessPath), key("POST", completePath)]);
    });

    it("a SUPER_ADMIN, whom the server admits, saves first like the owner", async () => {
      routes[key("GET", mePath)] = SIGNED_IN_AS("usr_k06a_root", "SUPER_ADMIN");
      renderPage();
      const step = await manualStep();
      await prefilled(step);
      await fillProfile(step, { name: "k06a Bread House", currency: "TTD", timezone: "America/Port_of_Spain" });
      fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/app/command-center"));
      expect(writes()).toEqual([key("PATCH", businessPath), key("POST", completePath)]);
    });
  });

  it("SEC-R006-2: a business switched in another tab is refused, and nothing is written to either business", async () => {
    const other = "biz_k06a_other";
    routes[key("GET", `/identity/businesses/${other}`)] = json(200, {
      id: other, ownerId: OWNER, name: "Other Co", currency: "JMD", timezone: "America/Jamaica",
    });
    renderPage();
    const step = await manualStep();
    await prefilled(step);
    // Another tab signs in to, or creates, a different business.
    window.localStorage.setItem("kf_business_id", other);
    fireEvent.change(step.getByLabelText(/timezone/i), { target: { value: "America/Port_of_Spain " } });
    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));

    expect(await step.findByRole("alert")).toHaveTextContent(/another tab switched/i);
    expect(writes()).toEqual([]);
    expect(nav.router.replace).not.toHaveBeenCalledWith("/app/command-center");
  });

  it("CR-R006-2: a step change keeps what the owner typed and the refusal shown", async () => {
    // The chat restores at once (no session yet), so its welcome card shows.
    routes[key("GET", sessionsPath)] = json(200, []);
    routes[key("POST", stepPath)] = json(201, { ...(FRESH_STATE.body as object), step: "intake" });
    renderPage();
    const step = await manualStep();
    await prefilled(step);
    const before = step.getByLabelText(/business name/i);
    await fillProfile(step, { name: "Owner Typed Name", currency: "USD", timezone: "Mars/Olympus_Mons" });
    fireEvent.click(step.getByRole("button", { name: /finish setup/i }));
    expect(await step.findByRole("alert")).toHaveTextContent(/timezone/i);

    fireEvent.click(await screen.findByRole("button", { name: /start talking to key/i }, { timeout: 3000 }));
    await waitFor(() => expect(callsTo("POST", stepPath)).toHaveLength(1));

    const after = await manualStep();
    // The shell's per-step container was remounted...
    await waitFor(() => expect(after.getByLabelText(/business name/i)).not.toBe(before));
    // ...and the owner's input and the refusal are still there.
    expect(valueOf(after, /business name/i)).toBe("Owner Typed Name");
    expect(valueOf(after, /currency/i)).toBe("USD");
    expect(valueOf(after, /timezone/i)).toBe("Mars/Olympus_Mons");
    expect(after.getByRole("alert")).toHaveTextContent(/timezone/i);
    expect(writes()).toEqual([key("POST", stepPath)]);
  });
});
