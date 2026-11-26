/**
 * FIX-CONTACT-PARAMS (v1 step 3, sweep BUG-038, journey C step C4): every link
 * to a customer's main page, /app/crm/contacts/<id>, opens the customer.
 *
 * WHY this test exists: app/app/crm/contacts/[contactId]/page.tsx only
 * redirects to the customer's Overview, and it read `params.contactId`
 * synchronously. Next 16 hands a page its params as a Promise and nothing else
 * (next/dist/server/request/params.js: `Promise.resolve(underlyingParams)` in
 * production; the synchronous property shim of Next 15 is gone), so the read
 * was `undefined` and every door to a customer redirected to
 * /app/crm/contacts/undefined/overview: 'Could not load this contact - Missing
 * id' (lib/api refuses an 'undefined' id segment before sending anything). Only
 * the /<id>/<tab> addresses worked, because the tabs read the id with
 * useParams().
 *
 * The route is served the way Next 16 serves it, in two hops:
 *   1. the index page is called as Next calls a server page, with `params` and
 *      `searchParams` as Promises; Next's own redirect() (not a mock) throws
 *      its NEXT_REDIRECT error, and the URL is read back with Next's helpers;
 *   2. the URL it names is mounted as Next mounts it: the [contactId] layout
 *      with that tab's page as its child, the segment from that URL handed
 *      to useParams(), on the real ContactDetailProvider and the real client.
 * Only `fetch` and the client router hooks are stubbed.
 *
 * The doors: the address itself; Cmd/Ctrl+K (the command palette mounted by
 * KeyAgent; its customer result pushes /app/crm/contacts/<id>); the hrefs the
 * other in-app doors build with a query; the CRM dashboard, data quality,
 * People Flow, Intelligence and Network build the bare address the first case
 * opens.
 *
 * The query doors (review FCP-COR-2). A project's client tab links 'Messages'
 * (?tab=communications) and 'Invoices' (?tab=invoices), and the project
 * overview's 'Comms' link the first: names from the single-page contact detail
 * the tabbed layout replaced. The redirect dropped every query, so both opened
 * the Overview, not the Timeline or Quotes & Invoices tab their label names.
 * ?tab= now picks the tab (a tab's own name, or the older name's tab; anything
 * else is the Overview) and the rest of the query is passed on unchanged. The
 * Customers list's 'Refer / Link' builds ?action=refer: the single page opened
 * its refer dialog from it, and nothing on the tabbed page reads it today (the
 * dialog is mounted nowhere), so that door opens the Overview with
 * ?action=refer kept for the page that will read it. That reader is not this
 * page (an open issue for the contact pages).
 *
 * Journey C4 drives the doors in a browser (e2e/journeys/c-customer.spec.ts);
 * its list, Cmd/Ctrl+K (the palette lists the customer as an option in its
 * results listbox, FU-C4-CMDK-SEARCH, as the journey looks for it), Today and
 * invoice steps need those screens, which are not this page.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";

const nav = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  pathname: "/",
  push: (() => undefined) as (href: string) => void,
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    // redirect() and notFound() stay Next's own: they throw Next's errors.
    ...actual,
    useRouter: () => ({
      push: (href: string) => nav.push(href),
      replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(),
    }),
    usePathname: () => nav.pathname,
    useSearchParams: () => new URLSearchParams(),
    useParams: () => nav.params,
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

// The palette's Contact Support action opens the email composer; nothing here uses it.
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));

import ContactDetailIndex from "../[contactId]/page";
import ContactDetailLayout from "../[contactId]/layout";
import ContactOverviewPage from "../[contactId]/overview/page";
import ContactTimelinePage from "../[contactId]/timeline/page";
import ContactQuotesInvoicesPage from "../[contactId]/quotes-invoices/page";
import { CommandPalette } from "@/components/command-palette";

/** The business the signed-in member belongs to (seeded as kf_business_id). */
const MEMBER_BUSINESS = "biz_1";
const CONTACT_ID = "cm3contact0ada0lovelace01";
const NAME = "Ada Lovelace";
const DETAIL_PATH = `/crm/businesses/${MEMBER_BUSINESS}/contacts/${CONTACT_ID}`;
const EVENTS_PATH = `${DETAIL_PATH}/events`;
const INVOICES_PATH = `/commerce/businesses/${MEMBER_BUSINESS}/invoices`;
const QUOTES_PATH = `/commerce/businesses/${MEMBER_BUSINESS}/quotes`;
const SEARCH_PATH = `/api/flows/businesses/${MEMBER_BUSINESS}/search`;
/** lib/api/_defaults.ts MISSING_ID: what the client answers for an 'undefined' id, sending nothing. */
const MISSING_ID = "Missing id";
/** What this customer's Quotes & Invoices and Timeline tabs list (and nothing else on the page names). */
const INVOICE_NUMBER = "INV-0042";
const CALL_SUBJECT = "Called about the kitchen repaint";

