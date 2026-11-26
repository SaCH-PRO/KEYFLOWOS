/**
 * SWP-CONTACT-DETAIL (BUG-127, BUG-128, BUG-129, BUG-062; journey C): the contact screens say what the owner sees,
 * not what the database stores, and the list's side panel is a summary that opens the one contact page.
 *
 *   CDS-127a  RED-BEFORE  a SELECT custom field shows its option's label, not the stored value
 *   CDS-127b  RED-BEFORE  a MULTI_SELECT custom field shows its options' labels
 *   CDS-127c  control     a stored value no option names (an option since removed) shows as stored
 *   CDS-128a  RED-BEFORE  the side panel's Delete dialog says the client moves to Trash (with Undo), not "cannot be
 *                         undone": a contact delete is a soft delete (crm.service.ts deleteContact / bulkDelete set
 *                         deletedAt; the Trash page restores it)
 *   CDS-128b  control     the side panel's Forget dialog still says the data is erased for good, and never mentions
 *                         Trash (the panel's one dialog served Delete and Forget alike: a fixed Trash message would
 *                         promise a restore a GDPR forget does not give)
 *   CDS-128c  RED-BEFORE  (source guard) the bulk delete dialogs (bulk-action-bar, database-bulk-bar, contacts-database,
 *                         and the contacts page's dialog that confirms the bulk delete) say Trash, not "cannot be undone"
 *   CDS-129a  RED-BEFORE  the side panel's Recent Activity shows "Note added" for a Note.Created event (eventLabel,
 *                         lib/status-labels.ts), not the code
 *   CDS-129b  RED-BEFORE  the contact's Timeline page shows "Note added", not "Note.Created"
 *   CDS-129c  RED-BEFORE  (reviews CDC-3, m2) Recent Activity reads a code its old word list lacks in plain words
 *                         ("Payment.Received" -> "Payment received"), as the Timeline page does
 *   CDS-129d  RED-BEFORE  (review CDC-4) the Timeline page shows an event's status and actor in plain words, not the
 *                         stored PARTIALLY_PAID or SYSTEM ("Part-paid", "System"; review round m-a)
 *   CDS-129e  RED-AT-6071b088  (review round m-b) the event words keep the brand's and the plain spelling: "WhatsApp
 *                         sent" and "Follow-up scheduled", in Recent Activity as on the Timeline page (eventLabel)
 *   CDS-129f  pin         (confirmation m-a) Recent Activity says what the Timeline page says: contact.created is
 *                         "Customer added" in both (the card's own word list, which said "Contact created", is gone)
 *   CDS-129g  RED-AT-3191d4f1  (confirmation m-b) the Timeline page names the AI actor "AI", not "Ai"
 *   CDS-062a  RED-BEFORE  the side panel has no tab strip; it opens the contact's page ("Open") and keeps Edit
 *   CDS-062b  RED-BEFORE  Recent Activity's "View all" opens the contact's Timeline page (no tab to switch to)
 *
 * Components render for real on the real client; only fetch, the Next router hooks, toasts and the email composer
 * are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const params = vi.hoisted(() => ({ contactId: "c_sweep" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/crm/contacts",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));
vi.mock("@/components/email/compose-context", () => ({
  useCompose: () => ({ open: vi.fn(), close: vi.fn(), isOpen: false }),
}));

import { ContactCustomFields } from "../contact-custom-fields";
import { ContactDetail, type ContactDetailData } from "../contact-detail";
import { ContactDetailStats } from "../contact-detail-stats";
import ContactTimelinePage from "@/app/app/crm/contacts/[contactId]/timeline/page";
import { eventLabel } from "@/lib/status-labels";

const BIZ = "biz_sweep";
const CONTACT_ID = params.contactId;

/** A dropdown and a multi-select, as the settings page stores them: options { options: [{ label, value }] }. */
const DEFINITIONS = [
  {
    id: "cfd_tier", businessId: BIZ, name: "tier", label: "Membership tier", type: "SELECT", description: null,
    placeholder: null, options: { options: [{ label: "Gold member", value: "gold" }, { label: "Silver member", value: "silver" }] },
    defaultValue: null, required: false, order: 1, archivedAt: null,
    createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "cfd_likes", businessId: BIZ, name: "likes", label: "Likes", type: "MULTI_SELECT", description: null,
    placeholder: null, options: { options: [{ label: "Sourdough", value: "sd" }, { label: "Croissants", value: "cr" }] },
    defaultValue: null, required: false, order: 2, archivedAt: null,
    createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z",
  },
];

