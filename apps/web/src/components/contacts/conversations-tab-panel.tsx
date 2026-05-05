"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle,
  Mail,
  Phone,
  Users,
  StickyNote,
  Send,
  Loader2,
  Filter,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  fetchContactConversations,
  markContactConversationsRead,
  sendContactReply,
  subscribeContactConversationStream,
  type ConversationEntry,
} from "@/lib/client";

type Channel = "whatsapp" | "email" | "sms" | "call" | "meeting" | "note";
type Direction = "in" | "out" | "internal";

export interface ContactLite {
  id: string;
  preferredChannel?: string | null;
  whatsappNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
}

interface ConversationsTabPanelProps {
  contact: ContactLite;
  businessId?: string | null;
}

const CHANNEL_META: Record<Channel, { label: string; icon: typeof MessageCircle; color: string; bg: string }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)" },
  email: { label: "Email", icon: Mail, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)" },
  sms: { label: "SMS", icon: MessageCircle, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)" },
  call: { label: "Call", icon: Phone, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)" },
  meeting: { label: "Meeting", icon: Users, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)" },
  note: { label: "Note", icon: StickyNote, color: "hsl(var(--kf-muted-foreground))", bg: "hsl(var(--kf-muted-foreground) / 0.1)" },
};

function bestChannelFor(c: ContactLite): Channel {
  const pref = (c.preferredChannel ?? "").toLowerCase();
  if (pref.includes("whatsapp") && (c.whatsappNumber || c.phone)) return "whatsapp";
  if (pref.includes("email") && c.email) return "email";
  if (pref.includes("sms") && c.phone) return "sms";
  if (pref.includes("call") || pref.includes("phone")) return "call";
  if (c.whatsappNumber || c.phone) return "whatsapp";
  if (c.email) return "email";
  return "note";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffSec = (now - d.getTime()) / 1000;
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return d.toLocaleDateString();
}

function groupByDay(entries: ConversationEntry[]): { day: string; entries: ConversationEntry[] }[] {
  const groups: Record<string, ConversationEntry[]> = {};
  for (const e of entries) {
    const d = new Date(e.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    (groups[key] ??= []).push(e);
  }
  return Object.entries(groups)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({ day, entries: list }));
}

