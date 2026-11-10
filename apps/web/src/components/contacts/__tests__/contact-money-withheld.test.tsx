/**
 * W7-CONTACT-MONEY-VIEWS (V55-13f / V55-13h; owner rulings D-90 and D-63): the
 * contact detail, cross-journey and dossier reads serve a member without
 * revenue read no money row and no money figure. The server keeps each
 * response's shape: the money ContactEvents and the invoice / quote rows are
 * left out, every figure read from them is 0 (meta.totalRevenue,
 * meta.outstandingBalance, summary.totalRevenue) or null (the contact's
 * lifetimeValue / averageSpend), and the dossier's insight drops its payment
 * sentence. These cases render the web readers of those responses with exactly
 * that shape (the bodies below are what apps/server/test/evidence-feed
 * .integration.test.ts V55-13f / V55-13h assert for that member): each view
 * renders, prints no amount, and the client's schemas accept every body (a
 * schema miss would only be logged, so the cases watch that log).
 *
 * The contact screen is mounted the way Next mounts it (the [contactId] layout
 * with the overview page) on the real ContactDetailProvider and client; only
 * `fetch` and the Next router hooks are stubbed. The Timeline tab panel (which
 * draws the detail's events and invoices, the cross-journey, and the dossier's
 * timeline, summary, insight and health) is rendered for real; no business id
 * is passed, so it makes no network call of its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import ContactDetailLayout from "@/app/app/crm/contacts/[contactId]/layout";
import ContactOverviewPage from "@/app/app/crm/contacts/[contactId]/overview/page";
import { TimelineTabPanel } from "../timeline-tab-panel";
import type { ContactDetailData } from "../contact-detail";
import {
  fetchContactCrossJourney,
  fetchContactDetail,
  fetchContactDossier,
  type CrossJourneyResponse,
  type ContactDetail,
} from "@/lib/client";

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

const BUSINESS = "biz_1";
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

/** GET contacts/:id as a member with crm read and revenue 'none' receives it (V55-13h). */
const WITHHELD_DETAIL = {
  contact: {
    id: "c_1",
    businessId: BUSINESS,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    status: "CLIENT",
    tags: [],
    leadScore: 61,
    lifetimeValue: null,
    averageSpend: null,
    paymentReliability: null,
  },
  events: [
    { id: "ev_note", contactId: "c_1", type: "note.created", data: { noteId: "n_1" }, actorType: "SYSTEM", source: "crm", createdAt: at(30) },
    { id: "ev_call", contactId: "c_1", type: "communication.call", data: { summary: "Discovery call" }, actorType: "SYSTEM", source: "crm", createdAt: at(60) },
  ],
  notes: [{ id: "n_1", contactId: "c_1", body: "Prefers mornings", createdAt: at(30) }],
  tasks: [],
  invoices: [],
  bookings: [],
  meta: {
    outstandingBalance: 0,
    unpaidInvoices: 0,
    paidInvoices: 0,
    oldestUnpaidInvoiceDueAt: null,
    lastInteractionAt: at(30),
    nextDueTaskAt: null,
    overdueTasks: 0,
    overdueBookings: 0,
    bookingsRecent: 0,
    leadScore: 55,
    totalRevenue: 0,
    invoiceCount: 0,
    bookingCount: 0,
  },
  customFieldValues: [],
};

/** GET .../cross-journey (and .../story) for that member (V55-13f): no commerce row, totalRevenue 0. */
const WITHHELD_JOURNEY: CrossJourneyResponse = {
  timeline: [
    { id: "ev_note", module: "crm", type: "note.created", title: "Note added", description: "Prefers mornings", timestamp: at(30), entityId: "n_1" },
    { id: "ev_call", module: "crm", type: "communication.call", title: "Call logged", timestamp: at(60) },
    { id: "first_contact", module: "crm", type: "contact.created", title: "Contact created", description: "Ada was added", timestamp: at(600) },
  ],
  summary: {
    bookingsCount: 0,
    totalRevenue: 0,
    lastInteractionAt: at(30),
    momentum: 28,
    engagementLevel: "medium",
    moduleCounts: { crm: 3, bookings: 0, commerce: 0, marketing: 0 },
  },
};

/** GET .../dossier for that member (V55-13f): the detail's contact / notes / meta, the journey, an insight with no payment sentence. */
const WITHHELD_DOSSIER = {
  generatedAt: at(0),
  contact: WITHHELD_DETAIL.contact,
  notes: WITHHELD_DETAIL.notes,
  tasks: [],
  meta: WITHHELD_DETAIL.meta,
  health: { engagement: 30, payment: 33, responsiveness: 60, relationship: 80 },
  insight: {
    summary: "Ada is a client with 4 interactions and 1 notes.",
    nextBestAction: "Check in to ensure satisfaction and explore upsell opportunities",
    reasoning: "Based on 4 interactions, 1 notes, and CLIENT status",
    confidence: 85,
    suggestedMessage: "Hi Ada! Hope everything is going great.",
    tags: ["client"],
  },
  summary: WITHHELD_JOURNEY.summary,
  timeline: WITHHELD_JOURNEY.timeline,
};

/** Text any of these views prints when it shows an amount. */
const MONEY_TEXT = /TTD|\$\s?\d*[1-9]|payments totaling|Payment received|Invoice (sent|overdue|created)/;

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

