"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { fetchContactEventsPage, type ContactEventsPage } from "@/lib/client";
import { BUSINESS_CHANGED_EVENT, getStoredBusinessId } from "@/lib/workspace";
import { readState } from "@/lib/failure-kit";
import { eventLabel, plainLabel, statusLabel } from "@/lib/status-labels";
import { Card } from "@keyflow/ui";
import { Clock, Mail, Phone, MessageSquare, MessageCircle, Calendar, DollarSign, FileText, Star, User, Zap, AlertTriangle, CheckCircle, Info } from "lucide-react";
import {
  CHANNEL_FILTERS,
  channelCounts,
  conversationTitle,
  emptyText,
  eventChannel,
  foldPastedNotes,
  pastedNoteIds,
  type ChannelFilter,
  type TimelineChannel,
} from "./timeline-channels";

interface ContactEvent {
  id: string;
  contactId: string;
  type: string;
  data?: unknown;
  actorType?: string | null;
  actorId?: string | null;
  source?: string | null;
  createdAt: string;
}

const typeConfig: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  email: { icon: Mail, color: "text-blue-600", bg: "bg-blue-100" },
  call: { icon: Phone, color: "text-green-600", bg: "bg-green-100" },
  sms: { icon: MessageSquare, color: "text-purple-600", bg: "bg-purple-100" },
  meeting: { icon: Calendar, color: "text-orange-600", bg: "bg-orange-100" },
  booking: { icon: Calendar, color: "text-teal-600", bg: "bg-teal-100" },
  payment: { icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-100" },
  invoice: { icon: FileText, color: "text-indigo-600", bg: "bg-indigo-100" },
  quote: { icon: FileText, color: "text-cyan-600", bg: "bg-cyan-100" },
  note: { icon: Star, color: "text-amber-600", bg: "bg-amber-100" },
  task: { icon: CheckCircle, color: "text-rose-600", bg: "bg-rose-100" },
  ai: { icon: Zap, color: "text-violet-600", bg: "bg-violet-100" },
  alert: { icon: AlertTriangle, color: "text-red-600", bg: "bg-red-100" },
  default: { icon: Info, color: "text-gray-600", bg: "bg-gray-100" },
};

/** A channel's own look, so a pasted WhatsApp message (or its note) reads as WhatsApp, not as a note. */
const channelConfig: Record<TimelineChannel, { icon: React.ElementType; color: string; bg: string }> = {
  whatsapp: { icon: MessageCircle, color: "text-green-700", bg: "bg-green-100" },
  email: typeConfig.email,
  sms: typeConfig.sms,
  call: typeConfig.call,
  note: typeConfig.note,
};

function getEventConfig(ev: ContactEvent, pasted: ReadonlySet<string>) {
  const channel = eventChannel(ev, pasted);
  if (channel) return channelConfig[channel];
  const key = Object.keys(typeConfig).find((k) => ev.type.toLowerCase().includes(k));
  return typeConfig[key || "default"];
}

/** The event in plain words: a logged conversation by its channel ("Call logged"), anything else by eventLabel. */
function eventTitle(ev: ContactEvent): string {
  // BUG-129: never the code ("Note.Created"); "SMS" keeps its capitals (eventLabel would say "Sms sent").
  return conversationTitle(ev) ?? eventLabel(ev.type).replace(/^Sms\b/, "SMS");
}

function formatEventData(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  if (d.title && typeof d.title === "string") return d.title;
  if (d.subject && typeof d.subject === "string") return d.subject;
  if (d.description && typeof d.description === "string") return d.description;
  if (d.body && typeof d.body === "string") return d.body;
  if (d.message && typeof d.message === "string") return d.message;
  // A logged call, email, SMS or meeting keeps its words in notes (log-communication).
  if (d.notes && typeof d.notes === "string") return d.notes;
  // A stored status in the owner's words ("Part-paid", not "PARTIALLY_PAID"; review CDC-4).
  if (d.status && typeof d.status === "string") return plainLabel(d.status);
  return "";
}

/** Who did it, in plain words: "System", "User"; "AI" keeps its capitals (statusLabel would say "Ai"). */
function actorLabel(actor: string): string {
  return actor.trim().toUpperCase() === "AI" ? "AI" : statusLabel(actor);
}