export function ConversationsTabPanel({ contact, businessId }: ConversationsTabPanelProps) {
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [channelFilter, setChannelFilter] = useState<Channel | null>(null);
  const [directionFilter, setDirectionFilter] = useState<Direction | null>(null);
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");

  const [composer, setComposer] = useState("");
  const [composerChannel, setComposerChannel] = useState<Channel>(() => bestChannelFor(contact));
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const businessIdRef = useRef(businessId ?? undefined);
  useEffect(() => {
    businessIdRef.current = businessId ?? undefined;
  }, [businessId]);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async (opts?: { append?: boolean; cursor?: string | null }) => {
    setLoading(true);
    setError(null);
    const res = await fetchContactConversations(contact.id, {
      businessId: businessIdRef.current,
      cursor: opts?.cursor ?? null,
      limit: 50,
      channel: channelFilter,
      direction: directionFilter,
      since: since ? new Date(since).toISOString() : null,
      until: until ? new Date(until).toISOString() : null,
    });
    setLoading(false);
    if (res.error || !res.data) {
      setError(res.error ?? "Failed to load conversations");
      return;
    }
    setEntries((prev) => (opts?.append ? [...prev, ...res.data!.entries] : res.data!.entries));
    setNextCursor(res.data.nextCursor);
    setHasMore(res.data.hasMore);
  }, [contact.id, channelFilter, directionFilter, since, until]);

  // Initial load + reload on filter change.
  useEffect(() => {
    reloadRef.current = () => load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: triggers initial fetch + refetch when filter dependencies change
    void load();
  }, [load]);

  // Mark read when tab is opened (or the entries first arrive).
  useEffect(() => {
    if (entries.length === 0) return;
    void markContactConversationsRead(contact.id, businessIdRef.current);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kf:contact-read", { detail: { contactId: contact.id } }));
    }
  }, [contact.id, entries.length]);

  // Live updates via SSE (with a 30s polling fallback baked in).
  useEffect(() => {
    const cleanup = subscribeContactConversationStream(
      contact.id,
      () => { void reloadRef.current(); },
      businessIdRef.current,
    );
    const interval = setInterval(() => { void reloadRef.current(); }, 30_000);
    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, [contact.id]);

  const handleSend = async () => {
    const body = composer.trim();
    if (!body || sending) return;
    setSending(true);
    setSendStatus(null);
    const res = await sendContactReply(contact.id, { channel: composerChannel, body }, businessIdRef.current);
    setSending(false);
    if (res.error) {
      setSendStatus({ kind: "error", text: res.error });
      return;
    }
    if (res.data && !res.data.ok) {
      setSendStatus({ kind: "error", text: res.data.error ?? "Send failed — message logged for follow-up" });
    } else {
      setSendStatus({ kind: "success", text: "Sent" });
      setComposer("");
    }
    await load();
  };

  const grouped = useMemo(() => groupByDay(entries), [entries]);

  return (
    <div className="px-3 space-y-3">
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
          <Filter className="w-3 h-3" /> Channel
        </span>
        {(["whatsapp", "email", "sms", "call", "note"] as Channel[]).map((ch) => {
          const meta = CHANNEL_META[ch];
          const active = channelFilter === ch;
          return (
            <button
              key={ch}
              onClick={() => setChannelFilter(active ? null : ch)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md border transition-all ${
                active
                  ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10 text-foreground"
                  : "border-border/40 text-muted-foreground hover:bg-white/[0.03]"
              }`}
            >
              <meta.icon className="w-3 h-3" style={{ color: meta.color }} />
              {meta.label}
            </button>
          );
        })}
        <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
          Direction
        </span>
        {([
          { k: "in" as Direction, label: "Inbound", icon: ArrowDown },
          { k: "out" as Direction, label: "Outbound", icon: ArrowUp },
          { k: "internal" as Direction, label: "Notes", icon: StickyNote },
        ]).map(({ k, label, icon: Icon }) => {
          const active = directionFilter === k;
          return (
            <button
              key={k}
              onClick={() => setDirectionFilter(active ? null : k)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md border transition-all ${
                active
                  ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10 text-foreground"
                  : "border-border/40 text-muted-foreground hover:bg-white/[0.03]"
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
        <input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="ml-2 px-1.5 py-0.5 text-[10px] rounded-md bg-white/[0.03] border border-border/40 text-foreground"
          aria-label="Since date"
        />
        <span className="text-[10px] text-muted-foreground/60">→</span>
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="px-1.5 py-0.5 text-[10px] rounded-md bg-white/[0.03] border border-border/40 text-foreground"
          aria-label="Until date"
        />
        <button
          onClick={() => { setChannelFilter(null); setDirectionFilter(null); setSince(""); setUntil(""); }}
          className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5"
        >
          Reset
        </button>
        <button
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-white/[0.03]"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Thread */}
      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}
        {!error && entries.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-1.5 py-10 text-muted-foreground/60">
            <MessageCircle className="w-6 h-6" />
            <p className="text-xs">No messages on this thread yet.</p>
          </div>
        )}
        {grouped.map(({ day, entries: dayEntries }) => (
          <div key={day} className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 sticky top-0 bg-background/80 backdrop-blur-sm py-0.5">
              {new Date(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </div>
            {dayEntries.map((e) => {
              const meta = CHANNEL_META[e.channel];
              const isOut = e.direction === "out";
              const isInternal = e.direction === "internal";
              return (
                <div key={e.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-lg p-2.5 border ${
                    isInternal
                      ? "bg-amber-500/[0.04] border-amber-500/20"
                      : isOut
                        ? "bg-[hsl(var(--kf-accent1))]/[0.06] border-[hsl(var(--kf-accent1))]/20"
                        : "bg-white/[0.03] border-border/40"
                  }`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-md font-medium"
                        style={{ backgroundColor: meta.bg, color: meta.color }}
                      >
                        <meta.icon className="w-2.5 h-2.5" />
                        {meta.label}
                      </span>
                      <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">
                        {isInternal ? "Internal" : isOut ? "Out" : "In"}
                      </span>
                      {e.status && (
                        <span className="text-[9px] text-muted-foreground/50">· {e.status}</span>
                      )}
                      <span className="text-[9px] text-muted-foreground/50 ml-auto">{formatTime(e.timestamp)}</span>
                    </div>
                    <div className="text-xs text-foreground whitespace-pre-wrap break-words">
                      {e.body || <span className="text-muted-foreground/50 italic">(no content)</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {hasMore && (
          <button
            onClick={() => void load({ append: true, cursor: nextCursor })}
            disabled={loading}
            className="w-full py-2 text-[11px] text-muted-foreground hover:text-foreground border border-border/30 rounded-lg hover:bg-white/[0.03] disabled:opacity-40"
          >
            {loading ? "Loading…" : "Load older"}
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border/40 pt-3 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Send via</span>
          {(["whatsapp", "email", "sms", "call", "note"] as Channel[]).map((ch) => {
            const meta = CHANNEL_META[ch];
            const active = composerChannel === ch;
            const isPreferred = bestChannelFor(contact) === ch;
            return (
              <button
                key={ch}
                onClick={() => setComposerChannel(ch)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md border transition-all ${
                  active
                    ? "border-[hsl(var(--kf-accent1))]/60 bg-[hsl(var(--kf-accent1))]/15 text-foreground"
                    : "border-border/40 text-muted-foreground hover:bg-white/[0.03]"
                }`}
                title={isPreferred ? `${meta.label} (recommended)` : meta.label}
              >
                <meta.icon className="w-3 h-3" style={{ color: meta.color }} />
                {meta.label}
                {isPreferred && <span className="text-[8px] text-[hsl(var(--kf-accent2))]">●</span>}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <textarea
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={`Message via ${CHANNEL_META[composerChannel].label}… (⌘/Ctrl+Enter to send)`}
            rows={2}
            className="flex-1 px-2.5 py-2 text-xs rounded-lg bg-white/[0.03] border border-border/40 text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!composer.trim() || sending}
            className="self-end inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:bg-[hsl(var(--kf-accent1))]/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Send
          </button>
        </div>
        {sendStatus && (
          <div className={`flex items-center gap-1.5 text-[10px] ${sendStatus.kind === "success" ? "text-emerald-400" : "text-red-300"}`}>
            {sendStatus.kind === "success" ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {sendStatus.text}
          </div>
        )}
      </div>
    </div>
  );
}
