/**
 * R0-23-WEB-R0-SCREENS — the Release 0 journey, rendered in jsdom against
 * server-shaped fixtures.
 *
 * apps/server/test/release0-journey.integration.test.ts drives issue #186's
 * seven steps through the REAL built server and database. No web test rendered
 * any of those screens (M58), so the browser half of every step was unproven
 * and a UI that drifted from the server's contract would only be caught by the
 * live Playwright run (R0-25). Here each Release 0 screen is mounted for real
 * (its own hooks, the real lib/client.ts and lib/api.ts, the real workspace
 * selection) with only `fetch` answered at the network edge, from
 * src/test-fixtures/release0/journey-responses.json:
 *
 *   step 1  the login form (POST /identity/login, then POST /identity/bootstrap)
 *   step 2  Contacts quick-add (POST .../contacts, then the list is re-read)
 *   step 3  invoices/new (POST .../invoices) and invoices/[id] (a DRAFT, read
 *           from the tenant route GET /commerce/businesses/:b/invoices/:id)
 *   step 4  Record Payment on invoices/[id] (one POST on a double click; a
 *           failed submit retried sends the same idempotency key, R0-21)
 *   step 5  simulated refresh: unmount, re-render, read again from the server;
 *           after a recorded payment the re-read shows that payment
 *   step 6  a 403 shows an error, never demo data
 *   step 7  optional services fail visibly: a KEY chat turn on onboarding
 *           answered with the R0-07 AI 503 shows the failure in the chat and
 *           leaves the manual path (R0-06) usable; a Gmail 503 on the
 *           invoice's email door is shown, and the status stays
 *
 * SERVER-SHAPED FIXTURES. Every `journey.*` body carries exactly the keys the
 * real-server journey asserts on that route (or on the same row elsewhere in
 * the journey), and the first describe below holds that list, checked in with
 * the line each key comes from, and asserts the fixture equals it. A screen
 * that needs a key the journey does not prove therefore fails here, in jsdom,
 * instead of in the browser. The one route the journey does not read, the
 * tenant invoice detail route, is held to the keys its own real-server suite
 * (commerce-invoice-detail.integration.test.ts) asserts, since the server
 * always adds paidAmount, remaining and the payment rows there. This file does
 * not import server code.
 *
 * SUBSTITUTIONS (recorded, not hidden):
 * - Sign-in: the login form calls POST /identity/login, which proxies Supabase
 *   password sign-in (owner ruling D-02, hosted Supabase). The journey never
 *   signs in by password (it mints Supabase-shaped HS256 tokens), so that one
 *   response is `screenOnly.login`, shaped from IdentityController.login.
 * - App-shell context: invoices/[id] calls useCompose(), whose provider mounts
 *   the email composer; it is stubbed (as invoices-panel-submit.test.tsx does).
 *   Everything else, sonner's Toaster included, is the real thing.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type MockInstance } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, fireEvent, cleanup, within, act } from "@testing-library/react";
import { Toaster } from "sonner";
import F from "../../../test-fixtures/release0/journey-responses.json";

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  pathname: "/app",
  params: {} as Record<string, string>,
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.searchParams,
  useParams: () => nav.params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: () => {} }) }));

import LoginForm from "../../auth/login/login-form";
import ContactsPage from "../crm/contacts/page";
import NewInvoicePage from "../commerce/invoices/new/page";
import InvoiceDetailPage from "../commerce/invoices/[id]/page";
import OnboardingPage from "../onboarding/page";
import { NavigationContextProvider } from "@/lib/navigation-context";
import { AiContextProvider } from "@/contexts/ai-context";
import { NotesProvider } from "@/components/keyflow/notes-context";
import { GuideProvider } from "@/contexts/guide-context";
import { TtsProvider } from "@/components/tts";
import { KeyChatProvider } from "@/components/key/chat";
import { GenomeProvider } from "@/contexts/genome-context";

// ---------------------------------------------------------------------------
// The key list: what release0-journey.integration.test.ts asserts, per response
// ---------------------------------------------------------------------------

/**
 * The invoice row as the journey proves it. Step 3 asserts on the create
 * response id, invoiceNumber (L521-524), status, total, subtotal, currency,
 * contactId (L523) and items (L525), and on the items of that same row
 * description, quantity, unitPrice and total (L529-531).
 */
const INVOICE_ROW = [
  "contactId", "currency", "id", "invoiceNumber", "items", "items[]",
  "items[].description", "items[].quantity", "items[].total", "items[].unitPrice",
  "status", "subtotal", "total",
];

/**
 * DRIFT RECORDED (R0-23): lib/client.ts contactListResponseSchema also requires
 * `nextCursor` and `hasMore`, which the journey does not assert. CrmService
 * returns both, so the browser is fine today, but nothing on the server side
 * proves them: against this list the screen logs "schema validation failed:
 * nextCursor: Required, hasMore: Required" and renders the rows from the raw
 * body (apiGet's fallback). Asserting both in the journey closes it. That log
 * is the only schema failure afterEach lets through (isRecordedContactsDrift),
 * and the step-2 case asserts it is still logged, so closing the drift (or a
 * new one) shows up here instead of in a silenced console.
 */
