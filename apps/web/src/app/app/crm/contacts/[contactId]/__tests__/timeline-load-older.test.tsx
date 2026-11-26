/**
 * FU-TIMELINE-LOAD-OLDER (owner ruling D-284; journey C): the contact Timeline pages back through the whole history.
 * GET /crm/businesses/:b/contacts/:c/events pages since FU-TIMELINE-EVENTS-PAGING (crm.controller.ts contactEvents):
 * with a limit (1..200), an opaque cursor or paged=true it answers { events, nextCursor, hasMore }, newest first, a
 * page strictly older than the cursor; the default call (no params) still answers the newest 20 as an array. The
 * server withholds money events from a member without revenue read page by page (D-100), so the page only ever lists
 * and counts what it was served. The fetch stub answers as the server does (events-read-stub.ts).
 *
 *   TLO-01  RED      a customer with 45 events: the newest 20, then 40, then all 45 as older pages are loaded; "Load
 *                    older" is offered while the read returns a cursor and gone once it does not; the line, the
 *                    header, the counts ("+") and the empty texts speak of what is loaded, and plainly once all is
 *   TLO-02  RED      the page reads in pages: the first read asks for a page (no cursor), each older read sends the
 *                    cursor the last page returned, and the page never makes the default (array) read
 *   TLO-03  RED      a pasted message whose WhatsApp event is the first page's last record and whose note is the
 *                    second page's first shows once, before and after loading older (the fold works across pages)
 *   TLO-04  RED      the other way round (the note on the first page, its WhatsApp event on the second): the note
 *                    shows as WhatsApp until its event loads, then the two are one item with the text
 *   TLO-05  RED      a pasted note's edit on the first page, the pasted message on the second: the edit is a note
 *                    until the second page shows it is a pasted message's, then WhatsApp (MIN-3 across pages)
 *   TLO-06  RED      D-100: a member without revenue read is served no money event on any page; none is listed or
 *                    counted after loading older either
 *   TLO-07  RED      a failed older read keeps what is loaded and says so (an alert, not an empty history); "Load
 *                    older" tries again and then loads the page
 *   TLO-08  RED      one older read at a time: while it runs "Load older" is disabled, a second click reads nothing
 *                    more, and no record is listed twice
 *   TLO-09  control  a history of 19 events is read once and offers no "Load older"
 *   TLO-10  RED      choosing a channel after loading older reads nothing more and keeps every loaded page
 *   TLO-11  pin      an older page read for one customer that answers after the page has moved to another customer
 *                    is dropped: the other customer's Timeline never lists the first one's records (mutation pin)
 *
 * The page renders for real on the real client; only fetch and the Next router hooks are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

const params = vi.hoisted(() => ({ contactId: "c_tlo" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/app/crm/contacts/${params.contactId}/timeline`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import ContactTimelinePage from "../timeline/page";
import { cursorFor, newestFirst, serveEventsRead, type StubEvent } from "./events-read-stub";

const BIZ = "biz_tlo";
const C = params.contactId;
const base = Date.now() - 3 * 24 * 60 * 60 * 1000;
/** Larger i is newer; each event is a minute apart. */
const at = (i: number) => new Date(base + i * 60_000).toISOString();

type Ev = StubEvent & { contactId: string; type: string; source?: string | null; actorType?: string | null; data?: unknown };

/** Event i: a logged call (even i) or a sent SMS (odd i), whose words are "Item i". */
function plain(i: number): Ev {
  return i % 2 === 0
    ? { id: `ev_${String(i).padStart(3, "0")}`, contactId: C, type: "communication.call", source: "crm", actorType: "USER", createdAt: at(i), data: { channelType: "call", outcome: "answered", notes: `Item ${i}` } }
    : { id: `ev_${String(i).padStart(3, "0")}`, contactId: C, type: "sms.sent", source: "crm", createdAt: at(i), data: { body: `Item ${i}` } };
}

