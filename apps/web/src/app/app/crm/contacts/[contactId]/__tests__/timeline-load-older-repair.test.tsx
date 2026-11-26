/**
 * FU-TIMELINE-LOAD-OLDER (D-284), review round 1 (both lenses, at 8bbd3d6f). The Timeline reads its events in pages
 * (GET .../contacts/:c/events?paged=true&limit=20[&cursor]); timeline-load-older.test.tsx pins the paging itself.
 *
 *   TLR-01  pin      SEC-TLO-1 / COR-TLO-4: the first read answering a plain array (not a page) is a failed load:
 *                    "Couldn't load the timeline." with Retry, no filter, never an empty history
 *   TLR-02  RED      SEC-TLO-1: a first page carrying an event whose createdAt is no date is a failed load too
 *   TLR-03  pin      SEC-TLO-1: an older read answering {} keeps what is loaded and says it could not load older events
 *   TLR-04  RED      SEC-TLO-1: an older page carrying an event whose createdAt is no date: the same; that event is
 *                    never listed
 *   TLR-05  pin      COR-TLO-1: a first page for customer A that answers after the page moved to customer B is dropped:
 *                    B's Timeline stays B's (mutation pin for the first read's generation check)
 *   TLR-06  pin      COR-TLO-2: two Load older clicks in one React batch (before the disabled state renders) send one
 *                    older read (mutation pin for the in-flight guard)
 *   TLR-07  RED      COR-TLO-3: an older read refused with a 4xx (400 "Invalid cursor") is not retried with the same
 *                    cursor: Load older goes, the alert says to reload, and "Reload timeline" reads again from the
 *                    newest page; Load older then works from that page's cursor
 *   TLR-08  control  COR-TLO-3: a 429 or a 5xx on an older read stays retryable (Load older stays, same cursor)
 *   TLR-09  RED      SEC-TLO-2: a business switch in this tab (kf:business-changed) drops what was loaded for the old
 *                    business and its cursor, and reads the newest page again for the new one
 *   TLR-10  RED      SEC-TLO-2: a business switch in another tab (storage, kf_business_id) does the same
 *   TLR-11  control  SEC-TLO-3: moving to another customer shows none of the old customer's events and offers no Load
 *                    older from the old customer's cursor while the new customer's first page is read
 *
 * The page renders for real on the real client; only fetch and the Next router hooks are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup, fireEvent, within } from "@testing-library/react";

const params = vi.hoisted(() => ({ contactId: "c_tlr" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/app/crm/contacts/${params.contactId}/timeline`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import ContactTimelinePage from "../timeline/page";
import { BUSINESS_CHANGED_EVENT } from "@/lib/workspace";
import { cursorFor, newestFirst, serveEventsRead, type StubEvent } from "./events-read-stub";

const BIZ = "biz_tlr";
const BIZ2 = "biz_tlr_two";
const C = params.contactId;
const OTHER = "c_tlr_other";
const base = Date.now() - 3 * 24 * 60 * 60 * 1000;
const at = (i: number) => new Date(base + i * 60_000).toISOString();

type Ev = StubEvent & { contactId: string; type: string; source?: string | null; data?: unknown };

/** Event i of a customer: an SMS whose words are "<label> i". */
function sms(i: number, label = "Item", contactId = C): Ev {
  return { id: `ev_${label}_${String(i).padStart(3, "0")}`, contactId, type: "sms.sent", source: "crm", createdAt: at(i), data: { body: `${label} ${i}` } };
}