const CONTACT_LIST = ["contacts", "contacts[]", "contacts[].id", "contacts[].lastName", "contacts[].status"];

/**
 * The tenant detail read (GET /commerce/businesses/:b/invoices/:id). The
 * journey never reads this route; invoices/[id] does (R0-QI-01). The server
 * always adds the payment rows and the payments-derived figures to it
 * (getInvoiceForBusiness, apps/server/src/modules/commerce/commerce.service.ts
 * L669-683), and invoices/[id] shows those figures in preference to anything
 * else (page.tsx, R0-21). A read without them is a shape the server never
 * sends: the screen falls back to summing rows and a PAID invoice shows 0 paid.
 * So the body is the journey's row plus exactly what
 * apps/server/test/commerce-invoice-detail.integration.test.ts asserts on this
 * route: payments, paidAmount and remaining on every read (L225-227), and each
 * payment row's id, amount and status (L523-543). An unpaid read has no rows,
 * so it has no row keys.
 */
const DETAIL_READ = [...INVOICE_ROW, "paidAmount", "payments", "payments[]", "remaining"];
const DETAIL_READ_WITH_PAYMENTS = [...DETAIL_READ, "payments[].amount", "payments[].id", "payments[].status"];

const JOURNEY_ASSERTED_SHAPES: Record<string, { route: string; status: number; keys: string[] }> = {
  // Step 1, L403-408 and L436-440: user.id, business.id, business.name, isNewBusiness.
  bootstrap: { route: "POST /identity/bootstrap", status: 201, keys: ["business", "business.id", "business.name", "isNewBusiness", "user", "user.id"] },
  // Step 1, L422-424 (and L455-456): the list's ids.
  myBusinesses: { route: "GET /identity/businesses", status: 200, keys: ["[]", "[].id"] },
  // Step 1, L430-432.
  me: { route: "GET /identity/me", status: 200, keys: ["email", "id"] },
  // Step 1, L425-429: id, and no secret keys.
  business: { route: "GET /identity/businesses/:businessId", status: 200, keys: ["id"] },
  // Step 2, L472-474.
  contactCreated: { route: "POST /crm/businesses/:businessId/contacts", status: 201, keys: ["id"] },
  // Step 5, L700-704: contacts[] by id, lastName, status.
  contactsBefore: { route: "GET /crm/businesses/:businessId/contacts", status: 200, keys: CONTACT_LIST },
  contactsAfter: { route: "GET /crm/businesses/:businessId/contacts", status: 200, keys: CONTACT_LIST },
  // Step 3, L520-531.
  invoiceCreated: { route: "POST /commerce/businesses/:businessId/invoices", status: 201, keys: INVOICE_ROW },
  // The same row read back. The journey reloads it through the list route
  // (L550-555, L709-710); invoices/[id] reads the tenant detail route (R0-QI-01),
  // which serves that row with its figures (DETAIL_READ). DRAFT (L523), SENT
  // (L544-547), PARTIALLY_PAID after the 100 payment (L619-624), PAID after the
  // settle (L676-679).
  invoiceDraft: { route: "GET /commerce/businesses/:businessId/invoices/:invoiceId", status: 200, keys: DETAIL_READ },
  invoiceSent: { route: "GET /commerce/businesses/:businessId/invoices/:invoiceId", status: 200, keys: DETAIL_READ },
  invoicePartiallyPaid: { route: "GET /commerce/businesses/:businessId/invoices/:invoiceId", status: 200, keys: DETAIL_READ_WITH_PAYMENTS },
  invoicePaid: { route: "GET /commerce/businesses/:businessId/invoices/:invoiceId", status: 200, keys: DETAIL_READ_WITH_PAYMENTS },
  // Step 4: payment.id (L603, L656, L674), remaining and invoice.status
  // (L675-676); the invoice is the step-3 row with its payments by id (L713);
  // paidAmount is the figure the journey asserts for this state (L625, L658).
  paymentRecorded: {
    route: "POST /commerce/businesses/:businessId/invoices/:invoiceId/payments",
    status: 201,
    keys: [
      "invoice", ...INVOICE_ROW.map((k) => `invoice.${k}`), "invoice.payments", "invoice.payments[]", "invoice.payments[].id",
      "paidAmount", "payment", "payment.id", "remaining",
    ],
  },
};

/** Every key path of a JSON value: `a`, `a.b`, `list[]`, `list[].id`, `[]` for a top-level array. */
function shapeOf(value: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) {
      const here = `${at}[]`;
      out.add(here);
      for (const el of v) walk(el, here);
    } else if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        const here = at ? `${at}.${k}` : k;
        out.add(here);
        walk(child, here);
      }
    }
  };
  walk(value, "");
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// The network edge
// ---------------------------------------------------------------------------

type FixtureResponse = { route: string; status: number; body: unknown };
type Call = { method: string; path: string; body: unknown; auth: string | null };
type Answer = { status: number; body: unknown };
type Route = Answer | ((call: Call) => Answer);

const J = F.journey as unknown as Record<string, FixtureResponse>;
const S = F.screenOnly as unknown as Record<string, FixtureResponse>;
const answer = (r: FixtureResponse): Answer => ({ status: r.status, body: r.body });