/**
 * The customer's tabs: each is a folder with a page.tsx beside the index page
 * (layout.tsx draws one link per tab). Read from the tree, so a tab added later
 * is held to the same rule.
 */
const CONTACT_ROUTE_DIR = path.resolve(__dirname, "../[contactId]");
const TAB_IDS = fs
  .readdirSync(CONTACT_ROUTE_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(CONTACT_ROUTE_DIR, entry.name, "page.tsx")))
  .map((entry) => entry.name)
  .sort();

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

const contactDetail = () =>
  jsonResponse(200, {
    contact: {
      id: CONTACT_ID,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      phone: "+1 868 555 0100",
      status: "CLIENT",
      tags: [],
      lifetimeValue: 1200,
    },
    events: [],
    notes: [],
    tasks: [],
    meta: { leadScore: 72 },
  });

const searchResult = () =>
  jsonResponse(200, {
    contacts: [{ id: CONTACT_ID, firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", status: "CLIENT" }],
    invoices: [],
    bookings: [],
    products: [],
    projects: [],
  });

/**
 * The server, as its guards answer: another business is refused; the contact
 * detail read, this customer's events, invoices and quotes, and the palette
 * search answer; anything else is a 404. Returns the pathnames asked for and
 * the full URLs.
 */
function stubServer() {
  const requested: string[] = [];
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url, "http://localhost");
      const { pathname } = parsed;
      requested.push(pathname);
      urls.push(parsed);
      const tenant = pathname.match(/\/businesses\/([^/]+)\//)?.[1];
      if (tenant && tenant !== MEMBER_BUSINESS) {
        return jsonResponse(403, { statusCode: 403, message: "No access to this business", error: "Forbidden" }, "Forbidden");
      }
      if (pathname.endsWith(DETAIL_PATH)) return contactDetail();
      if (pathname.endsWith(EVENTS_PATH)) {
        const events = [
          { id: "ev_call_1", contactId: CONTACT_ID, type: "call", data: { subject: CALL_SUBJECT }, createdAt: "2026-11-10T10:00:00.000Z" },
        ];
        // As the server answers since FU-TIMELINE-EVENTS-PAGING (D-284): a paged read (the Timeline's, since
        // FU-TIMELINE-LOAD-OLDER) gets { events, nextCursor, hasMore }; the default read the plain array.
        const q = parsed.searchParams;
        const paged = q.has("paged") || q.has("limit") || q.has("cursor");
        return jsonResponse(200, paged ? { events, nextCursor: null, hasMore: false } : events);
      }
      const ofThisCustomer = parsed.searchParams.get("contactId") === CONTACT_ID;
      if (pathname.endsWith(INVOICES_PATH)) {
        return jsonResponse(200, {
          data: ofThisCustomer ? [{ id: "inv_1", invoiceNumber: INVOICE_NUMBER, status: "SENT", total: 200, currency: "TTD" }] : [],
        });
      }
      if (pathname.endsWith(QUOTES_PATH)) return jsonResponse(200, { data: [] });
      if (pathname.endsWith(SEARCH_PATH)) return searchResult();
      return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
    }),
  );
  return { requested, urls };
}

type ServerPage = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[]>>;
}) => unknown;

/**
 * A query as Next hands it to a page: one key per name, a repeated name as an
 * array of its values in order, on an object with no prototype (so a name such
 * as `__proto__` is an own key, as in Next's parsed query).
 */
