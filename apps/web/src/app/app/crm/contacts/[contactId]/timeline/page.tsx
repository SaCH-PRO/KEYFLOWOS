"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { fetchContactEvents } from "@/lib/client";
import { eventLabel, plainLabel, statusLabel } from "@/lib/status-labels";
import { Card } from "@keyflow/ui";
import { Clock, Mail, Phone, MessageSquare, MessageCircle, Calendar, DollarSign, FileText, Star, User, Zap, AlertTriangle, CheckCircle, Info } from "lucide-react";
import {
  CHANNEL_FILTERS,
  channelCounts,
  EVENTS_READ_PAGE,
  conversationTitle,
  emptyText,
  eventChannel,
  foldPastedNotes,
  readIsFull,
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

function getEventConfig(ev: ContactEvent) {
  const channel = eventChannel(ev);
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
  const [events, setEvents] = useState<ContactEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ChannelFilter>("all");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const res = await fetchContactEvents(contactId as string);
      const list = (res.data ?? []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setEvents(list);
      setLoading(false);
    };
    load();
  }, [contactId]);

  // D-277: one item per pasted WhatsApp message; the filter and its counts work on what the events read served only.
  const items = useMemo(() => foldPastedNotes(events), [events]);
  const counts = useMemo(() => channelCounts(items), [items]);
  const shown = filter === "all" ? items : items.filter((ev) => eventChannel(ev) === filter);
  // COR-TCH-1: a full read may have left older events out; then everything below speaks of the latest events only.
  const full = readIsFull(events.length);
  const plural = items.length === 1 ? "event" : "events";
  const header = full
    ? filter === "all"
      ? `Latest ${items.length} ${plural}`
      : `${shown.length} of the latest ${items.length} ${plural}`
    : filter === "all"
      ? `${items.length} ${plural}`
      : `${shown.length} of ${items.length} ${plural}`;

  if (loading) return <div className="p-4">Loading timeline...</div>;

  // Group by date
  const groups: Record<string, ContactEvent[]> = {};
  shown.forEach((ev) => {
    const date = new Date(ev.createdAt).toISOString().slice(0, 10);
    if (!groups[date]) groups[date] = [];
    groups[date].push(ev);
  });

  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Timeline</h3>
        <span className="ml-auto text-sm text-muted-foreground">{header}</span>
      </div>

      {full && (
        <p className="text-xs text-muted-foreground">
          Showing the latest {EVENTS_READ_PAGE} events. Older events are not listed or counted here.
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
              {f.label} <span className="tabular-nums opacity-80">({counts[f.id]}{full ? "+" : ""})</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {emptyText(items.length === 0 ? "all" : filter, full)}
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
                  const cfg = getEventConfig(ev);
                  const Icon = cfg.icon;
                  const detail = formatEventData(ev.data);
                  // A message is shown whole, as typed: third-party text, rendered as text only (never markup).
                  const isMessage = eventChannel(ev) !== null && eventChannel(ev) !== "note";
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
    </div>
  );
}