/** Answer the contact reads with the withheld bodies; anything else is a 404. */
function stubReads() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if (pathname.endsWith(`/crm/businesses/${BUSINESS}/contacts/c_1`)) return jsonResponse(200, WITHHELD_DETAIL);
    if (pathname.endsWith(`/crm/businesses/${BUSINESS}/contacts/c_1/cross-journey`)) return jsonResponse(200, WITHHELD_JOURNEY);
    if (pathname.endsWith(`/crm/businesses/${BUSINESS}/contacts/c_1/dossier`)) return jsonResponse(200, WITHHELD_DOSSIER);
    return jsonResponse(404, { message: "Not stubbed" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The client's schema-miss log (apiGet logs and passes the raw body on). */
function schemaMisses(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
  return spy.mock.calls.filter((args: unknown[]) => String(args[0]).includes("schema validation failed"));
}

describe("contact detail and dossier with money withheld (W7-CONTACT-MONEY-VIEWS, D-90 / D-63)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", BUSINESS);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("V55-13h web: the client accepts the withheld contact detail, cross-journey and dossier bodies as they are (no schema miss, nothing dropped)", async () => {
    stubReads();
    const detail = await fetchContactDetail("c_1", BUSINESS);
    expect(detail.error).toBeNull();
    expect(detail.data?.invoices).toEqual([]);
    expect(detail.data?.meta?.totalRevenue).toBe(0);
    expect(detail.data?.contact?.lifetimeValue).toBeNull();
    const journey = await fetchContactCrossJourney("c_1", BUSINESS);
    expect(journey.error).toBeNull();
    expect(journey.data?.summary.totalRevenue).toBe(0);
    expect(journey.data?.timeline.map((i) => i.id)).toEqual(["ev_note", "ev_call", "first_contact"]);
    const dossier = await fetchContactDossier("c_1", BUSINESS);
    expect(dossier.error).toBeNull();
    expect((dossier.data as typeof WITHHELD_DOSSIER).insight.summary).not.toMatch(/payment/i);
    expect(schemaMisses(errorSpy)).toEqual([]);
  });

  it("V55-13h web: the contact screen renders the withheld detail (Lifetime Value and Avg Spend read $0, the record loads, no failure state)", async () => {
    stubReads();
    render(
      <ContactDetailLayout>
        <ContactOverviewPage />
      </ContactDetailLayout>,
    );
    expect(await screen.findByText("Lifetime Value")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("ada@example.test")).toBeInTheDocument());
    const card = (label: string) => screen.getByText(label).parentElement?.textContent ?? "";
    expect(card("Lifetime Value")).toContain("$0");
    expect(card("Avg Spend")).toContain("$0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/do not have access/i)).not.toBeInTheDocument();
    expect(schemaMisses(errorSpy)).toEqual([]);
  });

  it("V55-13h web: the Timeline tab draws the withheld detail (events and invoices) with no amount, the Revenue chip reads '—'", () => {
    render(
      <TimelineTabPanel
        contact={WITHHELD_DETAIL.contact as unknown as ContactDetailData}
        events={WITHHELD_DETAIL.events as ContactDetail["events"]}
        notes={WITHHELD_DETAIL.notes}
        invoices={WITHHELD_DETAIL.invoices}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand timeline" }));
    expect(screen.getByText("Call logged")).toBeInTheDocument();
    const revenue = screen.getByText("Revenue").parentElement?.parentElement?.textContent ?? "";
    expect(revenue).toContain("—");
    expect(document.body.textContent ?? "").not.toMatch(MONEY_TEXT);
  });

  it("V55-13f web: the Timeline tab draws the withheld cross-journey and the withheld dossier (timeline, summary, insight, health) with no amount", () => {
    render(
      <TimelineTabPanel
        contact={WITHHELD_DOSSIER.contact as unknown as ContactDetailData}
        events={WITHHELD_DETAIL.events as ContactDetail["events"]}
        crossJourney={{ timeline: WITHHELD_DOSSIER.timeline, summary: WITHHELD_DOSSIER.summary }}
        aiInsight={WITHHELD_DOSSIER.insight}
        healthMetrics={WITHHELD_DOSSIER.health}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand timeline" }));
    expect(screen.getByText("Call logged")).toBeInTheDocument();
    expect(screen.getByText(WITHHELD_DOSSIER.insight.summary)).toBeInTheDocument();
    const revenue = screen.getByText("Revenue").parentElement?.parentElement?.textContent ?? "";
    expect(revenue).toContain("—");
    expect(document.body.textContent ?? "").not.toMatch(MONEY_TEXT);
  });

  it("control: the same panel prints the amounts an owner's cross-journey carries (the money rows and summary.totalRevenue)", () => {
    render(
      <TimelineTabPanel
        contact={WITHHELD_DETAIL.contact as unknown as ContactDetailData}
        events={[]}
        crossJourney={{
          timeline: [
            ...WITHHELD_JOURNEY.timeline,
            { id: "ev_paid", module: "commerce", type: "invoice.paid", title: "Payment received", description: "TTD 5,321.87", timestamp: at(45), value: 5321.87, currency: "TTD", entityId: "inv_p", ctaLabel: "View Invoice", ctaModule: "commerce" },
          ],
          summary: { ...WITHHELD_JOURNEY.summary, totalRevenue: 5321.87 },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand timeline" }));
    expect(document.body.textContent ?? "").toMatch(MONEY_TEXT);
    expect(screen.getByText("Revenue").parentElement?.parentElement?.textContent ?? "").not.toContain("—");
  });
});