const PASTED_TEXT = "Can I move Saturday to 11?";
/** A pasted WhatsApp message's note.created, as captureInboundWhatsApp writes it (only { noteId }). */
const pastedNote = (createdAt: string, id = "ev_wa_note"): Ev => ({ id, contactId: C, type: "note.created", source: "whatsapp_inbound", actorType: "USER", createdAt, data: { noteId: "n_wa" } });
/** Its communication.whatsapp event, carrying the text and the noteId. */
const pastedEvent = (createdAt: string, id = "ev_wa"): Ev => ({
  id,
  contactId: C,
  type: "communication.whatsapp",
  source: "whatsapp_inbound",
  actorType: "USER",
  createdAt,
  data: { channel: "whatsapp", direction: "inbound", source: "pasted_whatsapp", body: PASTED_TEXT, senderPhone: "+18685550101", noteId: "n_wa" },
});

let served: Ev[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}
function isEventsRead(url: string): boolean {
  return new URL(url, "http://localhost").pathname.endsWith(`/crm/businesses/${BIZ}/contacts/${C}/events`);
}
function eventsReads(): URL[] {
  return fetchMock.mock.calls.map(([input]) => new URL(urlOf(input as RequestInfo), "http://localhost")).filter((u) => isEventsRead(u.href));
}

