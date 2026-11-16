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
 *      with the Overview page as its child, the segment from that URL handed
 *      to useParams(), on the real ContactDetailProvider and the real client.
 * Only `fetch` and the client router hooks are stubbed.
 *
 * The doors: the address itself; Cmd/Ctrl+K (the command palette mounted by
 * KeyAgent; its customer result pushes /app/crm/contacts/<id>); the hrefs the
 * other in-app doors build with a query (the Customers list's Refer action,
 * ?action=refer; a project's client tab, ?tab=...); the CRM dashboard, data
 * quality, People Flow, Intelligence and Network build the bare address the
 * first case opens. Journey C4 drives the same doors in a
 * browser (e2e/journeys/c-customer.spec.ts); its list, Today and invoice steps
 * also need those screens to link the customer at all, which is not this page.
 */
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
import { CommandPalette } from "@/components/command-palette";

/** The business the signed-in member belongs to (seeded as kf_business_id). */
const MEMBER_BUSINESS = "biz_1";
const CONTACT_ID = "cm3contact0ada0lovelace01";
const NAME = "Ada Lovelace";
const DETAIL_PATH = `/crm/businesses/${MEMBER_BUSINESS}/contacts/${CONTACT_ID}`;
const SEARCH_PATH = `/api/flows/businesses/${MEMBER_BUSINESS}/search`;
/** lib/api/_defaults.ts MISSING_ID: what the client answers for an 'undefined' id, sending nothing. */
const MISSING_ID = "Missing id";

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
 * The server, as its guards answer: another business is refused, the contact
 * detail read and the palette search answer, anything else is a 404. Returns
 * the pathnames asked for.
 */
function stubServer() {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      requested.push(pathname);
      const tenant = pathname.match(/\/businesses\/([^/]+)\//)?.[1];
      if (tenant && tenant !== MEMBER_BUSINESS) {
        return jsonResponse(403, { statusCode: 403, message: "No access to this business", error: "Forbidden" }, "Forbidden");
      }
      if (pathname.endsWith(DETAIL_PATH)) return contactDetail();
      if (pathname.endsWith(SEARCH_PATH)) return searchResult();
      return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
    }),
  );
  return { requested };
}

type ServerPage = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => unknown;

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
      searchParams: Promise.resolve(Object.fromEntries(url.searchParams)),
    });
  } catch (err) {
    if (isRedirectError(err)) return getURLFromRedirectError(err);
    throw err;
  }
  throw new Error(`${href}: the index page rendered instead of redirecting to the customer's Overview`);
}

/** Hop 2: mount the URL the redirect names, as Next mounts /app/crm/contacts/[contactId]/overview. */
function mountContactPage(href: string) {
  const { pathname } = new URL(href, "http://localhost");
  const segment = pathname.match(/^\/app\/crm\/contacts\/([^/]+)\/overview$/)?.[1];
  expect(segment, `${href} is a customer's Overview`).toBeTruthy();
  nav.params = { contactId: segment as string };
  nav.pathname = pathname;
  return render(
    <ContactDetailLayout>
      <ContactOverviewPage />
    </ContactDetailLayout>,
  );
}

/** Open an href the way a click on it does, and wait until the customer's page has settled. */
async function openCustomer(href: string): Promise<string> {
  const target = await serveContactIndex(href);
  mountContactPage(target);
  // The header renders an h1 once the read settles: the customer's name, or a failure state.
  await screen.findByRole("heading", { level: 1 });
  return target;
}

/** The customer's page is open: not 'Missing id', the heading names them, and the read was theirs. */
function expectCustomerOpen(target: string, requested: string[]) {
  expect(screen.queryByText(MISSING_ID), "the customer's page does not say 'Missing id'").not.toBeInTheDocument();
  expect(screen.queryByText("Could not load this contact")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(NAME);
  expect(target, "the redirect names this customer's Overview").toBe(`/app/crm/contacts/${CONTACT_ID}/overview`);
  expect(requested.filter((p) => p.includes("/contacts/")), "the page read this customer").toContain(DETAIL_PATH);
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
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(NAME) }));
    expect(pushed, "the palette navigates to the customer's main page").toEqual([`/app/crm/contacts/${CONTACT_ID}`]);
    expect(onClose).toHaveBeenCalled();
    cleanup();

    const target = await openCustomer(pushed[0]);
    expectCustomerOpen(target, requested);
  });

  it.each([
    ["the Customers list's Refer action", `/app/crm/contacts/${CONTACT_ID}?action=refer`],
    ["a project's client tab (communications)", `/app/crm/contacts/${CONTACT_ID}?tab=communications`],
    ["a project's client tab (invoices)", `/app/crm/contacts/${CONTACT_ID}?tab=invoices`],
  ])("%s: %s opens the customer", async (_door, href) => {
    const { requested } = stubServer();
    const target = await openCustomer(href);
    expectCustomerOpen(target, requested);
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
