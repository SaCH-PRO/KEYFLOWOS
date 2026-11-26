/**
 * FU-CONTACT-TIMELINE-CHANNELS (owner ruling D-277; journey C): the conversation thread moves into the customer's
 * Timeline, which gains a channel filter (WhatsApp, email, SMS, calls, notes). That is where
 * WEDGE-WA-INBOUND-CAPTURE's pasted WhatsApp messages land: POST /crm/businesses/:b/whatsapp/inbound-capture saves
 * the message as a plain-text ContactNote (source whatsapp_inbound), whose note.created event carries only
 * { noteId }, and logs a communication.whatsapp ContactEvent (source whatsapp_inbound) carrying
 * { channel: 'whatsapp', direction: 'inbound', source: 'pasted_whatsapp', body, senderPhone, noteId }
 * (crm.service.ts captureInboundWhatsApp, crm-timeline.service.ts addNote). The Timeline reads
 * GET /crm/businesses/:b/contacts/:c/events, which already withholds money-bearing events from a member without
 * revenue read (listContactEvents, D-100 / D-90 / D-63); the filter works only on what that read served.
 *
 *   TCH-01  RED      the Timeline offers a channel filter: All, WhatsApp, Email, SMS, Calls, Notes; All is on
 *   TCH-02  RED      a pasted WhatsApp message shows under WhatsApp and under All, with its text, as one item (its
 *                    stored note's "Note added" event is the same message, not a second row)
 *   TCH-03  RED      each channel shows exactly its own events (call, email, SMS, notes; an SMS campaign is SMS)
 *   TCH-04  RED      each filter states how many items it holds; a money event, a task and a meeting are in All only
 *   TCH-05  RED      member scope: counts are of what the read served (a withheld money event is in no count),
 *                    and the header's total is the served items
 *   TCH-06  control  the page reads the events read only (no notes, conversations or story read beside it)
 *   TCH-06b RED      choosing a channel reads nothing more: it filters what the events read served
 *   TCH-07  control  a message is plain text: markup in a pasted message is shown as typed, never as elements
 *   TCH-08  RED      a channel with nothing says so in that channel's words, not "No timeline events yet"
 *   TCH-09  RED      channel events read in plain words ("WhatsApp message received", "Call logged", "SMS sent"),
 *                    never "Communication whatsapp" or "Sms sent"
 *   TCH-10  RED      a pasted message's note whose WhatsApp event is not in the page is WhatsApp, not a note
 *   TCH-11  RED      a stored code in any case reads its channel (Note.Created is a note, Communication.Call a call)
 *   TCH-12  pin      a copied message and a campaign read their data.channel, else WhatsApp and email (mutation pin)
 *   TCH-13  pin      only a pasted message's own note (source whatsapp_inbound) folds into it (mutation pin)
 *
 * Review round 1 (correctness review of 63af799e):
 *   TCH-14  RED      COR-TCH-1: the events read serves at most 20 (listContactEvents' default; the page sends no
 *                    limit). A full read says so ("Only the latest 20 timeline records were loaded"), and its counts,
 *                    header ("10 items from the latest 20 records": N-1, round 2) and empty texts ("No calls in the
 *                    latest 20 records.") speak of those, never of the whole history ("No calls yet.")
 *   TCH-15  control  COR-TCH-1: a read of 19 is the whole history: today's wording, no "latest" line, plain counts
 *   TCH-16  RED      MIN-1: an inbound message the omnichannel processor logs (type message_received, source the
 *                    channel: omnichannel-processor.service.ts) is that channel's, "Email received" / "SMS received";
 *                    a source of no channel of the filter's is in All only
 *   TCH-17  RED      MIN-3: a pasted message's note edited or deleted (note.updated / note.deleted { noteId }, source
 *                    system: crm-timeline.service.ts updateNote / deleteNote) is WhatsApp, when the page shows that the
 *                    note is a pasted one (its communication.whatsapp or its whatsapp_inbound note.created); an
 *                    ordinary note's edit stays a note
 *   TCH-18  RED      MIN-4: a failed events read is not an empty history: an error line with Retry, no filter
 *                    counts, never "No timeline events yet"; Retry reads again and shows the timeline
 *   TCH-19  pin      MIN-2: a logged message with direction "in" reads "... received"
 *   TCH-20  pin      MIN-2: outcome "received" reads "Call received", "Email received", "SMS received"
 *   TCH-21  pin      MIN-2: a long message is shown whole (whitespace-pre-wrap, no line clamp); other details clamp
 *
 * Review round 2 (confirmations of fc7295dc):
 *   TCH-18b RED      MIN-4: a failure with an empty error (a proxy 502 with an HTML body and no status text, as
 *                    over HTTP/2: apiGet answers error "") is a failure too (failure-kit FK-SEC-1), never an empty
 *                    history
 *   TCH-18c pin      MIN-4: a ModuleScopeGuard refusal is said as no access, without Retry (trying again cannot fix it)
 *   TCH-22  RED      SEC-TCH-C1 / N-3: only a communication.whatsapp event captureInboundWhatsApp wrote (source
 *                    whatsapp_inbound) says which note is a pasted message. One any crm writer logs (source crm)
 *                    naming an ordinary note's id moves neither that note's edits under WhatsApp nor folds a note
 *   TCH-17b pin      N-2: at the cap boundary, the WhatsApp event (source whatsapp_inbound, with its noteId) and a
 *                    later edit of that note are on the page but its note.created is not: the edit is WhatsApp
 *
 * FU-TIMELINE-LOAD-OLDER (D-284): the events read pages (FU-TIMELINE-EVENTS-PAGING). The fetch stub answers it as the
 * server does (events-read-stub.ts: the default call the newest 20 as an array; a paged call { events, nextCursor,
 * hasMore }), and TCH-14 now has a 21st, older record behind its first page: a first page of 20 with nothing behind it
 * is the whole history. The line it pins no longer says "Only the latest 20 ... were loaded" (older ones can now be
 * loaded: timeline-load-older.test.tsx, TLO-01..). TCH-14's counts, header and empty texts are unchanged.
 *
 * The page renders for real on the real client; only fetch and the Next router hooks are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

const params = vi.hoisted(() => ({ contactId: "c_tch" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/app/crm/contacts/${params.contactId}/timeline`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import ContactTimelinePage from "../timeline/page";
import { serveEventsRead, type StubEvent } from "./events-read-stub";

const BIZ = "biz_tch";
const C = params.contactId;
const base = Date.now() - 60 * 60 * 1000;
/** Newest last in this list; the page sorts newest first. Each event is a minute apart. */
const at = (i: number) => new Date(base + i * 60_000).toISOString();