beforeEach(() => {
  served = [];
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (isEventsRead(url)) return serveEventsRead(url, served);
    return json(404, { message: "Not stubbed" });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  params.contactId = C;
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function filterGroup() {
  return screen.getByRole("group", { name: /filter by channel/i });
}
function filterButton(label: string) {
  return within(filterGroup()).getByRole("button", { name: new RegExp(`^${label}\\b`) });
}
function choose(label: string) {
  fireEvent.click(filterButton(label));
}
/** What a filter states: its count and whether it says "+" (more may exist than are loaded). */
function stated(label: string): string {
  const m = filterButton(label).textContent?.match(/\((\d+\+?)\)/);
  if (!m) throw new Error(`filter ${label} states no count: "${filterButton(label).textContent}"`);
  return m[1];
}
function loadOlder() {
  return screen.queryByRole("button", { name: /load older/i });
}
async function renderTimeline() {
  render(<ContactTimelinePage />);
  await screen.findByRole("heading", { name: "Timeline" });
  await vi.waitFor(() => expect(screen.queryByText(/loading timeline/i)).not.toBeInTheDocument());
}
/** The "Item n" words listed, as numbers, newest first. */
function itemsListed(): number[] {
  return screen.queryAllByText(/^Item \d+$/).map((el) => Number(el.textContent?.slice(5)));
}
async function clickLoadOlder(expectRecords: number) {
  const button = loadOlder();
  expect(button, "a Load older button").not.toBeNull();
  fireEvent.click(button!);
  await vi.waitFor(() => expect(screen.getByText(new RegExp(`(latest ${expectRecords} records|^\\d+ events?$)`))).toBeInTheDocument());
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => to - k);

describe("D-284: the Timeline loads older events", () => {
  it("TLO-01 RED: 45 events: the newest 20, then 40, then all 45; the words speak of what is loaded", async () => {
    served = Array.from({ length: 45 }, (_, i) => plain(i));
    await renderTimeline();

    // The newest 20 (Items 44..25): ten calls, ten SMS.
    expect(itemsListed()).toEqual(range(25, 44));
    expect(screen.getByText("The latest 20 timeline records are loaded; older ones are not listed or counted until you load them.")).toBeInTheDocument();
    expect(screen.queryByText(/^Only the latest/)).not.toBeInTheDocument();
    expect(screen.getByText(/^20 items from the latest 20 records$/)).toBeInTheDocument();
    expect([stated("All"), stated("Calls"), stated("SMS"), stated("Email")]).toEqual(["20+", "10+", "10+", "0+"]);
    choose("Email");
    expect(screen.getByText("No emails in the latest 20 records.")).toBeInTheDocument();
    expect(screen.queryByText("No emails yet.")).not.toBeInTheDocument();
    // "Load older" is offered under an empty filter too: the older records may hold emails.
    expect(loadOlder()).not.toBeNull();
    choose("All");

    await clickLoadOlder(40);
    expect(itemsListed()).toEqual(range(5, 44));
    expect(screen.getByText("The latest 40 timeline records are loaded; older ones are not listed or counted until you load them.")).toBeInTheDocument();
    expect(screen.getByText(/^40 items from the latest 40 records$/)).toBeInTheDocument();
    expect([stated("All"), stated("Calls"), stated("SMS"), stated("Email")]).toEqual(["40+", "20+", "20+", "0+"]);
    choose("Email");
    expect(screen.getByText("No emails in the latest 40 records.")).toBeInTheDocument();
    choose("All");

    await clickLoadOlder(45);
    expect(itemsListed()).toEqual(range(0, 44));
    // All is loaded: the plain words, no "+", no line, no Load older.
    expect(screen.getByText(/^45 events$/)).toBeInTheDocument();
    expect(screen.queryByText(/timeline records are loaded/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/latest \d+ records/);
    expect([stated("All"), stated("Calls"), stated("SMS"), stated("Email")]).toEqual(["45", "23", "22", "0"]);
    expect(loadOlder()).toBeNull();
    choose("Email");
    expect(screen.getByText("No emails yet.")).toBeInTheDocument();
    choose("Calls");
    expect(screen.getByText(/^23 of 45 events$/)).toBeInTheDocument();
  });

  it("TLO-02 RED: each read asks for a page; an older read sends the cursor the last page returned", async () => {
    served = Array.from({ length: 45 }, (_, i) => plain(i));
    await renderTimeline();
    await clickLoadOlder(40);
    await clickLoadOlder(45);
    const reads = eventsReads();
    expect(reads).toHaveLength(3);
    // Never the default read (an array of the newest 20, no cursor): every read names a page.
    for (const u of reads) expect(u.searchParams.has("paged") || u.searchParams.has("limit"), `a page read: ${u.search}`).toBe(true);
    for (const u of reads) if (u.searchParams.has("limit")) expect(u.searchParams.get("limit")).toBe("20");
    const sorted = newestFirst(served);
    expect(reads[0].searchParams.has("cursor")).toBe(false);
    expect(reads[1].searchParams.get("cursor")).toBe(cursorFor(sorted[19].id));
    expect(reads[2].searchParams.get("cursor")).toBe(cursorFor(sorted[39].id));
  });

  it("TLO-03 RED: a pasted message whose note is on the next page shows once, before and after loading older", async () => {
    // 30 records. Newest first, the WhatsApp event is the 20th (the first page's last) and its note the 21st.
    served = Array.from({ length: 30 }, (_, i) => (i === 10 ? pastedEvent(at(10)) : i === 9 ? pastedNote(at(9)) : plain(i)));
    expect(newestFirst(served)[19].id).toBe("ev_wa");
    expect(newestFirst(served)[20].id).toBe("ev_wa_note");
    await renderTimeline();
    expect(screen.getAllByText(PASTED_TEXT)).toHaveLength(1);
    expect(screen.queryByText("Note added")).not.toBeInTheDocument();
    expect(stated("WhatsApp")).toBe("1+");

    await clickLoadOlder(30);
    // One item: the note's event is the same message, wherever the page boundary fell.
    expect(screen.getAllByText(PASTED_TEXT)).toHaveLength(1);
    expect(screen.queryByText("Note added")).not.toBeInTheDocument();
    expect([stated("All"), stated("WhatsApp"), stated("Notes")]).toEqual(["29", "1", "0"]);
    expect(screen.getByText(/^29 events$/)).toBeInTheDocument();
    choose("WhatsApp");
    expect(screen.getAllByText(PASTED_TEXT)).toHaveLength(1);
    expect(screen.queryByText("Note added")).not.toBeInTheDocument();
  });

  it("TLO-04 RED: the note on the first page and its WhatsApp event on the next: one item once both are loaded", async () => {
    // The two share a timestamp (one capture); the note's id sorts first, so newest first the note is 20th, the event 21st.
    served = Array.from({ length: 30 }, (_, i) => (i === 10 ? pastedNote(at(10), "ev_wa_note") : i === 9 ? pastedEvent(at(10), "ev_wa") : plain(i)));
    expect(newestFirst(served)[19].id).toBe("ev_wa_note");
    expect(newestFirst(served)[20].id).toBe("ev_wa");
    await renderTimeline();
    // TCH-10: the note alone is a WhatsApp item (its text is in the event not yet loaded).
    expect(stated("WhatsApp")).toBe("1+");
    expect(stated("Notes")).toBe("0+");
    expect(screen.queryByText(PASTED_TEXT)).not.toBeInTheDocument();

    await clickLoadOlder(30);
    expect(screen.getAllByText(PASTED_TEXT)).toHaveLength(1);
    expect(screen.queryByText("Note added")).not.toBeInTheDocument();
    expect([stated("All"), stated("WhatsApp"), stated("Notes")]).toEqual(["29", "1", "0"]);
  });

  it("TLO-05 RED: a pasted note's edit on the first page is WhatsApp once the next page shows the note is a pasted one", async () => {
    // The edit is the 20th record; the pasted message (note and event) is older, on the next page.
    const edit: Ev = { id: "ev_wa_upd", contactId: C, type: "note.updated", source: "system", createdAt: at(10), data: { noteId: "n_wa" } };
    served = Array.from({ length: 30 }, (_, i) => (i === 10 ? edit : i === 9 ? pastedEvent(at(9)) : i === 8 ? pastedNote(at(8)) : plain(i)));
    expect(newestFirst(served)[19].id).toBe("ev_wa_upd");
    await renderTimeline();
    // Nothing loaded yet says the note is a pasted message: its edit is a note.
    expect([stated("WhatsApp"), stated("Notes")]).toEqual(["0+", "1+"]);

    await clickLoadOlder(30);
    // The message and its edit are WhatsApp; no note remains.
    expect([stated("All"), stated("WhatsApp"), stated("Notes")]).toEqual(["29", "2", "0"]);
    expect(screen.getAllByText(PASTED_TEXT)).toHaveLength(1);
  });

  it("TLO-06 RED: D-100: a member served no money event on any page lists and counts none", async () => {
    const payments: Ev[] = [5, 25].map((i) => ({ id: `ev_pay_${i}`, contactId: C, type: "payment.received", source: "revenue", createdAt: at(i + 0.5), data: { amount: 4200, title: "Deposit paid" } }));
    // What the server serves a member without revenue read: the same history less the money events.
    const everything = [...Array.from({ length: 40 }, (_, i) => plain(i)), ...payments];
    served = everything.filter((e) => !e.type.startsWith("payment."));
    await renderTimeline();
    await clickLoadOlder(40);
    expect(loadOlder()).toBeNull();
    expect(document.body).not.toHaveTextContent("4200");
    expect(screen.queryByText("Deposit paid")).not.toBeInTheDocument();
    expect(stated("All")).toBe("40");
    expect(screen.getByText(/^40 events$/)).toBeInTheDocument();
  });

  it("TLO-07 RED: a failed older read keeps what is loaded and says so; Load older tries again", async () => {
    served = Array.from({ length: 30 }, (_, i) => plain(i));
    let failing = true;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (!isEventsRead(url)) return json(404, { message: "Not stubbed" });
      if (failing && new URL(url, "http://localhost").searchParams.has("cursor")) return json(503, { message: "Service unavailable" });
      return serveEventsRead(url, served);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderTimeline();
    fireEvent.click(loadOlder()!);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn['’]t load older timeline events/i);
    // What was loaded stays, and still says it is the latest 20.
    expect(itemsListed()).toEqual(range(10, 29));
    expect(screen.getByText(/^20 items from the latest 20 records$/)).toBeInTheDocument();
    expect(stated("All")).toBe("20+");
    expect(screen.queryByText(/no timeline events yet/i)).not.toBeInTheDocument();

    failing = false;
    await clickLoadOlder(30);
    expect(itemsListed()).toEqual(range(0, 29));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(loadOlder()).toBeNull();
  });

  it("TLO-08 RED: one older read at a time; nothing listed twice", async () => {
    served = Array.from({ length: 45 }, (_, i) => plain(i));
    let release: (() => void) | null = null;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (!isEventsRead(url)) return json(404, { message: "Not stubbed" });
      if (new URL(url, "http://localhost").searchParams.has("cursor")) await new Promise<void>((r) => (release = r));
      return serveEventsRead(url, served);
    });
    await renderTimeline();
    const button = loadOlder()!;
    fireEvent.click(button);
    await vi.waitFor(() => expect(eventsReads()).toHaveLength(2));
    await vi.waitFor(() => expect(loadOlder()).toBeDisabled());
    fireEvent.click(loadOlder()!);
    fireEvent.click(loadOlder()!);
    expect(eventsReads()).toHaveLength(2);
    release!();
    await vi.waitFor(() => expect(screen.getByText(/^40 items from the latest 40 records$/)).toBeInTheDocument());
    expect(itemsListed()).toEqual(range(5, 44));
    expect(loadOlder()).not.toBeDisabled();
  });

  it("TLO-09 control: 19 events are read once; no Load older", async () => {
    served = Array.from({ length: 19 }, (_, i) => plain(i));
    await renderTimeline();
    expect(itemsListed()).toEqual(range(0, 18));
    expect(screen.getByText(/^19 events$/)).toBeInTheDocument();
    expect(loadOlder()).toBeNull();
    expect(eventsReads()).toHaveLength(1);
  });

  it("TLO-10 RED: choosing a channel after loading older reads nothing and keeps every loaded page", async () => {
    served = Array.from({ length: 45 }, (_, i) => plain(i));
    await renderTimeline();
    await clickLoadOlder(40);
    const before = fetchMock.mock.calls.length;
    choose("Calls");
    expect(itemsListed()).toEqual(range(5, 44).filter((i) => i % 2 === 0));
    choose("All");
    expect(itemsListed()).toEqual(range(5, 44));
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("TLO-11 pin: an older page that answers after the page moved to another customer is dropped", async () => {
    const OTHER = "c_tlo_other";
    served = Array.from({ length: 45 }, (_, i) => plain(i));
    const otherServed: Ev[] = [{ id: "ev_other", contactId: OTHER, type: "sms.sent", source: "crm", createdAt: at(1), data: { body: "Other customer" } }];
    let release: (() => void) | null = null;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      const { pathname, searchParams } = new URL(url, "http://localhost");
      if (pathname.endsWith(`/crm/businesses/${BIZ}/contacts/${OTHER}/events`)) return serveEventsRead(url, otherServed);
      if (!isEventsRead(url)) return json(404, { message: "Not stubbed" });
      if (searchParams.has("cursor")) await new Promise<void>((r) => (release = r));
      return serveEventsRead(url, served);
    });
    const { rerender } = render(<ContactTimelinePage />);
    await vi.waitFor(() => expect(loadOlder()).not.toBeNull());
    fireEvent.click(loadOlder()!);
    await vi.waitFor(() => expect(release).not.toBeNull());
    params.contactId = OTHER;
    rerender(<ContactTimelinePage />);
    await screen.findByText("Other customer");
    release!();
    // Let the dropped answer settle, then: only the other customer's record.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("Other customer")).toBeInTheDocument();
    expect(itemsListed()).toEqual([]);
    expect(screen.getByText(/^1 event$/)).toBeInTheDocument();
    expect(loadOlder()).toBeNull();
  });
});
