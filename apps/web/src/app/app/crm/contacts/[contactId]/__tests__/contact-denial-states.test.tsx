/**
 * R0-CT-05-WEB-CONTACT-DENIAL-STATES — the contact detail screen.
 *
 * WHY this test exists: CONTACTS-v1 section 5 says "On inadequate permission,
 * show denial state; do not interpret 403 or 404 as empty customer data." The
 * detail screen had one answer for every failed read. ContactDetailProvider
 * stores the server's message in `error`, but neither the header nor the
 * overview read it: the overview printed "Contact not found" whenever
 * `contact` was null, and the header showed a loading skeleton forever. A
 * member the server refused ("No access to this business") was told the
 * record did not exist, which is a different statement with a different fix.
 *
 * The screen is mounted the way Next mounts it (the [contactId] layout with
 * the overview page as its child) on the real ContactDetailProvider and the
 * real client; only `fetch` and the Next router hooks are stubbed, so the
 * error shape under test is the one apiGet (lib/client.ts) really produces:
 * `{ data: null, error: <server message or statusText> }`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import ContactDetailLayout from "../layout";
import ContactOverviewPage from "../overview/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/crm/contacts/c_1/overview",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ contactId: "c_1" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

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

/** The business the signed-in member belongs to (seeded as kf_business_id). */
const MEMBER_BUSINESS = "biz_1";
const DETAIL_PATH = `/crm/businesses/${MEMBER_BUSINESS}/contacts/c_1`;

/**
 * Answer the contact detail read the way the server's guards do. BusinessGuard
 * refuses any business the member does not belong to with 403 "No access to
 * this business" before the handler runs, so only the member's own business
 * reaches `detailResponse`. Matching the path suffix alone let a read sent to
 * the demo tenant pass the readable control (review F2). Anything else the
 * screen asks for is a 404. Returns the requested pathnames.
 */
function stubDetail(detailResponse: () => Response) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    requested.push(pathname);
    const tenant = pathname.match(/\/businesses\/([^/]+)\//)?.[1];
    if (tenant && tenant !== MEMBER_BUSINESS) return forbidden();
    if (pathname.endsWith(DETAIL_PATH)) return detailResponse();
    return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, detailReads: () => requested.filter((p) => p.includes("/contacts/c_1")) };
}

const notFound = () => jsonResponse(404, { statusCode: 404, message: "Contact not found", error: "Not Found" }, "Not Found");
const forbidden = () => jsonResponse(403, { statusCode: 403, message: "No access to this business", error: "Forbidden" }, "Forbidden");
const unauthorized = () => jsonResponse(401, { statusCode: 401, message: "Authentication required", error: "Unauthorized" }, "Unauthorized");
const serverError = () => jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error");
const found = () =>
  jsonResponse(200, {
    contact: {
      id: "c_1",
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

function renderDetail() {
  return render(
    <ContactDetailLayout>
      <ContactOverviewPage />
    </ContactDetailLayout>,
  );
}

/** Record fields the overview and header print when a contact loads. */
function expectNoRecordFields() {
  expect(screen.queryByText("Lifetime Value")).not.toBeInTheDocument();
  expect(screen.queryByText("Payment Reliability")).not.toBeInTheDocument();
  expect(screen.queryByText(/Lead Score/)).not.toBeInTheDocument();
  expect(screen.queryByText("ada@example.test")).not.toBeInTheDocument();
  expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
}

describe("contact detail: not-found, no-access and failure are different states", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", MEMBER_BUSINESS);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("404 'Contact not found' renders the not-found state, not a denial", async () => {
    stubDetail(notFound);
    const { container } = renderDetail();

    expect(await screen.findByText("Contact not found")).toBeInTheDocument();
    expect(screen.queryByText(/do not have access/i)).not.toBeInTheDocument();
    expectNoRecordFields();
    // A finished read is not presented as one still loading.
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("403 'No access to this business' renders a denial message and no record fields", async () => {
    stubDetail(forbidden);
    const { container } = renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/do not have access to this contact/i);
    expect(screen.queryByText("Contact not found")).not.toBeInTheDocument();
    expectNoRecordFields();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("401 the refresh cannot rescue renders the denial, not 'Contact not found'", async () => {
    stubDetail(unauthorized);
    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/do not have access to this contact/i);
    expect(screen.queryByText("Contact not found")).not.toBeInTheDocument();
    expectNoRecordFields();
  });

  it("500 renders a load failure: neither 'Contact not found' nor a denial", async () => {
    stubDetail(serverError);
    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load this contact/i);
    expect(screen.queryByText("Contact not found")).not.toBeInTheDocument();
    expect(screen.queryByText(/do not have access/i)).not.toBeInTheDocument();
    expectNoRecordFields();
  });

  it("control: a readable contact renders its record fields and no unavailable state", async () => {
    const { detailReads } = stubDetail(found);
    renderDetail();

    expect(await screen.findByText("Lifetime Value")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("ada@example.test")).toBeInTheDocument());
    expect(screen.queryByText("Contact not found")).not.toBeInTheDocument();
    expect(screen.queryByText(/do not have access/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(detailReads()).toEqual([DETAIL_PATH]);
  });
});

/**
 * Review ST-1 / F1: ContactDetailProvider calls fetchContactDetail(contactId)
 * with no businessId, and the client defaulted that to DEFAULT_BUSINESS_ID
 * ("biz_demo"). BusinessGuard refuses a real member there, so every member,
 * owners included, was told "You do not have access to this contact" on a
 * contact they may read. The read must be bound to the member's stored
 * business, and with no business there is no request to send at all.
 */
describe("contact detail: the read is bound to the member's business", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("requests /crm/businesses/<stored business>/contacts/:id and shows the record, not a denial", async () => {
    window.localStorage.setItem("kf_business_id", MEMBER_BUSINESS);
    const { detailReads } = stubDetail(found);
    renderDetail();

    expect(await screen.findByText("Lifetime Value")).toBeInTheDocument();
    expect(detailReads()).toEqual([DETAIL_PATH]);
    expect(screen.queryByTestId("contact-unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText(/do not have access/i)).not.toBeInTheDocument();
  });

  it("follows the stored business: a business the member does not belong to is an honest denial", async () => {
    window.localStorage.setItem("kf_business_id", "biz_other");
    const { detailReads } = stubDetail(found);
    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-state", "denied");
    expect(detailReads()).toEqual(["/crm/businesses/biz_other/contacts/c_1"]);
    expectNoRecordFields();
  });

  it("with no stored business and demo mode off: no request, a load failure, not a denial and not the demo tenant", async () => {
    const { detailReads } = stubDetail(found);
    const { container } = renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-state", "failed");
    expect(alert).toHaveTextContent(/no business selected/i);
    expect(screen.queryByText(/do not have access/i)).not.toBeInTheDocument();
    expect(detailReads()).toEqual([]);
    expectNoRecordFields();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });
});