const NOW = new Date().toISOString();
const EVENTS = [{ id: "ev_1", contactId: CONTACT_ID, type: "Note.Created", createdAt: NOW, data: { body: "Prefers mornings" } }];
/** What the stubbed events read answers (CDS-129d swaps in an invoice event). */
let served: unknown[] = EVENTS;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  served = EVENTS;
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      if (pathname.endsWith(`/crm/businesses/${BIZ}/custom-field-definitions`)) return json(200, DEFINITIONS);
      if (pathname.endsWith(`/contacts/${CONTACT_ID}/events`)) {
        // As the server answers since FU-TIMELINE-EVENTS-PAGING (D-284): a paged read (the Timeline page's, since
        // FU-TIMELINE-LOAD-OLDER) gets { events, nextCursor, hasMore }; the default read the plain array.
        const q = new URL(url, "http://localhost").searchParams;
        const paged = q.has("paged") || q.has("limit") || q.has("cursor");
        return json(200, paged ? { events: served, nextCursor: null, hasMore: false } : served);
      }
      return json(404, { message: "Not stubbed" });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const contact = {
  id: CONTACT_ID,
  firstName: "Jade",
  lastName: "Plain",
  email: "jade@example.test",
  status: "LEAD",
  tags: [],
} as unknown as ContactDetailData;

function renderPanel(extra: Partial<Parameters<typeof ContactDetail>[0]> = {}) {
  return render(
    <ContactDetail contact={contact} events={EVENTS} businessId={BIZ} onEdit={vi.fn()} onDelete={vi.fn()} {...extra} />,
  );
}

describe("BUG-127: a dropdown custom field shows its label", () => {
  it("CDS-127a RED-BEFORE: a SELECT field shows the chosen option's label", async () => {
    render(<ContactCustomFields businessId={BIZ} values={{ tier: "gold" }} readOnly />);
    expect(await screen.findByText("Gold member")).toBeInTheDocument();
    expect(screen.queryByText("gold")).not.toBeInTheDocument();
  });

  it("CDS-127b RED-BEFORE: a MULTI_SELECT field shows the chosen options' labels", async () => {
    render(<ContactCustomFields businessId={BIZ} values={{ likes: ["sd", "cr"] }} readOnly />);
    expect(await screen.findByText("Sourdough, Croissants")).toBeInTheDocument();
    expect(screen.queryByText("sd, cr")).not.toBeInTheDocument();
  });

  it("CDS-127c control: a value no option names shows as stored", async () => {
    render(<ContactCustomFields businessId={BIZ} values={{ tier: "bronze" }} readOnly />);
    expect(await screen.findByText("bronze")).toBeInTheDocument();
  });
});