const BIZ = (J.bootstrap.body as { business: { id: string } }).business.id;
const INVOICE = (J.invoiceCreated.body as { id: string; invoiceNumber: string });
const P = {
  identityLogin: "/identity/login",
  bootstrap: "/identity/bootstrap",
  myBusinesses: "/identity/businesses",
  me: "/identity/me",
  business: `/identity/businesses/${BIZ}`,
  contacts: `/crm/businesses/${BIZ}/contacts`,
  products: `/commerce/businesses/${BIZ}/products`,
  invoices: `/commerce/businesses/${BIZ}/invoices`,
  invoice: `/commerce/businesses/${BIZ}/invoices/${INVOICE.id}`,
  timeline: `/commerce/businesses/${BIZ}/invoices/${INVOICE.id}/timeline`,
  payments: `/commerce/businesses/${BIZ}/invoices/${INVOICE.id}/payments`,
  sendEmail: `/commerce/businesses/${BIZ}/invoices/${INVOICE.id}/send-email`,
  resendReceipt: `/commerce/businesses/${BIZ}/invoices/${INVOICE.id}/resend-receipt`,
  onboardingState: `/onboarding-concierge/businesses/${BIZ}/onboarding-state`,
  /** Every AI route this tenant's screens may call starts here (R0-34b: KEY binds the guarded tenant). */
  ai: `/ai/businesses/${BIZ}/`,
  aiChatStream: `/ai/businesses/${BIZ}/flow/chat/stream`,
  aiChat: `/ai/businesses/${BIZ}/flow/chat`,
};

let calls: Call[] = [];
let routes: Record<string, Route> = {};
/** A route listed here answers only once its promise settles. */
let holds: Record<string, Promise<void>> = {};
let fetchSpy: MockInstance<typeof fetch>;
/** This test's session; a request made under another (an earlier test's late read) is answered, not recorded. */
let token = "";
let seq = 0;

const key = (method: string, path: string) => `${method} ${path}`;

function installFetch() {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    const auth = new Headers(init?.headers).get("Authorization");
    if (!auth || auth === `Bearer ${token}`) calls.push({ method, path, body, auth });
    const hold = holds[key(method, path)];
    if (hold) await hold;
    let route: Route | undefined = routes[key(method, path)];
    // The AI is down for this tenant only: an /ai/* request that names another
    // business (or none) is not stubbed, so a screen that drops the tenant from
    // its AI call gets a 404, not the R0-07 answer the step-7 case looks for.
    if (!route && path.startsWith(P.ai)) route = answer(S.aiNotConfigured);
    if (!route) route = { status: 404, body: { statusCode: 404, message: `not stubbed: ${method} ${path}` } };
    const resolved = typeof route === "function" ? route({ method, path, body, auth }) : route;
    return new Response(JSON.stringify(resolved.body), { status: resolved.status, headers: { "Content-Type": "application/json" } });
  });
}

const callsTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const writes = () => calls.filter((c) => c.method !== "GET").map((c) => key(c.method, c.path));

/** The signed-in owner, the business selected, and the routes every /app screen reads to confirm it. */
function signedIn() {
  token = `r023-token-${++seq}`;
  window.localStorage.setItem("kf_token", token);
  window.localStorage.setItem("kf_business_id", BIZ);
  routes[key("GET", P.myBusinesses)] = answer(J.myBusinesses);
  routes[key("GET", P.me)] = answer(J.me);
}

/**
 * The providers app/app/layout.tsx wraps every /app route in, in its order
 * (RequireAuth and the chrome of AppLayoutInner left out), and the root
 * providers' Toaster, so a toast is on the page as it is in the browser.
 */
function AppProviders({ children }: { children: ReactNode }) {
  return (
    <NavigationContextProvider>
      <AiContextProvider>
        <NotesProvider>
          <GuideProvider>
            <TtsProvider>
              <KeyChatProvider>
                <GenomeProvider>{children}</GenomeProvider>
              </KeyChatProvider>
            </TtsProvider>
          </GuideProvider>
        </NotesProvider>
      </AiContextProvider>
    </NavigationContextProvider>
  );
}

function renderScreen(ui: ReactNode, opts: { app?: boolean } = { app: true }) {
  return render(
    <>
      {opts.app ? <AppProviders>{ui}</AppProviders> : ui}
      <Toaster />
    </>,
  );
}

/** Mounts invoices/[id]; `read` is the detail read, or what the server serves on each read. */
function openInvoice(read: FixtureResponse | (() => FixtureResponse)) {
  nav.pathname = `/app/commerce/invoices/${INVOICE.id}`;
  nav.params = { id: INVOICE.id };
  routes[key("GET", P.invoice)] = typeof read === "function" ? () => answer(read()) : answer(read);
  routes[key("GET", P.timeline)] = answer(S.timeline);
  return renderScreen(<InvoiceDetailPage />);
}

const invoiceHeading = () => screen.findByRole("heading", { name: `Invoice ${INVOICE.invoiceNumber}` }, { timeout: 3000 });