function nextSearchParams(search: URLSearchParams): Record<string, string | string[]> {
  const out = Object.create(null) as Record<string, string | string[]>;
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

/**
 * Hop 1: Next 16 serving /app/crm/contacts/<segment>[?query] with the index
 * page. Returns the URL its redirect() names.
 */
async function serveContactIndex(href: string): Promise<string> {
  const url = new URL(href, "http://localhost");
  const segment = url.pathname.match(/^\/app\/crm\/contacts\/([^/]+)$/)?.[1];
  expect(segment, `${href} is a customer's main page, /app/crm/contacts/<id>`).toBeTruthy();
  const page = ContactDetailIndex as unknown as ServerPage;
  try {
    await page({
      params: Promise.resolve({ contactId: segment as string }),
      searchParams: Promise.resolve(nextSearchParams(url.searchParams)),
    });
  } catch (err) {
    if (isRedirectError(err)) return getURLFromRedirectError(err);
    throw err;
  }
  throw new Error(`${href}: the index page rendered instead of redirecting to one of the customer's tabs`);
}

/** The tab pages this test mounts, by the tab segment of the URL. */
const TAB_PAGES = new Map<string, () => ReactNode>([
  ["overview", () => <ContactOverviewPage />],
  ["timeline", () => <ContactTimelinePage />],
  ["quotes-invoices", () => <ContactQuotesInvoicesPage />],
]);

/** Hop 2: mount the URL the redirect names, as Next mounts /app/crm/contacts/[contactId]/<tab>. */
function mountContactPage(href: string) {
  const { pathname } = new URL(href, "http://localhost");
  const [, segment, tab] = pathname.match(/^\/app\/crm\/contacts\/([^/]+)\/([^/]+)$/) ?? [];
  expect(segment, `${href} is one of a customer's tabs, /app/crm/contacts/<id>/<tab>`).toBeTruthy();
  const tabPage = TAB_PAGES.get(tab);
  if (!tabPage) throw new Error(`${href}: this test does not mount the '${tab}' tab`);
  nav.params = { contactId: segment };
  nav.pathname = pathname;
  return render(<ContactDetailLayout>{tabPage()}</ContactDetailLayout>);
}

/** Open an href the way a click on it does, and wait until the customer's page has settled. */
async function openCustomer(href: string): Promise<string> {
  const target = await serveContactIndex(href);
  mountContactPage(target);
  // The header renders an h1 once the read settles: the customer's name, or a failure state.
  await screen.findByRole("heading", { level: 1 });
  return target;
}

/**
 * The customer's page is open on the tab the door names: not 'Missing id', the
 * heading names them, the redirect named `expectedTarget` (their Overview
 * unless the door asked for a tab), and the read was theirs.
 */
function expectCustomerOpen(target: string, requested: string[], expectedTarget = `/app/crm/contacts/${CONTACT_ID}/overview`) {
  expect(screen.queryByText(MISSING_ID), "the customer's page does not say 'Missing id'").not.toBeInTheDocument();
  expect(screen.queryByText("Could not load this contact")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(NAME);
  expect(target, "the redirect names this customer's tab the door asked for").toBe(expectedTarget);
  expect(requested.filter((p) => p.includes("/contacts/")), "the page read this customer").toContain(DETAIL_PATH);
}

/** The tab selector (the phone's; the desktop row highlights the same tab) shows `label`. */
function expectTabSelected(label: string) {
  expect(screen.getByDisplayValue(label), `the customer's page is on its ${label} tab`).toBeInTheDocument();
}

describe("/app/crm/contacts/<id> opens the customer (BUG-038, journey C4)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", MEMBER_BUSINESS);
    nav.params = {};
    nav.pathname = "/";
    nav.push = () => undefined;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("the address itself: params arrive as a Promise; the page redirects to /<id>/overview and the customer opens, not 'Missing id'", async () => {
    const { requested } = stubServer();
    const target = await openCustomer(`/app/crm/contacts/${CONTACT_ID}`);
    expectCustomerOpen(target, requested);
  });

  it("Cmd/Ctrl+K: the palette's customer result goes to /app/crm/contacts/<id>, which opens the customer", async () => {
    const { requested } = stubServer();
    const pushed: string[] = [];
    nav.push = (href) => pushed.push(href);
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/search everything/i), { target: { value: "Lovelace" } });
    fireEvent.click(await screen.findByRole("option", { name: new RegExp(NAME) }));
    expect(pushed, "the palette navigates to the customer's main page").toEqual([`/app/crm/contacts/${CONTACT_ID}`]);
    expect(onClose).toHaveBeenCalled();
    cleanup();

    const target = await openCustomer(pushed[0]);
    expectCustomerOpen(target, requested);
  });

  it("a project's client tab 'Invoices' (?tab=invoices) opens the customer on Quotes & Invoices, their invoice listed", async () => {
    const { requested, urls } = stubServer();
    const target = await openCustomer(`/app/crm/contacts/${CONTACT_ID}?tab=invoices`);
    expectCustomerOpen(target, requested, `/app/crm/contacts/${CONTACT_ID}/quotes-invoices`);
    expectTabSelected("Quotes & Invoices");
    expect(await screen.findByText(INVOICE_NUMBER), "this customer's invoice is listed").toBeInTheDocument();
    expect(
      urls.some((u) => u.pathname.endsWith(INVOICES_PATH) && u.searchParams.get("contactId") === CONTACT_ID),
      "the tab read this customer's invoices",
    ).toBe(true);
  });

  it("a project's 'Messages' and 'Comms' links (?tab=communications) open the customer on the Timeline, their call listed", async () => {
    const { requested } = stubServer();
    const target = await openCustomer(`/app/crm/contacts/${CONTACT_ID}?tab=communications`);
    expectCustomerOpen(target, requested, `/app/crm/contacts/${CONTACT_ID}/timeline`);
    expectTabSelected("Timeline");
    expect(await screen.findByText(CALL_SUBJECT), "this customer's call is listed").toBeInTheDocument();
    expect(requested, "the tab read this customer's events").toContain(EVENTS_PATH);
  });

  it("the Customers list's 'Refer / Link' (?action=refer) opens the customer on the Overview, ?action=refer kept for the page", async () => {
    const { requested } = stubServer();
    const target = await openCustomer(`/app/crm/contacts/${CONTACT_ID}?action=refer`);
    expectCustomerOpen(target, requested, `/app/crm/contacts/${CONTACT_ID}/overview?action=refer`);
    expectTabSelected("Overview");
  });

  it("a customer the server does not find says 'Contact not found', not 'Missing id' (the route hands the server the real id)", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const { pathname } = new URL(url, "http://localhost");
        requested.push(pathname);
        if (pathname.endsWith(DETAIL_PATH)) {
          return jsonResponse(404, { statusCode: 404, message: "Contact not found", error: "Not Found" }, "Not Found");
        }
        return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
      }),
    );
    await openCustomer(`/app/crm/contacts/${CONTACT_ID}`);
    expect(screen.queryByText(MISSING_ID)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Contact not found"));
    expect(requested, "the server was asked about this customer").toContain(DETAIL_PATH);
  });
});