/** What each business's customers may be served; tests replace a handler to answer otherwise. */
let histories: Record<string, Ev[]> = {};
type Handler = (url: URL) => Promise<Response> | Response;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}
/** "biz/contact" of an events read, or null for any other request. */
function eventsReadOf(url: URL): string | null {
  const m = url.pathname.match(/\/crm\/businesses\/([^/]+)\/contacts\/([^/]+)\/events$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
function serveHistory(url: URL): Response {
  const key = eventsReadOf(url);
  if (!key) return json(404, { message: "Not stubbed" });
  return serveEventsRead(url.href, histories[key] ?? []);
}
function eventsReads(): URL[] {
  return fetchMock.mock.calls.map(([input]) => new URL(urlOf(input as RequestInfo), "http://localhost")).filter((u) => eventsReadOf(u) !== null);
}

beforeEach(() => {
  histories = {};
  handler = serveHistory;
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(new URL(urlOf(input), "http://localhost")));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  params.contactId = C;
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function loadOlder() {
  return screen.queryByRole("button", { name: /^load older$/i });
}
function reloadButton() {
  return screen.queryByRole("button", { name: /^reload timeline$/i });
}
function filterGroup() {
  return screen.queryByRole("group", { name: /filter by channel/i });
}
function countOfAll(): string | undefined {
  const group = filterGroup();
  if (!group) return undefined;
  return within(group).getByRole("button", { name: /^All\b/ }).textContent?.match(/\((\d+\+?)\)/)?.[1];
}
async function renderTimeline() {
  const view = render(<ContactTimelinePage />);
  await screen.findByRole("heading", { name: "Timeline" });
  await vi.waitFor(() => expect(screen.queryByText(/loading timeline/i)).not.toBeInTheDocument());
  return view;
}
/** The "<label> n" words listed, as numbers, newest first. */
function listed(label = "Item"): number[] {
  return screen.queryAllByText(new RegExp(`^${label} \\d+$`)).map((el) => Number(el.textContent?.slice(label.length + 1)));
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => to - k);
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("SEC-TLO-1 / COR-TLO-4: an answer that is not a page is a failed read", () => {
  it("TLR-01 pin: a first read answering a plain array is a failed load, with Retry", async () => {
    handler = (url) => (eventsReadOf(url) ? json(200, [sms(1)]) : json(404, { message: "Not stubbed" }));
    await renderTimeline();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the timeline.");
    expect(within(alert).getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(filterGroup()).toBeNull();
    expect(screen.queryByText(/no timeline events yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
  });

  it("TLR-02 RED: a first page with an event whose createdAt is no date is a failed load", async () => {
    histories[`${BIZ}/${C}`] = [sms(1)];
    handler = (url) =>
      eventsReadOf(url) ? json(200, { events: [sms(2), { ...sms(1), createdAt: "not-a-date" }], nextCursor: null, hasMore: false }) : json(404, {});
    await renderTimeline();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the timeline.");
    expect(filterGroup()).toBeNull();
    expect(screen.queryByText("Item 2")).not.toBeInTheDocument();
  });

  it("TLR-03 pin: an older read answering {} keeps what is loaded and says so", async () => {
    histories[`${BIZ}/${C}`] = Array.from({ length: 30 }, (_, i) => sms(i));
    handler = (url) => (url.searchParams.has("cursor") ? json(200, {}) : serveHistory(url));
    await renderTimeline();
    fireEvent.click(loadOlder()!);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load older timeline events.");
    expect(listed()).toEqual(range(10, 29));
    expect(countOfAll()).toBe("20+");
    expect(screen.getByText(/^20 items from the latest 20 records$/)).toBeInTheDocument();
  });

  it("TLR-04 RED: an older page with an event whose createdAt is no date is not loaded; what is loaded stays", async () => {
    histories[`${BIZ}/${C}`] = Array.from({ length: 30 }, (_, i) => sms(i));
    handler = (url) =>
      url.searchParams.has("cursor")
        ? json(200, { events: [sms(9), { ...sms(8), createdAt: "31/02/2026" }], nextCursor: null, hasMore: false })
        : serveHistory(url);
    await renderTimeline();
    fireEvent.click(loadOlder()!);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load older timeline events.");
    expect(listed()).toEqual(range(10, 29));
    expect(screen.queryByText("Item 8")).not.toBeInTheDocument();
    expect(screen.queryByText("Item 9")).not.toBeInTheDocument();
    expect(countOfAll()).toBe("20+");
  });
});

describe("COR-TLO-1 / COR-TLO-2: stale and doubled reads", () => {
  it("TLR-05 pin: a first page for A that answers after the page moved to B is dropped", async () => {
    histories[`${BIZ}/${C}`] = Array.from({ length: 5 }, (_, i) => sms(i, "Alpha"));
    histories[`${BIZ}/${OTHER}`] = [sms(1, "Bravo", OTHER)];
    let releaseA: (() => void) | null = null;
    handler = async (url) => {
      if (eventsReadOf(url) === `${BIZ}/${C}`) await new Promise<void>((r) => (releaseA = r));
      return serveHistory(url);
    };
    const view = render(<ContactTimelinePage />);
    await vi.waitFor(() => expect(releaseA).not.toBeNull());
    params.contactId = OTHER;
    view.rerender(<ContactTimelinePage />);
    await screen.findByText("Bravo 1");
    await act(async () => {
      releaseA!();
      await tick();
    });
    expect(screen.getByText("Bravo 1")).toBeInTheDocument();
    expect(listed("Alpha")).toEqual([]);
    expect(screen.getByText(/^1 event$/)).toBeInTheDocument();
  });

  it("TLR-06 pin: two Load older clicks in one batch send one older read", async () => {
    histories[`${BIZ}/${C}`] = Array.from({ length: 45 }, (_, i) => sms(i));
    await renderTimeline();
    const button = loadOlder()!;
    // One act: React renders neither click's state (the disabled button) before the second click runs.
    await act(async () => {
      button.click();
      button.click();
    });
    await vi.waitFor(() => expect(screen.getByText(/^40 items from the latest 40 records$/)).toBeInTheDocument());
    const cursors = eventsReads().map((u) => u.searchParams.get("cursor"));
    expect(cursors).toEqual([null, cursorFor(newestFirst(histories[`${BIZ}/${C}`])[19].id)]);
    expect(listed()).toEqual(range(5, 44));
  });
});

describe("COR-TLO-3: a refused older read is not retried with the same cursor", () => {
  it("TLR-07 RED: a 400 on an older read: no Load older with that cursor; Reload timeline reads the newest page again", async () => {
    histories[`${BIZ}/${C}`] = Array.from({ length: 45 }, (_, i) => sms(i));
    let refuse = true;
    handler = (url) => (refuse && url.searchParams.has("cursor") ? json(400, { statusCode: 400, message: "Invalid cursor", error: "Bad Request" }) : serveHistory(url));
    await renderTimeline();
    const firstCursor = cursorFor(newestFirst(histories[`${BIZ}/${C}`])[19].id);
    fireEvent.click(loadOlder()!);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn['’]t load older timeline events: invalid cursor/i);
    expect(alert).toHaveTextContent(/reload the timeline/i);
    // The same cursor is not offered again.
    expect(loadOlder()).toBeNull();
    expect(eventsReads().filter((u) => u.searchParams.get("cursor") === firstCursor)).toHaveLength(1);
    // What is loaded stays, and still says it is the latest 20.
    expect(listed()).toEqual(range(25, 44));
    expect(screen.getByText(/^20 items from the latest 20 records$/)).toBeInTheDocument();

    refuse = false;
    fireEvent.click(reloadButton()!);
    await vi.waitFor(() => expect(loadOlder()).not.toBeNull());
    const reads = eventsReads();
    expect(reads[reads.length - 1].searchParams.has("cursor")).toBe(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(loadOlder()!);
    await vi.waitFor(() => expect(screen.getByText(/^40 items from the latest 40 records$/)).toBeInTheDocument());
    expect(listed()).toEqual(range(5, 44));
  });

  it("TLR-08 control: a 429 or a 5xx on an older read stays retryable with the same cursor", async () => {
    histories[`${BIZ}/${C}`] = Array.from({ length: 30 }, (_, i) => sms(i));
    const answers = [json(429, { message: "Rate limit exceeded. Please slow down and try again shortly." }), json(503, { message: "Service unavailable" })];
    handler = (url) => (url.searchParams.has("cursor") && answers.length ? answers.shift()! : serveHistory(url));
    await renderTimeline();
    fireEvent.click(loadOlder()!);
    await screen.findByRole("alert");
    expect(loadOlder()).not.toBeNull();
    expect(reloadButton()).toBeNull();
    fireEvent.click(loadOlder()!);
    await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/service unavailable/i));
    expect(loadOlder()).not.toBeNull();
    fireEvent.click(loadOlder()!);
    await vi.waitFor(() => expect(screen.getByText(/^30 events$/)).toBeInTheDocument());
    const cursors = eventsReads().map((u) => u.searchParams.get("cursor")).filter(Boolean);
    expect(new Set(cursors).size).toBe(1);
    expect(cursors).toHaveLength(3);
  });
});

describe("SEC-TLO-2 / SEC-TLO-3: a switch of business or customer starts over", () => {
  async function loadTwoPagesThenSwitch(doSwitch: () => void) {
    histories[`${BIZ}/${C}`] = Array.from({ length: 45 }, (_, i) => sms(i, "Alpha"));
    histories[`${BIZ2}/${C}`] = Array.from({ length: 25 }, (_, i) => sms(i, "Bravo"));
    await renderTimeline();
    fireEvent.click(loadOlder()!);
    await vi.waitFor(() => expect(screen.getByText(/^40 items from the latest 40 records$/)).toBeInTheDocument());
    const before = eventsReads().length;
    await act(async () => {
      window.localStorage.setItem("kf_business_id", BIZ2);
      doSwitch();
      await tick();
    });
    await vi.waitFor(() => expect(screen.getByText(/^20 items from the latest 20 records$/)).toBeInTheDocument());
    const after = eventsReads().slice(before);
    // One fresh read of the newest page, for the new business; no cursor of the old one.
    expect(after.map((u) => `${eventsReadOf(u)} ${u.searchParams.get("cursor")}`)).toEqual([`${BIZ2}/${C} null`]);
    expect(listed("Alpha")).toEqual([]);
    expect(listed("Bravo")).toEqual(range(5, 24));
    fireEvent.click(loadOlder()!);
    await vi.waitFor(() => expect(screen.getByText(/^25 events$/)).toBeInTheDocument());
    const last = eventsReads()[eventsReads().length - 1];
    expect(eventsReadOf(last)).toBe(`${BIZ2}/${C}`);
    expect(last.searchParams.get("cursor")).toBe(cursorFor(newestFirst(histories[`${BIZ2}/${C}`])[19].id));
    expect(listed("Alpha")).toEqual([]);
  }

  it("TLR-09 RED: a business switch in this tab (kf:business-changed) reads the newest page for the new business", async () => {
    await loadTwoPagesThenSwitch(() => window.dispatchEvent(new CustomEvent(BUSINESS_CHANGED_EVENT, { detail: { businessId: BIZ2 } })));
  });

  it("TLR-10 RED: a business switch in another tab (storage) does the same", async () => {
    await loadTwoPagesThenSwitch(() => window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", newValue: BIZ2 })));
  });

  it("TLR-11 control: moving to another customer shows none of the old one's events and no Load older from its cursor", async () => {
    histories[`${BIZ}/${C}`] = Array.from({ length: 45 }, (_, i) => sms(i, "Alpha"));
    histories[`${BIZ}/${OTHER}`] = [sms(1, "Bravo", OTHER)];
    let releaseB: (() => void) | null = null;
    handler = async (url) => {
      if (eventsReadOf(url) === `${BIZ}/${OTHER}`) await new Promise<void>((r) => (releaseB = r));
      return serveHistory(url);
    };
    const view = await renderTimeline();
    expect(loadOlder()).not.toBeNull();
    params.contactId = OTHER;
    view.rerender(<ContactTimelinePage />);
    await vi.waitFor(() => expect(releaseB).not.toBeNull());
    expect(listed("Alpha")).toEqual([]);
    expect(loadOlder()).toBeNull();
    await act(async () => {
      releaseB!();
      await tick();
    });
    await screen.findByText("Bravo 1");
    expect(loadOlder()).toBeNull();
    expect(listed("Alpha")).toEqual([]);
  });
});