describe("BUG-128: a delete dialog says the contact goes to Trash", () => {
  it("CDS-128a RED-BEFORE: the side panel's Delete dialog says Trash and Undo, not 'cannot be undone'", async () => {
    renderPanel();
    fireEvent.click(screen.getByTitle("Delete client"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/trash/i);
    expect(dialog).toHaveTextContent(/undo/i);
    expect(dialog).not.toHaveTextContent(/cannot be undone/i);
  });

  it("CDS-128b control: the side panel's Forget dialog still says the data is erased for good, and never Trash", async () => {
    renderPanel();
    fireEvent.click(screen.getByTitle("Forget contact (GDPR right-to-be-forgotten)"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/cannot be undone|for good|permanently/i);
    expect(dialog).not.toHaveTextContent(/trash/i);
  });

  it("CDS-128c RED-BEFORE (source guard): the bulk contact delete dialogs say Trash, not 'cannot be undone'", () => {
    const root = path.resolve(__dirname, "../../..");
    const dialogs: Array<[string, RegExp]> = [
      // Each file's contact delete dialog: the text between its title and its confirm control.
      ["app/app/crm/pipeline/bulk-action-bar.tsx", /id="bulk-delete-desc">([\s\S]*?)<\/p>/],
      ["app/app/crm/pipeline/database-bulk-bar.tsx", /id="db-bulk-delete-desc">([\s\S]*?)<\/p>/],
      ["app/app/crm/pipeline/contacts-database.tsx", /title="Delete Contacts"[\s\S]*?message=\{?([^\n]*)/],
      ["app/app/crm/contacts/page.tsx", /title="Delete Contact[s]?"[\s\S]*?message=\{?([^\n]*)/],
    ];
    const wrong: string[] = [];
    for (const [file, pattern] of dialogs) {
      const text = fs.readFileSync(path.join(root, file), "utf8").match(pattern)?.[1] ?? "";
      if (!text) wrong.push(`${file}: dialog text not found`);
      else if (/cannot be undone/i.test(text) || !/trash/i.test(text)) wrong.push(`${file}: ${text.trim().slice(0, 120)}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("BUG-129: events read in plain words", () => {
  it("CDS-129a RED-BEFORE: Recent Activity shows 'Note added' for a Note.Created event", () => {
    render(<ContactDetailStats contact={contact} events={EVENTS} businessId={BIZ} />);
    // Folded, the card's preview names the latest event; opened, its rows name each one.
    const header = screen.getByRole("button", { name: /recent activity/i });
    expect(header).toHaveTextContent(/Note added/);
    fireEvent.click(header);
    expect(screen.getAllByText(/Note added/).length).toBeGreaterThanOrEqual(1);
    expect(document.body).not.toHaveTextContent("Note.Created");
  });

  it("CDS-129b RED-BEFORE: the Timeline page shows 'Note added', not 'Note.Created'", async () => {
    render(<ContactTimelinePage />);
    expect(await screen.findByText("Note added")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Note\.Created/i);
  });
});

describe("BUG-129: every code reads in plain words (reviews)", () => {
  it("CDS-129c RED-BEFORE: Recent Activity reads a code it has no word for through eventLabel", () => {
    const payment = [{ id: "ev_p", type: "Payment.Received", createdAt: NOW }];
    render(<ContactDetailStats contact={contact} events={payment} businessId={BIZ} />);
    expect(screen.getByRole("button", { name: /recent activity/i })).toHaveTextContent("Payment received");
    expect(document.body).not.toHaveTextContent("Payment.Received");
  });

  it("CDS-129d RED-BEFORE: the Timeline page shows an event's status and actor in plain words", async () => {
    served = [
      { id: "ev_i", contactId: CONTACT_ID, type: "invoice.updated", createdAt: NOW, actorType: "SYSTEM", data: { status: "PARTIALLY_PAID" } },
    ];
    render(<ContactTimelinePage />);
    expect(await screen.findByText("Invoice updated")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("PARTIALLY_PAID");
    expect(document.body).not.toHaveTextContent("SYSTEM");
    expect(screen.getByText("Part-paid")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("CDS-129f pin: Recent Activity says what the Timeline page says (contact.created is 'Customer added')", () => {
    render(<ContactDetailStats contact={contact} events={[{ id: "ev_c", type: "contact.created", createdAt: NOW }]} businessId={BIZ} />);
    expect(screen.getByRole("button", { name: /recent activity/i })).toHaveTextContent("Customer added");
    expect(eventLabel("contact.created")).toBe("Customer added");
  });

  it("CDS-129g RED-AT-3191d4f1: the Timeline page names the AI actor 'AI'", async () => {
    served = [{ id: "ev_a", contactId: CONTACT_ID, type: "note.created", createdAt: NOW, actorType: "AI", data: { body: "Drafted by KEY" } }];
    render(<ContactTimelinePage />);
    expect(await screen.findByText("Note added")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.queryByText("Ai")).not.toBeInTheDocument();
  });

  it("CDS-129e RED-AT-6071b088: WhatsApp and Follow-up keep their spelling", () => {
    expect(eventLabel("whatsapp.sent")).toBe("WhatsApp sent");
    expect(eventLabel("followup.scheduled")).toBe("Follow-up scheduled");
    render(<ContactDetailStats contact={contact} events={[{ id: "ev_w", type: "whatsapp.sent", createdAt: NOW }]} businessId={BIZ} />);
    expect(screen.getByRole("button", { name: /recent activity/i })).toHaveTextContent("WhatsApp sent");
  });
});

describe("BUG-062: the side panel is a summary that opens the contact's page", () => {
  it("CDS-062a RED-BEFORE: no tab strip; an Open link to the contact's page; Edit stays", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTitle("Edit client")).toBeInTheDocument());
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toEqual([]);
    const open = screen.getByRole("link", { name: /^open/i });
    expect(open).toHaveAttribute("href", `/app/crm/contacts/${CONTACT_ID}/overview`);
  });

  it("CDS-062b RED-BEFORE: Recent Activity's 'View all' opens the contact's Timeline page", () => {
    render(<ContactDetailStats contact={contact} events={EVENTS} businessId={BIZ} />);
    fireEvent.click(screen.getByRole("button", { name: /recent activity/i }));
    expect(screen.getByText("View all")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute("href", `/app/crm/contacts/${CONTACT_ID}/timeline`);
  });
});