describe("/app/crm/contacts/<id>?tab=... opens that tab; the rest of the query is passed on (review FCP-COR-2)", () => {
  const index = `/app/crm/contacts/${CONTACT_ID}`;

  it("every tab of the customer's page, named in ?tab=, opens that tab", async () => {
    expect(TAB_IDS.length, `the customer's page has its tabs (found: ${TAB_IDS.join(", ")})`).toBeGreaterThanOrEqual(9);
    expect(TAB_IDS).toEqual(expect.arrayContaining(["overview", "timeline", "quotes-invoices", "notes", "tasks"]));
    for (const tab of TAB_IDS) {
      expect(await serveContactIndex(`${index}?tab=${tab}`), `?tab=${tab}`).toBe(`${index}/${tab}`);
    }
  });

  it("an unknown name, an empty one, or a name every object inherits opens the Overview, and ?tab= is not passed on", async () => {
    for (const tab of ["deals", "", "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(await serveContactIndex(`${index}?tab=${encodeURIComponent(tab)}`), `?tab=${tab}`).toBe(`${index}/overview`);
    }
  });

  it("a repeated ?tab= takes its first value", async () => {
    expect(await serveContactIndex(`${index}?tab=invoices&tab=notes`)).toBe(`${index}/quotes-invoices`);
  });

  it("the rest of the query is passed on as given: every value, repeats in order, each encoded", async () => {
    // A value that, written out unencoded, would add a parameter of its own.
    const from = "today&tab=notes&x=1";
    const target = await serveContactIndex(
      `${index}?tab=communications&action=refer&from=${encodeURIComponent(from)}&tag=vip&tag=new`,
    );
    const url = new URL(target, "http://localhost");
    expect(url.pathname).toBe(`${index}/timeline`);
    expect(url.searchParams.get("action")).toBe("refer");
    expect(url.searchParams.get("from")).toBe(from);
    expect(url.searchParams.getAll("tag")).toEqual(["vip", "new"]);
    expect([...url.searchParams.keys()], "?tab= is spent on the tab; nothing else is added").toEqual(["action", "from", "tag", "tag"]);
  });
});