const PASTED_TEXT = "Hi, can I book Saturday at 10?";
/** A pasted WhatsApp message as captureInboundWhatsApp writes it: the note's event, then the WhatsApp event. */
const PASTED = [
  { id: "ev_wa_note", contactId: C, type: "note.created", source: "whatsapp_inbound", actorType: "USER", createdAt: at(10), data: { noteId: "n_wa" } },
  {
    id: "ev_wa",
    contactId: C,
    type: "communication.whatsapp",
    source: "whatsapp_inbound",
    actorType: "USER",
    createdAt: at(11),
    data: { channel: "whatsapp", direction: "inbound", source: "pasted_whatsapp", body: PASTED_TEXT, senderPhone: "+18685550101", noteId: "n_wa" },
  },
];
const NOTE = { id: "ev_note", contactId: C, type: "note.created", source: "crm", actorType: "USER", createdAt: at(1), data: { noteId: "n_1" } };
const CALL = {
  id: "ev_call", contactId: C, type: "communication.call", source: "crm", actorType: "USER", createdAt: at(2),
  data: { channelType: "call", outcome: "answered", duration: 5, notes: "Talked through the quote" },
};
const EMAIL_LOGGED = {
  id: "ev_email", contactId: C, type: "communication.email", source: "crm", actorType: "USER", createdAt: at(3),
  data: { channelType: "email", outcome: "sent", notes: "Sent the price list" },
};
const EMAIL_SENT = { id: "ev_email_sent", contactId: C, type: "email.sent", source: "crm", createdAt: at(4), data: { subject: "Your quote is ready" } };
const SMS_SENT = { id: "ev_sms", contactId: C, type: "sms.sent", source: "crm", createdAt: at(5), data: { body: "Reminder: Saturday 10am" } };
const SMS_CAMPAIGN = { id: "ev_sms_campaign", contactId: C, type: "campaign.sent", source: "campaign", createdAt: at(6), data: { channel: "sms", title: "Weekend offer" } };
const PAYMENT = { id: "ev_pay", contactId: C, type: "payment.received", source: "revenue", createdAt: at(7), data: { amount: 4200, title: "Deposit paid" } };
const TASK = { id: "ev_task", contactId: C, type: "task.created", source: "crm", createdAt: at(8), data: { title: "Call back Monday" } };
const MEETING = { id: "ev_meet", contactId: C, type: "communication.meeting", source: "crm", createdAt: at(9), data: { channelType: "meeting", outcome: "completed", notes: "Site visit" } };