/** Newest first, as the server pages them: createdAt descending, then id descending. */
function newestFirst(a: ContactEvent, b: ContactEvent): number {
  const t = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (t !== 0) return t;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The loaded records and an older page, as one list: each record once (by id), newest first. */
function mergePage(loaded: readonly ContactEvent[], page: readonly ContactEvent[]): ContactEvent[] {
  const byId = new Map<string, ContactEvent>();
  for (const ev of loaded) byId.set(ev.id, ev);
  for (const ev of page) if (!byId.has(ev.id)) byId.set(ev.id, ev);
  return [...byId.values()].sort(newestFirst);
}

/**
 * COR-TLO-3: an older read the server refused for what it asked (a 4xx: an invalid or expired cursor, no access, the
 * customer gone) fails again with the same cursor, so it is not offered again: the page asks for a reload from the
 * newest page instead. A timeout, a rate limit (408, 429), a 5xx or a network failure may pass on a second try.
 */
function refusedForGood(status: number | undefined): boolean {
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * SEC-TLO-2: the selected business, followed while the page is open: a switch in this tab (selectBusiness announces
 * BUSINESS_CHANGED_EVENT) or in another (`storage` on the business key). The events read names the business, so a
 * switch starts the Timeline over: what was loaded, and its cursor, belonged to the old one.
 */
/** The localStorage key workspace.ts keeps the selected business under (its BUSINESS_ID_KEY, not exported). */
const BUSINESS_ID_KEY = "kf_business_id";

function useSelectedBusiness(): string | null {
  const [business, setBusiness] = useState<string | null>(() => getStoredBusinessId());
  useEffect(() => {
    const onChange = () => setBusiness(getStoredBusinessId());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === BUSINESS_ID_KEY) onChange();
    };
    window.addEventListener(BUSINESS_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BUSINESS_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return business;
}

/** The cursor of the next older page, or null when this page is the oldest. */
function cursorAfter(page: ContactEventsPage): string | null {
  return page.hasMore && typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
}

export default function ContactTimelinePage() {
  const { contactId } = useParams();
  const business = useSelectedBusiness();
  const [events, setEvents] = useState<ContactEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ChannelFilter>("all");
  // MIN-4: a failed read is said as such (with Retry), never shown as an empty history. failure-kit's readState judges
  // it, so an empty error (a proxy 502 over HTTP/2, a non-JSON body: apiGet's error is "") is a failure too (FK-SEC-1).
  const [loadError, setLoadError] = useState<{ message: string; retry: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // FU-TIMELINE-LOAD-OLDER (D-284): the read pages. The cursor of the next older page, null once the oldest is loaded.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  // COR-TLO-3: the older read was refused for good (refusedForGood); Load older gives way to Reload timeline.
  const [olderRefused, setOlderRefused] = useState(false);
  // Which load an answer belongs to: a Retry, a reload, another customer or another business starts a new one, and a
  // first or older page read for the old one is dropped. olderInFlight holds one older read at a time, even for two clicks before the button disables.
  const generation = useRef(0);
  const olderInFlight = useRef(false);

  useEffect(() => {
    const gen = ++generation.current;
    olderInFlight.current = false;
    const load = async () => {
      // SEC-TLO-3: nothing of the previous load (another customer's or business's events, or its cursor) outlives it.
      setEvents([]);
      setNextCursor(null);
      setOlderRefused(false);
      setLoading(true);
      setLoadingOlder(false);
      setOlderError(null);
      const res = await fetchContactEventsPage(contactId as string);
      if (gen !== generation.current) return;
      // SEC-TLO-1: an answer that is not a page comes back as a failure without words ("Couldn't load the timeline.").
      const state = readState(res, { what: "the timeline" });
      if (state.kind !== "ok" || !res.data) {
        setEvents([]);
        setNextCursor(null);
        // No access is not fixed by trying again; a failed load may be.
        setLoadError(state.kind !== "ok" ? { message: state.message, retry: state.kind === "failed" } : { message: "Couldn't load the timeline.", retry: true });
      } else {
        setEvents(mergePage([], res.data.events));
        setNextCursor(cursorAfter(res.data));
        setLoadError(null);
      }
      setLoading(false);
    };
    load();
  }, [contactId, attempt, business]);

  const loadOlder = useCallback(async () => {
    if (!nextCursor || olderInFlight.current || olderRefused) return;
    olderInFlight.current = true;
    const gen = generation.current;
    setLoadingOlder(true);
    setOlderError(null);
    const res = await fetchContactEventsPage(contactId as string, { cursor: nextCursor });
    if (gen !== generation.current) return;
    olderInFlight.current = false;
    setLoadingOlder(false);
    const state = readState(res, { what: "older timeline events" });
    if (state.kind !== "ok" || !res.data) {
      const message = state.kind !== "ok" ? state.message : "Couldn't load older timeline events.";
      // What is loaded stays. A refusal for good (COR-TLO-3) is not retried with the same cursor; any other failure
      // keeps the cursor, so Load older tries the same page again.
      if (refusedForGood(res.status)) {
        setOlderRefused(true);
        setOlderError(`${message.replace(/\.$/, "")}. Reload the timeline to start again from the newest events.`);
      } else {
        setOlderError(message);
      }
      return;
    }
    const page = res.data;
    setEvents((loaded) => mergePage(loaded, page.events));
    setNextCursor(cursorAfter(page));
  }, [contactId, nextCursor, olderRefused]);

  // D-277: one item per pasted WhatsApp message; the filter and its counts work on what the events read served only.
  // D-284: over every page loaded, so a pasted message whose note and WhatsApp event are on two pages is one item.
  const items = useMemo(() => foldPastedNotes(events), [events]);
  // MIN-3: the notes the read shows to be pasted messages, so that their edits and deletes are WhatsApp too.
  const pasted = useMemo(() => pastedNoteIds(events), [events]);
  const counts = useMemo(() => channelCounts(items, pasted), [items, pasted]);
  const shown = filter === "all" ? items : items.filter((ev) => eventChannel(ev, pasted) === filter);
  // COR-TCH-1, D-284: while older records are not loaded, everything below speaks of the latest records loaded only.
  // N-1: the read loads records (events); the page lists items (a pasted message's two records are one item). While
  // older records remain, the header names both, so its count and the line's never read as two counts of one thing.
  const more = nextCursor !== null;
  const plural = items.length === 1 ? "event" : "events";
  const fromRead = `${items.length === 1 ? "item" : "items"} from the latest ${events.length} records`;
  const header = more
    ? filter === "all"
      ? `${items.length} ${fromRead}`
      : `${shown.length} of ${items.length} ${fromRead}`
    : filter === "all"
      ? `${items.length} ${plural}`
      : `${shown.length} of ${items.length} ${plural}`;

  if (loading) return <div className="p-4">Loading timeline...</div>;

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Timeline</h3>
        </div>
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 break-words">{loadError.message}</span>
          {loadError.retry && (
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="min-h-9 rounded-md border px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // Group by date
  const groups: Record<string, ContactEvent[]> = {};
  shown.forEach((ev) => {
    const date = new Date(ev.createdAt).toISOString().slice(0, 10);
    if (!groups[date]) groups[date] = [];
    groups[date].push(ev);
  });

  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  // Below md the phone's fixed bottom bar covers the viewport's bottom edge. The app scroll root's pb-28 should keep
  // the end of a page clear of it, but PageTransition's h-full wrapper is shorter than a long page, so that padding
  // ends where the wrapper does and the page's last ~80px stay under the bar, out of reach (live sweep at 375). Load
  // older is the last thing on this page, so the page keeps its own clearance below md.
  return (
    <div className="space-y-4 pb-24 md:pb-0">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Timeline</h3>
        <span className="ml-auto text-sm text-muted-foreground">{header}</span>
      </div>

      {more && (
        <p className="text-xs text-muted-foreground">
          The latest {events.length} timeline records are loaded; older ones are not listed or counted until you load them.
        </p>
      )}

      <div role="group" aria-label="Filter by channel" className="flex flex-wrap gap-2">
        {CHANNEL_FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.id)}
              className={`min-h-9 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {f.label} <span className="tabular-nums opacity-80">({counts[f.id]}{more ? "+" : ""})</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {emptyText(items.length === 0 ? "all" : filter, more ? events.length : null)}
        </div>
      ) : (
        <div className="relative space-y-6 pl-4">
          {/* Vertical line */}
          <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />

          {dates.map((date) => (
            <div key={date} className="relative">
              <div className="mb-2 flex items-center gap-2">
                <div className="z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {new Date(date).getDate()}
                </div>
                <span className="text-sm font-medium text-muted-foreground">
                  {fmtDate(date)}
                </span>
              </div>
              <div className="space-y-2 pl-7">
                {groups[date].map((ev) => {
                  const cfg = getEventConfig(ev, pasted);
                  const Icon = cfg.icon;
                  const detail = formatEventData(ev.data);
                  // A message is shown whole, as typed: third-party text, rendered as text only (never markup).
                  const channel = eventChannel(ev, pasted);
                  const isMessage = channel !== null && channel !== "note";
                  return (
                    <Card key={ev.id} className="border-l-4 border-l-transparent hover:border-l-primary/50 transition-colors">
                      <div className="flex items-start gap-3 p-3">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}>
                          <Icon className={`h-4 w-4 ${cfg.color}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* BUG-129: the event in plain words ("Note added"), never its code ("Note.Created"). */}
                            <span className="text-sm font-medium">{eventTitle(ev)}</span>
                            {ev.source && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {ev.source}
                              </span>
                            )}
                          </div>
                          {detail && (
                            <p
                              className={`mt-0.5 text-sm text-muted-foreground ${
                                isMessage ? "whitespace-pre-wrap break-words" : "line-clamp-2"
                              }`}
                            >
                              {detail}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{timeAgo(ev.createdAt)}</span>
                            {ev.actorType && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {actorLabel(ev.actorType)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {olderError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 break-words">{olderError}</span>
        </div>
      )}

      {more && olderRefused && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="min-h-9 rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reload timeline
          </button>
        </div>
      )}

      {more && !olderRefused && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingOlder}
            aria-busy={loadingOlder}
            className="min-h-9 rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            Load older
          </button>
          {loadingOlder && (
            <span role="status" className="text-sm text-muted-foreground">
              Loading older events…
            </span>
          )}
        </div>
      )}
    </div>
  );
}