/** The Payment Summary card: its Total, Paid and Remaining rows. */
function paymentSummary() {
  const title = screen.getByText(/^payment summary$/i);
  const card = within(title.parentElement as HTMLElement);
  const valueOf = (label: string) => card.getByText(label).nextElementSibling?.textContent ?? "";
  return { total: valueOf("Total"), paid: valueOf("Paid"), remaining: valueOf("Remaining") };
}

/**
 * Every "[apiGet] <path> schema validation failed" a test logged. console.error
 * is silenced for the screens' noise, so without this a fixture that drifts
 * from a web schema would be swallowed: afterEach fails a test that logs one
 * the drift note on CONTACT_LIST does not record.
 */
function schemaFailures(): Array<{ path: string; issues: string }> {
  return vi.mocked(console.error).mock.calls
    .filter(([first]) => typeof first === "string" && first.includes("schema validation failed"))
    .map(([first, issues]) => ({ path: String(first).replace(/^\[apiGet\] /, "").replace(/ schema validation failed:$/, ""), issues: String(issues) }));
}
/** The one recorded drift (see CONTACT_LIST): the contact list, missing exactly nextCursor and hasMore. */
const isRecordedContactsDrift = (f: { path: string; issues: string }) =>
  f.path.split("?")[0] === P.contacts && f.issues === "nextCursor: Required, hasMore: Required";

beforeAll(() => {
  installFetch();
});

afterAll(() => {
  fetchSpy.mockRestore();
});

beforeEach(() => {
  calls = [];
  routes = {};
  holds = {};
  token = "";
  nav.pathname = "/app";
  nav.params = {};
  nav.searchParams = new URLSearchParams();
  for (const fn of Object.values(nav.router)) fn.mockReset();
  window.localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  // Let reads still in flight settle before the next test's routes go in.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  window.localStorage.clear();
  const unrecorded = schemaFailures().filter((f) => !isRecordedContactsDrift(f));
  vi.mocked(console.warn).mockRestore();
  vi.mocked(console.error).mockRestore();
  expect(unrecorded, "a fixture drifted from a web schema; record it or fix the fixture").toEqual([]);
});

// ---------------------------------------------------------------------------
// The fixture is the server's shape
// ---------------------------------------------------------------------------