const EVERYTHING = [NOTE, CALL, EMAIL_LOGGED, EMAIL_SENT, SMS_SENT, SMS_CAMPAIGN, PAYMENT, TASK, MEETING, ...PASTED];

let served: unknown[] = EVERYTHING;
let fetchMock: ReturnType<typeof vi.fn>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  served = EVERYTHING;
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if (pathname.endsWith(`/crm/businesses/${BIZ}/contacts/${C}/events`)) return serveEventsRead(url, served as StubEvent[]);
    return json(404, { message: "Not stubbed" });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The filter group and its buttons, by their visible names. */
function filterGroup() {
  return screen.getByRole("group", { name: /filter by channel/i });
}
function filterButton(label: string) {
  return within(filterGroup()).getByRole("button", { name: new RegExp(`^${label}\\b`) });
}
async function renderTimeline() {
  render(<ContactTimelinePage />);
  await screen.findByRole("heading", { name: "Timeline" });
  // Loaded: the "Loading timeline..." line is gone.
  await vi.waitFor(() => expect(screen.queryByText(/loading timeline/i)).not.toBeInTheDocument());
}
function choose(label: string) {
  fireEvent.click(filterButton(label));
}
/** The count a filter button states, as "(n)" (or "(n+)" when the read came back full: COR-TCH-1). */
function countOf(label: string): number {
  const m = filterButton(label).textContent?.match(/\((\d+)\+?\)/);
  if (!m) throw new Error(`filter ${label} states no count: "${filterButton(label).textContent}"`);
  return Number(m[1]);
}

