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
 *   CDS-062a  RED-BEFORE  the side panel has no tab strip; it opens the contact's page ("Open") and keeps Edit
 *   CDS-062b  RED-BEFORE  Recent Activity's "View all" opens the contact's Timeline page (no tab to switch to)
 *
 * Components render for real on the real client; only fetch, the Next router hooks, toasts and the email composer
 * are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      if (pathname.endsWith(`/crm/businesses/${BIZ}/custom-field-definitions`)) return json(200, DEFINITIONS);
      if (pathname.endsWith(`/contacts/${CONTACT_ID}/events`)) return json(200, EVENTS);
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
    const card = screen.getByText("Recent Activity").closest("div")!.parentElement!;
    expect(within(card).getAllByText(/Note added/).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent("Note.Created");
  });

  it("CDS-129b RED-BEFORE: the Timeline page shows 'Note added', not 'Note.Created'", async () => {
    render(<ContactTimelinePage />);
    expect(await screen.findByText("Note added")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Note\.Created/i);
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
    expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute("href", `/app/crm/contacts/${CONTACT_ID}/timeline`);
  });
});