describe("fixtures: journey-responses.json is shaped from release0-journey.integration.test.ts", () => {
  it("every journey response carries exactly the keys the real-server journey asserts on it, on the same route and status", () => {
    expect(Object.keys(J).sort()).toEqual(Object.keys(JOURNEY_ASSERTED_SHAPES).sort());
    for (const [name, expected] of Object.entries(JOURNEY_ASSERTED_SHAPES)) {
      expect({ name, route: J[name].route, status: J[name].status }).toEqual({ name, route: expected.route, status: expected.status });
      expect({ name, keys: shapeOf(J[name].body) }).toEqual({ name, keys: [...expected.keys].sort() });
    }
  });

  it("the values the journey asserts hold in the fixture (DRAFT INV-n of 250 with two items; 100 paid leaves 150)", () => {
    const created = J.invoiceCreated.body as { status: string; total: number; subtotal: number; currency: string; invoiceNumber: string; items: unknown[] };
    expect(created).toMatchObject({ status: "DRAFT", total: 250, subtotal: 250, currency: "TTD" });
    expect(created.invoiceNumber).toMatch(/^INV-\d+$/);
    expect(created.items).toHaveLength(2);
    expect((J.invoiceSent.body as { status: string }).status).toBe("SENT");
    expect((J.invoicePaid.body as { status: string }).status).toBe("PAID");
    expect(J.paymentRecorded.body).toMatchObject({ paidAmount: 100, remaining: 150, invoice: { status: "PARTIALLY_PAID", total: 250 } });
    expect((J.invoicePartiallyPaid.body as { status: string }).status).toBe("PARTIALLY_PAID");
    expect(J.bootstrap.body).toMatchObject({ isNewBusiness: true });
    const after = (J.contactsAfter.body as { contacts: Array<{ id: string }> }).contacts.map((c) => c.id);
    expect(after).toContain((J.contactCreated.body as { id: string }).id);
  });

  it("every detail read carries the server's figures for its row: paidAmount = the SUCCESSFUL payments, remaining = total - paidAmount (getInvoiceForBusiness)", () => {
    type Detail = { id: string; status: string; total: number; paidAmount: number; remaining: number; payments: Array<{ id: string; amount: number; status: string }> };
    const reads = ["invoiceDraft", "invoiceSent", "invoicePartiallyPaid", "invoicePaid"].map((name) => ({ name, body: J[name].body as Detail }));
    for (const { name, body } of reads) {
      const paid = body.payments.filter((p) => p.status === "SUCCESSFUL").reduce((s, p) => s + p.amount, 0);
      expect({ name, paidAmount: body.paidAmount, remaining: body.remaining }).toEqual({ name, paidAmount: paid, remaining: Math.max(0, body.total - paid) });
      expect({ name, id: body.id }).toEqual({ name, id: INVOICE.id });
    }
    const [draft, sent, partial, settled] = reads.map((r) => r.body);
    expect([draft, sent].map((b) => [b.paidAmount, b.remaining])).toEqual([[0, 250], [0, 250]]);
    // After step 4 the read shows the payment the POST recorded, and after the settle both.
    const recorded = J.paymentRecorded.body as { payment: { id: string }; paidAmount: number; remaining: number };
    expect(partial.payments.map((p) => p.id)).toEqual([recorded.payment.id]);
    expect([partial.paidAmount, partial.remaining]).toEqual([recorded.paidAmount, recorded.remaining]);
    expect(settled.payments.map((p) => p.id)).toContain(recorded.payment.id);
    expect([settled.paidAmount, settled.remaining]).toEqual([250, 0]);
  });

  it("every response outside the journey says why", () => {
    for (const [name, r] of Object.entries(F.screenOnly as Record<string, { why?: string }>)) {
      expect({ name, why: typeof r.why === "string" && r.why.length > 20 }).toEqual({ name, why: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Step 1
// ---------------------------------------------------------------------------

describe("step 1 — sign in and select the business", () => {
  it("login-form: POST /identity/login then POST /identity/bootstrap store kf_token, kf_refresh_token and kf_business_id and push /app", async () => {
    const login = S.login.body as { accessToken: string; refreshToken: string };
    token = login.accessToken;
    routes[key("POST", P.identityLogin)] = answer(S.login);
    routes[key("POST", P.bootstrap)] = answer(J.bootstrap);
    nav.pathname = "/auth/login";
    renderScreen(<LoginForm />, { app: false });

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "r023_owner@test.local" } });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith("/app"));
    expect(callsTo("POST", P.identityLogin)).toEqual([
      { method: "POST", path: P.identityLogin, body: { email: "r023_owner@test.local", password: "correct horse battery staple" }, auth: null },
    ]);
    // Bootstrap runs as the session the login just opened.
    const bootstrap = callsTo("POST", P.bootstrap);
    expect(bootstrap).toHaveLength(1);
    expect(bootstrap[0].auth).toBe(`Bearer ${login.accessToken}`);
    expect(window.localStorage.getItem("kf_token")).toBe(login.accessToken);
    expect(window.localStorage.getItem("kf_refresh_token")).toBe(login.refreshToken);
    expect(window.localStorage.getItem("kf_business_id")).toBe(BIZ);
    expect(nav.router.push).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Step 2
// ---------------------------------------------------------------------------

describe("step 2 — Contacts quick-add", () => {
  it("quick-add POSTs the contact once and re-reads the list, which then shows it", async () => {
    signedIn();
    nav.pathname = "/app/crm/contacts";
    window.localStorage.setItem("kf_pipeline_view", "list");
    let created = false;
    routes[key("GET", P.contacts)] = () => answer(created ? J.contactsAfter : J.contactsBefore);
    routes[key("POST", P.contacts)] = () => { created = true; return answer(J.contactCreated); };
    renderScreen(<ContactsPage />);

    expect(await screen.findByText(/byron/i, {}, { timeout: 3000 })).toBeInTheDocument();
    const readsBefore = callsTo("GET", P.contacts).length;
    expect(readsBefore).toBeGreaterThan(0);
    expect(screen.queryByText(/hopper/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Add contact" })[0]);
    const dialog = within(await screen.findByRole("dialog", { name: "Add contact" }));
    fireEvent.change(dialog.getByPlaceholderText("Jane"), { target: { value: "Grace" } });
    fireEvent.change(dialog.getByPlaceholderText("Doe"), { target: { value: "Hopper" } });
    fireEvent.click(dialog.getByRole("button", { name: /add contact/i }));

    await waitFor(() => expect(callsTo("POST", P.contacts)).toHaveLength(1));
    expect(callsTo("POST", P.contacts)[0].body).toMatchObject({ firstName: "Grace", lastName: "Hopper", status: "LEAD", source: "manual" });
    await waitFor(() => expect(callsTo("GET", P.contacts).length).toBeGreaterThan(readsBefore));
    expect(await screen.findByText(/hopper/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/byron/i)).toBeInTheDocument();
    expect(writes()).toEqual([key("POST", P.contacts)]);
    // The recorded drift (CONTACT_LIST) is still what the screen logs, and the only schema failure.
    expect(schemaFailures().length).toBeGreaterThan(0);
    expect(schemaFailures().every(isRecordedContactsDrift)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 3
// ---------------------------------------------------------------------------

describe("step 3 — create and open the invoice", () => {
  it("invoices/new: Save Draft POSTs the journey's invoice (two line items, the contact) once and opens its detail", async () => {
    signedIn();
    nav.pathname = "/app/commerce/invoices/new";
    routes[key("GET", P.contacts)] = answer(J.contactsBefore);
    routes[key("GET", P.products)] = answer(S.products);
    routes[key("POST", P.invoices)] = answer(J.invoiceCreated);
    renderScreen(<NewInvoicePage />);

    expect(await screen.findByRole("heading", { name: "New Invoice" }, { timeout: 3000 })).toBeInTheDocument();
    const contactId = (J.contactsBefore.body as { contacts: Array<{ id: string }> }).contacts[0].id;
    fireEvent.change(screen.getByDisplayValue("Select a client..."), { target: { value: contactId } });

    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    const descriptions = screen.getAllByPlaceholderText("Item description");
    expect(descriptions).toHaveLength(2);
    const fill = (row: number, description: string, qty: string, price: string) => {
      fireEvent.change(descriptions[row], { target: { value: description } });
      const line = descriptions[row].closest("div.grid") as HTMLElement;
      const [qtyInput, priceInput] = Array.from(line.querySelectorAll<HTMLInputElement>('input[type="number"]'));
      fireEvent.change(qtyInput, { target: { value: qty } });
      fireEvent.change(priceInput, { target: { value: price } });
    };
    fill(0, "Consulting", "2", "100");
    fill(1, "Setup", "1", "50");

    const saveDraft = screen.getByRole("button", { name: /save draft/i });
    fireEvent.click(saveDraft);

    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith(`/app/commerce/invoices/${INVOICE.id}`));
    expect(callsTo("POST", P.invoices)).toHaveLength(1);
    expect(callsTo("POST", P.invoices)[0].body).toMatchObject({
      contactId,
      currency: "TTD",
      items: [
        { description: "Consulting", quantity: 2, unitPrice: 100 },
        { description: "Setup", quantity: 1, unitPrice: 50 },
      ],
    });
    // Save Draft is a draft: no status change and nothing sent.
    expect(writes()).toEqual([key("POST", P.invoices)]);
  });

  it("invoices/[id] renders the DRAFT read from GET /commerce/businesses/:b/invoices/:id", async () => {
    signedIn();
    openInvoice(J.invoiceDraft);

    expect(await invoiceHeading()).toBeInTheDocument();
    const header = within(screen.getByRole("heading", { name: `Invoice ${INVOICE.invoiceNumber}` }).parentElement as HTMLElement);
    expect(header.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Consulting")).toBeInTheDocument();
    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(paymentSummary()).toEqual({ total: "TTD 250.00", paid: "TTD 0.00", remaining: "TTD 250.00" });
    // A DRAFT is edited and sent; it does not take payments.
    expect(screen.getAllByRole("button", { name: /send/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /record payment/i })).not.toBeInTheDocument();
    // Read through the tenant route, never the public bare-id one.
    expect(callsTo("GET", P.invoice)).toHaveLength(1);
    expect(calls.some((c) => c.path === `/commerce/invoices/${INVOICE.id}`)).toBe(false);
    expect(writes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step 4
// ---------------------------------------------------------------------------

describe("step 4 — record an offline payment", () => {
  it("Record Payment: a double click POSTs once, carrying an idempotency key, and the summary shows the server's paid and remaining", async () => {
    signedIn();
    let release: () => void = () => {};
    holds[key("POST", P.payments)] = new Promise<void>((r) => (release = r));
    routes[key("POST", P.payments)] = answer(J.paymentRecorded);
    openInvoice(J.invoiceSent);
    expect(await invoiceHeading()).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /record payment/i })[0]);
    const modal = within(screen.getByRole("heading", { name: "Record Payment" }).parentElement as HTMLElement);
    fireEvent.change(modal.getByPlaceholderText("250.00"), { target: { value: "100" } });
    const submit = modal.getByRole("button", { name: "Record Payment" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(callsTo("POST", P.payments)).toHaveLength(1));
    fireEvent.click(submit);
    release();

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Record Payment" })).not.toBeInTheDocument());
    const posts = callsTo("POST", P.payments);
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ amount: 100, method: "Cash" });
    expect(typeof (posts[0].body as { idempotencyKey?: unknown }).idempotencyKey).toBe("string");
    expect(paymentSummary()).toEqual({ total: "TTD 250.00", paid: "TTD 100.00", remaining: "TTD 150.00" });
    const header = within(screen.getByRole("heading", { name: `Invoice ${INVOICE.invoiceNumber}` }).parentElement as HTMLElement);
    expect(header.getByText("Part-paid")).toBeInTheDocument();
    expect(writes()).toEqual([key("POST", P.payments)]);
  });

  it("Record Payment: a submit the server fails (500) and the owner submits again goes out twice under ONE idempotency key, made on the first submit (R0-21)", async () => {
    signedIn();
    let submits = 0;
    routes[key("POST", P.payments)] = () => (++submits === 1 ? answer(S.serverError) : answer(J.paymentRecorded));
    openInvoice(J.invoiceSent);
    expect(await invoiceHeading()).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /record payment/i })[0]);
    const modal = within(screen.getByRole("heading", { name: "Record Payment" }).parentElement as HTMLElement);
    fireEvent.change(modal.getByPlaceholderText("250.00"), { target: { value: "100" } });
    const submit = modal.getByRole("button", { name: "Record Payment" });
    fireEvent.click(submit);
    await waitFor(() => expect(callsTo("POST", P.payments)).toHaveLength(1));
    // The failure is shown, the form stays open with what was typed, and nothing changed on the invoice.
    expect(await screen.findByText("Internal server error", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Record Payment" })).toBeInTheDocument();
    expect(paymentSummary()).toEqual({ total: "TTD 250.00", paid: "TTD 0.00", remaining: "TTD 250.00" });
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.click(submit);
    await waitFor(() => expect(callsTo("POST", P.payments)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Record Payment" })).not.toBeInTheDocument());

    const keys = callsTo("POST", P.payments).map((c) => (c.body as { idempotencyKey?: unknown }).idempotencyKey);
    expect(typeof keys[0]).toBe("string");
    expect((keys[0] as string).length).toBeGreaterThan(0);
    expect(keys[1]).toBe(keys[0]);
    expect(callsTo("POST", P.payments).map((c) => c.body)).toEqual([
      expect.objectContaining({ amount: 100, method: "Cash" }),
      expect.objectContaining({ amount: 100, method: "Cash" }),
    ]);
    expect(paymentSummary()).toEqual({ total: "TTD 250.00", paid: "TTD 100.00", remaining: "TTD 150.00" });
    expect(writes()).toEqual([key("POST", P.payments), key("POST", P.payments)]);
  });
});

// ---------------------------------------------------------------------------
// Step 5
// ---------------------------------------------------------------------------

describe("step 5 — simulated refresh", () => {
  it("unmounting and re-rendering invoices/[id] with the same fixtures shows identical state, read again from the server", async () => {
    signedIn();
    const first = openInvoice(J.invoiceSent);
    expect(await invoiceHeading()).toBeInTheDocument();
    const before = { text: first.container.textContent, summary: paymentSummary() };
    const readsBefore = callsTo("GET", P.invoice).length;
    first.unmount();
    expect(screen.queryByRole("heading", { name: `Invoice ${INVOICE.invoiceNumber}` })).not.toBeInTheDocument();

    const second = openInvoice(J.invoiceSent);
    expect(await invoiceHeading()).toBeInTheDocument();
    await waitFor(() => expect(second.container.textContent).toBe(before.text));
    expect(paymentSummary()).toEqual(before.summary);
    expect(callsTo("GET", P.invoice).length).toBe(readsBefore + 1);
    expect(writes()).toEqual([]);
  });

  it("after Record Payment, unmounting and re-reading invoices/[id] shows the recorded payment (100 paid, 150 remaining, Part-paid) from the server's detail read", async () => {
    signedIn();
    // The server: the detail read is SENT until the payment lands, then PARTIALLY_PAID with that payment.
    let recorded = false;
    routes[key("POST", P.payments)] = () => { recorded = true; return answer(J.paymentRecorded); };
    const read = () => (recorded ? J.invoicePartiallyPaid : J.invoiceSent);
    const header = () => within(screen.getByRole("heading", { name: `Invoice ${INVOICE.invoiceNumber}` }).parentElement as HTMLElement);

    const first = openInvoice(read);
    expect(await invoiceHeading()).toBeInTheDocument();
    expect(paymentSummary()).toEqual({ total: "TTD 250.00", paid: "TTD 0.00", remaining: "TTD 250.00" });
    fireEvent.click(screen.getAllByRole("button", { name: /record payment/i })[0]);
    const modal = within(screen.getByRole("heading", { name: "Record Payment" }).parentElement as HTMLElement);
    fireEvent.change(modal.getByPlaceholderText("250.00"), { target: { value: "100" } });
    fireEvent.click(modal.getByRole("button", { name: "Record Payment" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Record Payment" })).not.toBeInTheDocument());
    // What the screen shows from the POST's response, in client memory.
    const afterPayment = paymentSummary();
    expect(afterPayment).toEqual({ total: "TTD 250.00", paid: "TTD 100.00", remaining: "TTD 150.00" });
    expect(header().getByText("Part-paid")).toBeInTheDocument();
    const readsBefore = callsTo("GET", P.invoice).length;
    first.unmount();
    expect(screen.queryByRole("heading", { name: `Invoice ${INVOICE.invoiceNumber}` })).not.toBeInTheDocument();

    // The refresh: nothing survives in memory; the same state comes back from the server's read.
    openInvoice(read);
    expect(await invoiceHeading()).toBeInTheDocument();
    expect(callsTo("GET", P.invoice).length).toBe(readsBefore + 1);
    expect(paymentSummary()).toEqual(afterPayment);
    expect(header().getByText("Part-paid")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /record payment/i }).length).toBeGreaterThan(0);
    // The one write is the payment; the refresh wrote nothing.
    expect(writes()).toEqual([key("POST", P.payments)]);
  });

  it("unmounting and re-rendering Contacts with the same fixtures shows the same rows, read again from the server", async () => {
    signedIn();
    nav.pathname = "/app/crm/contacts";
    window.localStorage.setItem("kf_pipeline_view", "list");
    routes[key("GET", P.contacts)] = answer(J.contactsAfter);
    const rows = () => [screen.queryByText(/hopper/i), screen.queryByText(/byron/i)].map((el) => el?.textContent ?? null);

    const first = renderScreen(<ContactsPage />);
    expect(await screen.findByText(/hopper/i, {}, { timeout: 3000 })).toBeInTheDocument();
    const before = rows();
    const readsBefore = callsTo("GET", P.contacts).length;
    first.unmount();

    renderScreen(<ContactsPage />);
    expect(await screen.findByText(/hopper/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(rows()).toEqual(before);
    expect(callsTo("GET", P.contacts).length).toBeGreaterThan(readsBefore);
    expect(writes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step 6
// ---------------------------------------------------------------------------

describe("step 6 — a refused read is shown as refused", () => {
  it("invoices/[id]: a 403 on the tenant read shows the server's error, never an invoice or demo data", async () => {
    signedIn();
    openInvoice(S.forbidden);

    expect(await screen.findByText("No access to this business", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Invoice INV-/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/payment summary/i)).not.toBeInTheDocument();
    // The demo fallbacks (lib/client.ts fallbackInvoices, DEFAULT_BUSINESS_ID).
    expect(screen.queryByText(/INV-00\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sarah|john/i)).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.includes("biz_demo"))).toBe(false);
    expect(writes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step 7
// ---------------------------------------------------------------------------

describe("step 7 — optional services fail visibly", () => {
  it("onboarding: a KEY chat turn answered with the R0-07 AI 503 shows the failure in the chat and leaves the manual path (R0-06) usable, not a blank page or a spinner", async () => {
    signedIn();
    nav.pathname = "/app/onboarding";
    routes[key("GET", P.onboardingState)] = answer(S.onboardingState);
    routes[key("GET", P.business)] = answer(J.business);
    renderScreen(<OnboardingPage />);

    const heading = await screen.findByRole("heading", { name: /set up manually/i }, { timeout: 3000 });
    const step = within((heading.closest("section") ?? heading.parentElement) as HTMLElement);
    // At the welcome step the chat seeds its greeting locally and sends no AI
    // turn, so the owner sends one: KEY's stream route answers the 503, the
    // chat falls back to the REST route, which answers it too.
    const input = await screen.findByPlaceholderText("Message KEY...", {}, { timeout: 3000 });
    fireEvent.change(input, { target: { value: "I run a bakery in Port of Spain" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const aiMessage = (S.aiNotConfigured.body as { message: string }).message;
    await waitFor(() => expect(callsTo("POST", P.aiChat)).toHaveLength(1), { timeout: 3000 });
    expect((await screen.findAllByText(aiMessage, {}, { timeout: 3000 })).length).toBeGreaterThan(0);
    expect(callsTo("POST", P.aiChatStream)).toHaveLength(1);
    expect(callsTo("POST", P.aiChatStream)[0].body).toMatchObject({ message: "I run a bakery in Port of Spain" });
    expect(callsTo("POST", P.aiChat)[0].body).toMatchObject({ message: "I run a bakery in Port of Spain" });
    // Every AI request named this tenant (the 503 answers only those).
    const aiCalls = calls.filter((c) => c.path.startsWith("/ai/"));
    expect(aiCalls.filter((c) => !c.path.startsWith(P.ai))).toEqual([]);

    // The manual path is still there and still takes input after the failure.
    const name = step.getByLabelText(/business name/i) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "r023 Bakery" } });
    expect(name.value).toBe("r023 Bakery");
    expect(step.getByLabelText(/currency/i)).toBeInTheDocument();
    expect(step.getByLabelText(/timezone/i)).toBeInTheDocument();
    expect(step.getByRole("button", { name: /finish setup/i })).toBeEnabled();
    expect(nav.router.replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/app\/(?!onboarding)/));
    // The only writes are the one chat turn (stream, then its REST fallback); nothing else was written.
    expect(writes()).toEqual([key("POST", P.aiChatStream), key("POST", P.aiChat)]);
  });

  it.todo(
    "invoices/[id] send-email answering 503 {code: 'provider_not_configured'} (R0-07) renders a visible 'email is not configured' error and leaves the status on screen unchanged. " +
      "NOT RENDERABLE ON THIS BASE: invoices/[id] has no send-email door. Its 'Send' calls updateInvoiceStatus (PATCH /commerce/invoices/:id/status/sent) and emails no one, " +
      "and sendInvoiceEmail (lib/client.ts, POST .../invoices/:id/send-email) has no caller anywhere in apps/web. Adding the door is app code, outside the R0-23 write set.",
  );

  it("invoices/[id]: the email door it does have (Resend receipt on a PAID invoice) answering the R0-07 503 shows the server's message and the status stays PAID", async () => {
    signedIn();
    routes[key("POST", P.resendReceipt)] = answer(S.gmailNotConfigured);
    openInvoice(J.invoicePaid);
    expect(await invoiceHeading()).toBeInTheDocument();
    const header = () => within(screen.getByRole("heading", { name: `Invoice ${INVOICE.invoiceNumber}` }).parentElement as HTMLElement);
    expect(header().getByText("Paid")).toBeInTheDocument();
    // The server's figures for the settled invoice (the 100 payment and the 150 settle).
    expect(paymentSummary()).toEqual({ total: "TTD 250.00", paid: "TTD 250.00", remaining: "TTD 0.00" });

    fireEvent.click(screen.getByRole("button", { name: /resend receipt/i }));

    await waitFor(() => expect(callsTo("POST", P.resendReceipt)).toHaveLength(1));
    expect(await screen.findByText("Gmail not connected", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(header().getByText("Paid")).toBeInTheDocument();
    expect(paymentSummary()).toEqual({ total: "TTD 250.00", paid: "TTD 250.00", remaining: "TTD 0.00" });
    expect(writes()).toEqual([key("POST", P.resendReceipt)]);
    expect(callsTo("POST", P.sendEmail)).toHaveLength(0);
  });
});