describe("D-277: the Timeline has a channel filter", () => {
  it("TCH-01 RED: All, WhatsApp, Email, SMS, Calls and Notes; All is on by default", async () => {
    await renderTimeline();
    const names = within(filterGroup())
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").replace(/\s*\(\d+\)\s*$/, "").trim());
    expect(names).toEqual(["All", "WhatsApp", "Email", "SMS", "Calls", "Notes"]);
    expect(filterButton("All")).toHaveAttribute("aria-pressed", "true");
    for (const other of ["WhatsApp", "Email", "SMS", "Calls", "Notes"]) {
      expect(filterButton(other)).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("TCH-02 RED: a pasted WhatsApp message shows under WhatsApp and under All, once, with its text", async () => {
    served = [NOTE, ...PASTED];
    await renderTimeline();
    // All: the message, once; and the ordinary note.
    expect(screen.getAllByText(PASTED_TEXT)).toHaveLength(1);
    expect(screen.getAllByText("Note added")).toHaveLength(1);
    expect(screen.getByText(/2 events/)).toBeInTheDocument();

    choose("WhatsApp");
    expect(filterButton("WhatsApp")).toHaveAttribute("aria-pressed", "true");
    expect(filterButton("All")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByText(PASTED_TEXT)).toHaveLength(1);
    expect(screen.queryByText("Note added")).not.toBeInTheDocument();

    choose("Notes");
    expect(screen.queryByText(PASTED_TEXT)).not.toBeInTheDocument();
    expect(screen.getAllByText("Note added")).toHaveLength(1);

    choose("All");
    expect(screen.getAllByText(PASTED_TEXT)).toHaveLength(1);
  });

  it("TCH-03 RED: each channel shows exactly its own events", async () => {
    await renderTimeline();
    const texts: Record<string, string> = {
      whatsapp: PASTED_TEXT,
      call: "Talked through the quote",
      emailLogged: "Sent the price list",
      emailSent: "Your quote is ready",
      sms: "Reminder: Saturday 10am",
      smsCampaign: "Weekend offer",
      payment: "Deposit paid",
      task: "Call back Monday",
      meeting: "Site visit",
    };
    const expected: Record<string, string[]> = {
      WhatsApp: ["whatsapp"],
      Email: ["emailLogged", "emailSent"],
      SMS: ["sms", "smsCampaign"],
      Calls: ["call"],
      Notes: [],
    };
    for (const [filter, shown] of Object.entries(expected)) {
      choose(filter);
      for (const [key, text] of Object.entries(texts)) {
        if (shown.includes(key)) expect(screen.getByText(text), `${filter} shows ${key}`).toBeInTheDocument();
        else expect(screen.queryByText(text), `${filter} hides ${key}`).not.toBeInTheDocument();
      }
      expect(screen.queryAllByText("Note added"), `${filter}: the ordinary note`).toHaveLength(filter === "Notes" ? 1 : 0);
    }
    choose("All");
    for (const text of Object.values(texts)) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getAllByText("Note added")).toHaveLength(1);
  });

  it("TCH-04 RED: each filter states its count; a money event, a task and a meeting are in All only", async () => {
    await renderTimeline();
    // Ten events read; the pasted message's note folds into its WhatsApp event: ten items.
    expect(countOf("All")).toBe(10);
    expect(countOf("WhatsApp")).toBe(1);
    expect(countOf("Email")).toBe(2);
    expect(countOf("SMS")).toBe(2);
    expect(countOf("Calls")).toBe(1);
    expect(countOf("Notes")).toBe(1);
    expect(screen.getByText(/^10 events$/)).toBeInTheDocument();
    // What the header says matches the filter on.
    choose("Email");
    expect(screen.getByText(/^2 of 10 events$/)).toBeInTheDocument();
  });

  it("TCH-05 RED: member scope: the counts are of what the read served; a withheld money event is in none", async () => {
    // What GET .../events serves a member without revenue read: the payment is withheld by the server.
    served = EVERYTHING.filter((e) => e !== PAYMENT);
    await renderTimeline();
    expect(countOf("All")).toBe(9);
    const channelTotal = ["WhatsApp", "Email", "SMS", "Calls", "Notes"].reduce((n, f) => n + countOf(f), 0);
    expect(channelTotal).toBe(7); // the task and the meeting are in All only
    expect(document.body).not.toHaveTextContent("Deposit paid");
    expect(document.body).not.toHaveTextContent("4200");
    expect(screen.getByText(/^9 events$/)).toBeInTheDocument();
  });

  it("TCH-06 control: the page reads the events read only", async () => {
    await renderTimeline();
    const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://localhost").pathname);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.endsWith(`/contacts/${C}/events`))).toBe(true);
  });

  it("TCH-06b RED: choosing a channel reads nothing more; it filters what the events read served", async () => {
    await renderTimeline();
    const before = fetchMock.mock.calls.length;
    choose("WhatsApp");
    choose("Notes");
    choose("All");
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("TCH-07 control: markup in a pasted message is shown as typed, never as elements", async () => {
    const typed = '<img src=x onerror="alert(1)"><b>bold</b><script>window.__tch=1</script>';
    served = [{ ...PASTED[1], data: { ...PASTED[1].data, body: typed } }];
    await renderTimeline();
    expect(screen.getByText(typed)).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect((window as unknown as { __tch?: number }).__tch).toBeUndefined();
  });

  it("TCH-08 RED: a channel with nothing says so in its own words", async () => {
    served = [NOTE, ...PASTED];
    await renderTimeline();
    choose("SMS");
    expect(screen.getByText("No SMS messages yet.")).toBeInTheDocument();
    expect(screen.queryByText(/no timeline events yet/i)).not.toBeInTheDocument();
    choose("Calls");
    expect(screen.getByText("No calls yet.")).toBeInTheDocument();
    choose("Email");
    expect(screen.getByText("No emails yet.")).toBeInTheDocument();
  });

  it("TCH-09 RED: channel events read in plain words", async () => {
    await renderTimeline();
    expect(screen.getByText("WhatsApp message received")).toBeInTheDocument();
    expect(screen.getByText("Call logged")).toBeInTheDocument();
    expect(screen.getByText("Email logged")).toBeInTheDocument();
    expect(screen.getByText("SMS sent")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Communication (whatsapp|call|email|sms|meeting)/i);
    expect(document.body).not.toHaveTextContent("Sms sent");
  });

  it("TCH-10 RED: a pasted message's note whose WhatsApp event is not in the page is WhatsApp, not a note", async () => {
    served = [NOTE, PASTED[0]];
    await renderTimeline();
    expect(countOf("WhatsApp")).toBe(1);
    expect(countOf("Notes")).toBe(1);
    choose("Notes");
    expect(screen.getAllByText("Note added")).toHaveLength(1);
  });

  it("TCH-11 RED: a stored code in any case reads its channel", async () => {
    served = [
      { id: "ev_legacy_note", contactId: C, type: "Note.Created", createdAt: at(1), data: { body: "Prefers mornings" } },
      { id: "ev_legacy_call", contactId: C, type: "Communication.Call", createdAt: at(2), data: { notes: "Left a voicemail" } },
    ];
    await renderTimeline();
    choose("Notes");
    expect(screen.getByText("Prefers mornings")).toBeInTheDocument();
    expect(screen.queryByText("Left a voicemail")).not.toBeInTheDocument();
    choose("Calls");
    expect(screen.getByText("Left a voicemail")).toBeInTheDocument();
    expect(screen.queryByText("Prefers mornings")).not.toBeInTheDocument();
  });

  it("TCH-12 pin: a copied message and a campaign read their data.channel, else WhatsApp and email", async () => {
    served = [
      { id: "ev_copy", contactId: C, type: "message.copied", createdAt: at(1), data: { body: "Copied for WhatsApp" } },
      { id: "ev_copy_sms", contactId: C, type: "message.copied", createdAt: at(2), data: { channel: "SMS", body: "Copied for SMS" } },
      { id: "ev_open", contactId: C, type: "campaign.opened", createdAt: at(3), data: { title: "Spring news" } },
    ];
    await renderTimeline();
    expect([countOf("WhatsApp"), countOf("SMS"), countOf("Email")]).toEqual([1, 1, 1]);
    choose("WhatsApp");
    expect(screen.getByText("Copied for WhatsApp")).toBeInTheDocument();
    choose("SMS");
    expect(screen.getByText("Copied for SMS")).toBeInTheDocument();
    choose("Email");
    expect(screen.getByText("Spring news")).toBeInTheDocument();
  });

  it("TCH-13 pin: only a pasted message's own note folds; an ordinary note a WhatsApp event names stays a note", async () => {
    served = [
      { ...NOTE, data: { noteId: "n_shared" } },
      { ...PASTED[1], data: { ...PASTED[1].data, noteId: "n_shared" } },
    ];
    await renderTimeline();
    expect(countOf("All")).toBe(2);
    expect(countOf("Notes")).toBe(1);
    expect(countOf("WhatsApp")).toBe(1);
  });

  it("TCH-14 RED: a first page with older records behind it says it shows the latest 20, and its counts and empty texts say so too", async () => {
    // Ten pasted messages, as captureInboundWhatsApp writes them: twenty events, ten items. An older call is on the
    // next page (FU-TIMELINE-LOAD-OLDER: the read pages, and the call is listed only once older records are loaded).
    served = [
      { ...CALL, createdAt: at(-5) },
      ...Array.from({ length: 10 }, (_, i) => [
        { ...PASTED[0], id: `ev_wa_note_${i}`, createdAt: at(2 * i), data: { noteId: `n_wa_${i}` } },
        { ...PASTED[1], id: `ev_wa_${i}`, createdAt: at(2 * i + 1), data: { ...PASTED[1].data, body: `Message ${i}`, noteId: `n_wa_${i}` } },
      ]).flat(),
    ];
    expect(served).toHaveLength(21);
    await renderTimeline();
    // N-1 (review round 2): the line speaks of the records loaded, the header of the items those make (a pasted
    // message is two records, one item), and each says which, so they never read as two different counts.
    // D-284: the line no longer says "Only the latest 20 ... were loaded": the older ones can be loaded.
    expect(screen.getByText("The latest 20 timeline records are loaded; older ones are not listed or counted until you load them.")).toBeInTheDocument();
    expect(screen.queryByText(/^Only the latest 20 timeline records were loaded/)).not.toBeInTheDocument();
    expect(screen.getByText(/^10 items from the latest 20 records$/)).toBeInTheDocument();
    expect(screen.queryByText(/^(Latest )?10 events$/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/latest 20 events/i);
    expect(filterButton("WhatsApp")).toHaveTextContent("(10+)");
    expect(filterButton("Calls")).toHaveTextContent("(0+)");
    choose("Calls");
    expect(screen.getByText("No calls in the latest 20 records.")).toBeInTheDocument();
    expect(screen.queryByText("No calls yet.")).not.toBeInTheDocument();
    expect(screen.getByText(/^0 of 10 items from the latest 20 records$/)).toBeInTheDocument();
    choose("Notes");
    expect(screen.getByText("No notes in the latest 20 records.")).toBeInTheDocument();
  });

  it("TCH-15 control: a read of 19 events is the whole history: today's wording", async () => {
    served = Array.from({ length: 19 }, (_, i) => ({ ...PASTED[1], id: `ev_wa_${i}`, createdAt: at(i), data: { ...PASTED[1].data, body: `Message ${i}`, noteId: `n_${i}` } }));
    await renderTimeline();
    expect(screen.queryByText(/latest 20/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^19 events$/)).toBeInTheDocument();
    expect(filterButton("WhatsApp")).toHaveTextContent("(19)");
    expect(filterButton("WhatsApp")).not.toHaveTextContent("+");
    choose("Calls");
    expect(screen.getByText("No calls yet.")).toBeInTheDocument();
  });

  it("TCH-16 RED: message_received is its source's channel, in plain words; another source is in All only", async () => {
    served = [
      { id: "ev_in_email", contactId: C, type: "message_received", source: "email", createdAt: at(1), data: { intentType: "question", confidence: 0.9 } },
      { id: "ev_in_sms", contactId: C, type: "message_received", source: "SMS", createdAt: at(2), data: { intentType: "booking" } },
      { id: "ev_in_wa", contactId: C, type: "message_received", source: "whatsapp", createdAt: at(3), data: {} },
      { id: "ev_in_form", contactId: C, type: "message_received", source: "form", createdAt: at(4), data: {} },
    ];
    await renderTimeline();
    expect([countOf("All"), countOf("Email"), countOf("SMS"), countOf("WhatsApp"), countOf("Calls"), countOf("Notes")]).toEqual([4, 1, 1, 1, 0, 0]);
    expect(screen.getByText("Email received")).toBeInTheDocument();
    expect(screen.getByText("SMS received")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp message received")).toBeInTheDocument();
    choose("Email");
    expect(screen.getByText("Email received")).toBeInTheDocument();
    expect(screen.queryByText("SMS received")).not.toBeInTheDocument();
    choose("SMS");
    expect(screen.getByText("SMS received")).toBeInTheDocument();
    expect(screen.queryByText("Email received")).not.toBeInTheDocument();
  });

  it("TCH-17 RED: a pasted message's note edited or deleted is WhatsApp; an ordinary note's edit stays a note", async () => {
    served = [
      ...PASTED,
      { id: "ev_wa_upd", contactId: C, type: "note.updated", source: "system", createdAt: at(12), data: { noteId: "n_wa" } },
      { id: "ev_wa_del", contactId: C, type: "note.deleted", source: "system", createdAt: at(13), data: { noteId: "n_wa", body: PASTED_TEXT } },
      NOTE,
      { id: "ev_note_upd", contactId: C, type: "note.updated", source: "system", createdAt: at(2), data: { noteId: "n_1" } },
    ];
    await renderTimeline();
    expect([countOf("All"), countOf("WhatsApp"), countOf("Notes")]).toEqual([5, 3, 2]);
    choose("Notes");
    expect(screen.queryByText("Note deleted")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Note (added|updated)$/)).toHaveLength(2);
    choose("WhatsApp");
    expect(screen.getByText("Note deleted")).toBeInTheDocument();
    expect(screen.getByText("Note updated")).toBeInTheDocument();
    cleanup();

    // Known from its whatsapp_inbound note.created alone (its WhatsApp event not on the page).
    served = [PASTED[0], { id: "ev_wa_upd", contactId: C, type: "note.updated", source: "system", createdAt: at(12), data: { noteId: "n_wa" } }];
    await renderTimeline();
    expect([countOf("WhatsApp"), countOf("Notes")]).toEqual([2, 0]);
  });

  it("TCH-18 RED: a failed read says so with Retry, shows no counts and no empty history; Retry reads again", async () => {
    let failing = true;
    const reads = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      if (!pathname.endsWith(`/contacts/${C}/events`)) return json(404, { message: "Not stubbed" });
      return failing ? json(503, { message: "Service unavailable" }) : serveEventsRead(url, [NOTE, ...PASTED]);
    });
    vi.stubGlobal("fetch", reads);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderTimeline();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/(could not|couldn['’]t) load the timeline/i);
    expect(screen.queryByText(/no timeline events yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 events$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /filter by channel/i })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("(0)");

    failing = false;
    const before = reads.mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(await screen.findByText(PASTED_TEXT)).toBeInTheDocument();
    expect(reads.mock.calls.length).toBe(before + 1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(countOf("All")).toBe(2);
  });

  it("TCH-19 pin: a logged message with direction 'in' reads as received", async () => {
    served = [
      { id: "ev_in", contactId: C, type: "communication.whatsapp", createdAt: at(1), data: { direction: "in", body: "Are you open Sunday?" } },
      { id: "ev_out", contactId: C, type: "communication.whatsapp", createdAt: at(2), data: { direction: "out", body: "Yes, from 9" } },
    ];
    await renderTimeline();
    expect(screen.getAllByText("WhatsApp message received")).toHaveLength(1);
    expect(screen.getAllByText("WhatsApp logged")).toHaveLength(1);
  });

  it("TCH-20 pin: outcome 'received' reads 'Call received', 'Email received', 'SMS received'", async () => {
    served = (["call", "email", "sms"] as const).map((ch, i) => ({
      id: `ev_rcv_${ch}`, contactId: C, type: `communication.${ch}`, source: "crm", createdAt: at(i), data: { channelType: ch, outcome: "received" },
    }));
    await renderTimeline();
    for (const title of ["Call received", "Email received", "SMS received"]) expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByText(/ logged$/)).not.toBeInTheDocument();
  });

  it("TCH-21 pin: a long message is shown whole; another event's detail is clamped", async () => {
    const long = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a long WhatsApp message about the order.`).join("\n");
    served = [{ ...PASTED[1], data: { ...PASTED[1].data, body: long } }, TASK];
    await renderTimeline();
    const message = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === long);
    expect(message).toHaveClass("whitespace-pre-wrap");
    expect(message).not.toHaveClass("line-clamp-2");
    expect(screen.getByText("Call back Monday")).toHaveClass("line-clamp-2");
  });

  it("TCH-18b RED: a 502 with an HTML body and no status text is a failure with Retry, not an empty history", async () => {
    let failing = true;
    const reads = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      if (!pathname.endsWith(`/contacts/${C}/events`)) return json(404, { message: "Not stubbed" });
      if (failing) return new Response("<html><body>Bad gateway</body></html>", { status: 502, statusText: "", headers: { "content-type": "text/html" } });
      return serveEventsRead(url, [NOTE, ...PASTED]);
    });
    vi.stubGlobal("fetch", reads);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderTimeline();
    expect(screen.queryByText(/no timeline events yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 events$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /filter by channel/i })).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/(could not|couldn['’]t) load the timeline/i);
    failing = false;
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(await screen.findByText(PASTED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("TCH-18c pin: a module scope refusal says no access, without Retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { message: "Insufficient permissions: crm requires read access (you have none)" })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderTimeline();
    const alert = screen.getByRole("alert");
    expect(alert.textContent?.trim()).toBeTruthy();
    expect(within(alert).queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /filter by channel/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/no timeline events yet/i)).not.toBeInTheDocument();
  });

  it("TCH-22 RED: a WhatsApp event not from the capture (source crm) names no pasted note", async () => {
    const forged = { ...PASTED[1], id: "ev_forged", source: "crm", createdAt: at(3), data: { channel: "whatsapp", body: "Logged by a member", noteId: "n_1" } };
    served = [NOTE, forged, { id: "ev_note_upd", contactId: C, type: "note.updated", source: "system", createdAt: at(4), data: { noteId: "n_1" } }];
    await renderTimeline();
    // The ordinary note and its edit stay Notes; the forged event itself is a WhatsApp item.
    expect([countOf("All"), countOf("WhatsApp"), countOf("Notes")]).toEqual([3, 1, 2]);
    cleanup();

    // Nor does it fold a pasted note's row away (its own WhatsApp event is not on the page).
    served = [PASTED[0], { ...forged, data: { ...forged.data, noteId: "n_wa" } }];
    await renderTimeline();
    expect(countOf("All")).toBe(2);
  });

  it("TCH-17b pin: the WhatsApp event and a later edit on the page, the note.created off it: the edit is WhatsApp", async () => {
    served = [PASTED[1], { id: "ev_wa_upd", contactId: C, type: "note.updated", source: "system", createdAt: at(12), data: { noteId: "n_wa" } }];
    await renderTimeline();
    expect([countOf("All"), countOf("WhatsApp"), countOf("Notes")]).toEqual([2, 2, 0]);
  });
});
