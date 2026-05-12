"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Inbox as InboxIcon,
  Send,
  Star,
  Archive,
  Trash2,
  Mail,
  MailOpen,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Reply,
  RotateCcw,
  AlertCircle,
  Loader2,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import sanitizeHtml from "sanitize-html";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { useCompose } from "@/components/email/compose-context";

type LabelKey = "INBOX" | "SENT" | "STARRED" | "ARCHIVE" | "TRASH";

interface LabelDef {
  key: LabelKey;
  label: string;
  icon: React.ElementType;
  gmailLabel: string | null;
  query?: string;
}

const LABELS: LabelDef[] = [
  { key: "INBOX", label: "Inbox", icon: InboxIcon, gmailLabel: "INBOX" },
  { key: "SENT", label: "Sent", icon: Send, gmailLabel: "SENT" },
  { key: "STARRED", label: "Starred", icon: Star, gmailLabel: "STARRED" },
  { key: "ARCHIVE", label: "Archive", icon: Archive, gmailLabel: null, query: "-in:inbox -in:sent -in:trash -in:spam" },
  { key: "TRASH", label: "Trash", icon: Trash2, gmailLabel: "TRASH" },
];

interface ThreadListItem {
  id: string;
  snippet?: string;
  historyId?: string;
}

interface ThreadsResponse {
  threads?: ThreadListItem[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePayload {
  headers?: GmailHeader[];
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePayload[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePayload;
}

interface GmailThread {
  id: string;
  snippet?: string;
  messages?: GmailMessage[];
}

interface ThreadSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: number;
  unread: boolean;
  starred: boolean;
  messageCount: number;
}

interface GmailStatus {
  connected: boolean;
  email: string | null;
}

const PAGE_SIZE = 25;

function getHeader(payload: GmailMessagePayload | undefined, name: string): string {
  if (!payload?.headers) return "";
  const h = payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeBase64Url(data: string): string {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof window !== "undefined") {
      const bin = window.atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    }
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractBody(payload: GmailMessagePayload | undefined): { html: string; text: string } {
  if (!payload) return { html: "", text: "" };
  let html = "";
  let text = "";
  const walk = (p: GmailMessagePayload) => {
    if (p.mimeType === "text/html" && p.body?.data) html ||= decodeBase64Url(p.body.data);
    else if (p.mimeType === "text/plain" && p.body?.data) text ||= decodeBase64Url(p.body.data);
    if (p.parts) p.parts.forEach(walk);
  };
  walk(payload);
  return { html, text };
}

function parseFromName(raw: string): string {
  if (!raw) return "Unknown";
  const m = raw.match(/^(.*?)\s*<(.+)>$/);
  if (m) return m[1].replace(/^"|"$/g, "").trim() || m[2];
  return raw;
}

function formatDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? d.toLocaleDateString([], { month: "short", day: "numeric" })
    : d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function summarizeThread(thread: GmailThread): ThreadSummary {
  const msgs = thread.messages ?? [];
  const last = msgs[msgs.length - 1];
  const labelIds = new Set<string>();
  msgs.forEach((m) => (m.labelIds ?? []).forEach((l) => labelIds.add(l)));
  const fromHeader = getHeader(last?.payload, "From");
  return {
    id: thread.id,
    from: parseFromName(fromHeader),
    subject: getHeader(last?.payload, "Subject") || "(no subject)",
    snippet: thread.snippet ?? last?.snippet ?? "",
    date: last?.internalDate ? Number(last.internalDate) : 0,
    unread: labelIds.has("UNREAD"),
    starred: labelIds.has("STARRED"),
    messageCount: msgs.length,
  };
}

export default function InboxPage() {
  const businessId = typeof window !== "undefined" ? getStoredBusinessId() : null;
  const compose = useCompose();
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [activeLabel, setActiveLabel] = useState<LabelKey>("INBOX");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [pageTokens, setPageTokens] = useState<string[]>([""]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [openThread, setOpenThread] = useState<GmailThread | null>(null);
  const [openLoading, setOpenLoading] = useState(false);

  // Status check
  useEffect(() => {
    if (!businessId) { setStatusLoading(false); return; }
    let cancelled = false;
    (async () => {
      const res = await apiGet<GmailStatus>(`/commerce/businesses/${businessId}/gmail/status`);
      if (!cancelled) {
        setStatus(res.data);
        setStatusLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const loadThreads = useCallback(async (label: LabelKey, token: string) => {
    if (!businessId) return;
    setLoadingThreads(true);
    setError(null);
    const def = LABELS.find((l) => l.key === label)!;
    const params = new URLSearchParams();
    params.set("maxResults", String(PAGE_SIZE));
    if (def.gmailLabel) params.set("label", def.gmailLabel);
    if (def.query) params.set("q", def.query);
    if (token) params.set("pageToken", token);

    try {
      const res = await apiGet<ThreadsResponse>(
        `/commerce/businesses/${businessId}/gmail/threads?${params.toString()}`,
      );
      if (res.error) {
        setError(res.error);
        setThreads([]);
        setNextPageToken(undefined);
        return;
      }
      const list = res.data?.threads ?? [];
      setNextPageToken(res.data?.nextPageToken);

      // Hydrate each thread to get headers/labels
      const summaries = await Promise.all(
        list.map(async (t): Promise<ThreadSummary> => {
          const r = await apiGet<GmailThread>(
            `/commerce/businesses/${businessId}/gmail/threads/${encodeURIComponent(t.id)}`,
          );
          if (r.data) return summarizeThread(r.data);
          return {
            id: t.id, from: "—", subject: "(unable to load)",
            snippet: t.snippet ?? "", date: 0, unread: false, starred: false, messageCount: 0,
          };
        }),
      );
      setThreads(summaries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load threads");
      setThreads([]);
    } finally {
      setLoadingThreads(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (status?.connected) loadThreads(activeLabel, pageTokens[pageIndex] ?? "");
  }, [status?.connected, activeLabel, pageIndex, pageTokens, loadThreads]);

  const switchLabel = (key: LabelKey) => {
    setActiveLabel(key);
    setPageTokens([""]);
    setPageIndex(0);
    setOpenThreadId(null);
    setOpenThread(null);
  };

  const goNext = () => {
    if (!nextPageToken) return;
    const newTokens = [...pageTokens.slice(0, pageIndex + 1), nextPageToken];
    setPageTokens(newTokens);
    setPageIndex(pageIndex + 1);
  };
  const goPrev = () => {
    if (pageIndex === 0) return;
    setPageIndex(pageIndex - 1);
  };

  const openThreadById = useCallback(async (id: string) => {
    if (!businessId) return;
    setOpenThreadId(id);
    setOpenLoading(true);
    setOpenThread(null);
    try {
      const r = await apiGet<GmailThread>(
        `/commerce/businesses/${businessId}/gmail/threads/${encodeURIComponent(id)}`,
      );
      if (r.error) toast.error(r.error);
      setOpenThread(r.data ?? null);

      // Auto-mark unread messages as read
      if (r.data?.messages) {
        const unread = r.data.messages.filter((m) => m.labelIds?.includes("UNREAD"));
        if (unread.length > 0) {
          await Promise.all(unread.map((m) =>
            apiPostSimple(`/commerce/businesses/${businessId}/gmail/messages/${encodeURIComponent(m.id)}/read`, {}),
          ));
          setThreads((prev) => prev.map((t) => t.id === id ? { ...t, unread: false } : t));
        }
      }
    } finally {
      setOpenLoading(false);
    }
  }, [businessId]);

  const messageAction = useCallback(async (
    messageId: string,
    action: "read" | "unread" | "star" | "unstar" | "archive" | "trash" | "untrash",
  ) => {
    if (!businessId) return;
    const res = await apiPostSimple(
      `/commerce/businesses/${businessId}/gmail/messages/${encodeURIComponent(messageId)}/${action}`,
      {},
    );
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(action.charAt(0).toUpperCase() + action.slice(1));
    // Refresh open thread if active
    if (openThreadId) {
      const r = await apiGet<GmailThread>(
        `/commerce/businesses/${businessId}/gmail/threads/${encodeURIComponent(openThreadId)}`,
      );
      setOpenThread(r.data ?? null);
    }
    // Reload list if action removed the message from current view
    if (action === "archive" || action === "trash" || action === "untrash") {
      await loadThreads(activeLabel, pageTokens[pageIndex] ?? "");
      if (action === "archive" || action === "trash") {
        setOpenThreadId(null);
        setOpenThread(null);
      }
    }
  }, [businessId, openThreadId, activeLabel, pageTokens, pageIndex, loadThreads]);

  const replyToMessage = (msg: GmailMessage) => {
    const fromHeader = getHeader(msg.payload, "From");
    const subject = getHeader(msg.payload, "Subject");
    const messageIdHeader = getHeader(msg.payload, "Message-ID") || getHeader(msg.payload, "Message-Id");
    const m = fromHeader.match(/<(.+)>/);
    const to = m ? m[1] : fromHeader;
    compose.open({
      to,
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      threadId: msg.threadId,
      inReplyTo: messageIdHeader,
    });
  };

  const refresh = () => loadThreads(activeLabel, pageTokens[pageIndex] ?? "");

  const labelCounts = useMemo(() => {
    const unread = threads.filter((t) => t.unread).length;
    return { unread };
  }, [threads]);

  // Empty / disconnected state
  if (!statusLoading && (!businessId || !status?.connected)) {
    return (
      <WorkspaceShell
        icon={InboxIcon}
        title="Inbox"
        subtitle="Gmail messages"
        iconColor="hsl(var(--kf-accent1))"
      >
        <div className="flex flex-col items-center justify-center text-center py-16 px-4 kf-radius-lg border border-dashed border-border/50">
          <Mail className="w-10 h-10 mb-3 text-muted-foreground" />
          <h3 className="text-base font-semibold mb-1">Gmail not connected</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            Connect your Gmail account on the Connect page to view your inbox here.
          </p>
          <a
            href="/app/connect"
            className="px-4 py-2 text-sm font-medium kf-radius-md"
            style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
          >
            Go to Connect
          </a>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      icon={InboxIcon}
      title="Inbox"
      subtitle={status?.email ? `Gmail · ${status.email}` : "Gmail messages"}
      iconColor="hsl(var(--kf-accent1))"
      headerRight={
        <div className="flex items-center gap-2">
          <button
            onClick={() => compose.open()}
            className="flex items-center gap-1.5 h-9 px-3 kf-radius-md text-xs font-medium"
            style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
            aria-label="Compose new email"
          >
            <Pencil className="w-3.5 h-3.5" />
            Compose
          </button>
          <button
            onClick={refresh}
            disabled={loadingThreads}
            className="flex items-center justify-center w-9 h-9 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingThreads ? "animate-spin" : ""}`} />
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-12 gap-4 mt-2">
        {/* Sidebar */}
        <aside className="col-span-12 md:col-span-2">
          <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {LABELS.map((l) => {
              const Icon = l.icon;
              const active = activeLabel === l.key;
              return (
                <button
                  key={l.key}
                  onClick={() => switchLabel(l.key)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm kf-radius-md transition-colors whitespace-nowrap ${
                    active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{l.label}</span>
                  {active && labelCounts.unread > 0 && (
                    <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 kf-radius-sm"
                      style={{ background: "hsl(var(--kf-accent1) / 0.2)", color: "hsl(var(--kf-accent1))" }}>
                      {labelCounts.unread}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Thread list */}
        <section className={`col-span-12 ${openThreadId ? "md:col-span-4" : "md:col-span-10"}`}>
          {error && (
            <div className="flex items-center gap-2 p-3 mb-3 kf-radius-md text-sm"
              style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          <div className="border border-border/40 kf-radius-lg overflow-hidden bg-background">
            {loadingThreads ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : threads.length === 0 ? (
              <div className="text-center py-16 text-sm text-muted-foreground">No messages</div>
            ) : (
              <ul className="divide-y divide-border/30">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => openThreadById(t.id)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-muted/30 transition-colors flex items-start gap-2 ${
                        openThreadId === t.id ? "bg-muted/40" : ""
                      } ${t.unread ? "" : "opacity-80"}`}
                    >
                      <div className="flex flex-col items-center gap-1 pt-1 flex-shrink-0">
                        {t.unread ? (
                          <span className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-accent1))" }} />
                        ) : (
                          <span className="w-2 h-2" />
                        )}
                        {t.starred && <Star className="w-3 h-3 fill-current" style={{ color: "hsl(var(--kf-warning, 45 100% 55%))" }} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-xs truncate ${t.unread ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                            {t.from}
                            {t.messageCount > 1 && (
                              <span className="ml-1 text-muted-foreground">({t.messageCount})</span>
                            )}
                          </span>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatDate(t.date)}</span>
                        </div>
                        <div className={`text-xs truncate ${t.unread ? "font-medium" : ""}`}>{t.subject}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{t.snippet}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>Page {pageIndex + 1}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={goPrev}
                disabled={pageIndex === 0 || loadingThreads}
                className="flex items-center gap-1 px-2 py-1 kf-radius-md border border-border hover:bg-muted/30 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <button
                onClick={goNext}
                disabled={!nextPageToken || loadingThreads}
                className="flex items-center gap-1 px-2 py-1 kf-radius-md border border-border hover:bg-muted/30 disabled:opacity-40"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* Thread view */}
        {openThreadId && (
          <section className="col-span-12 md:col-span-6">
            <div className="border border-border/40 kf-radius-lg bg-background">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                <h2 className="text-sm font-semibold truncate">
                  {openThread?.messages?.[0] ? getHeader(openThread.messages[0].payload, "Subject") || "(no subject)" : "Loading…"}
                </h2>
                <button
                  onClick={() => { setOpenThreadId(null); setOpenThread(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>

              {openLoading || !openThread ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="divide-y divide-border/30 max-h-[70vh] overflow-y-auto">
                  {(openThread.messages ?? []).map((msg) => {
                    const from = getHeader(msg.payload, "From");
                    const to = getHeader(msg.payload, "To");
                    const dateMs = msg.internalDate ? Number(msg.internalDate) : 0;
                    const isUnread = msg.labelIds?.includes("UNREAD");
                    const isStarred = msg.labelIds?.includes("STARRED");
                    const isTrash = msg.labelIds?.includes("TRASH");
                    const isInbox = msg.labelIds?.includes("INBOX");
                    const { html, text } = extractBody(msg.payload);
                    return (
                      <article key={msg.id} className="p-4">
                        <header className="flex items-start justify-between gap-2 mb-3">
                          <div className="min-w-0 text-xs">
                            <div className="font-semibold truncate">{parseFromName(from)}</div>
                            <div className="text-muted-foreground truncate">to {to}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {dateMs ? new Date(dateMs).toLocaleString() : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <ActionBtn
                              title={isStarred ? "Unstar" : "Star"}
                              onClick={() => messageAction(msg.id, isStarred ? "unstar" : "star")}
                              icon={Star}
                              active={isStarred}
                            />
                            <ActionBtn
                              title={isUnread ? "Mark read" : "Mark unread"}
                              onClick={() => messageAction(msg.id, isUnread ? "read" : "unread")}
                              icon={isUnread ? MailOpen : Mail}
                            />
                            {isInbox && (
                              <ActionBtn title="Archive" onClick={() => messageAction(msg.id, "archive")} icon={Archive} />
                            )}
                            {isTrash ? (
                              <ActionBtn title="Untrash" onClick={() => messageAction(msg.id, "untrash")} icon={RotateCcw} />
                            ) : (
                              <ActionBtn title="Trash" onClick={() => messageAction(msg.id, "trash")} icon={Trash2} />
                            )}
                            <ActionBtn title="Reply" onClick={() => replyToMessage(msg)} icon={Reply} />
                          </div>
                        </header>
                        {html ? (
                          <div
                            className="prose prose-invert prose-sm max-w-none text-sm"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeHtml(html, {
                                allowedTags: sanitizeHtml.defaults.allowedTags.concat(["style", "iframe", "form", "input", "link", "meta", "img", "table", "thead", "tbody", "tr", "th", "td", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "sub", "sup", "ul", "ol", "li", "blockquote", "pre", "code", "a"]),
                                allowedAttributes: {
                                  ...sanitizeHtml.defaults.allowedAttributes,
                                  img: ["src", "alt", "title", "width", "height"],
                                  a: ["href", "target", "rel", "title"],
                                  table: ["width", "border", "cellpadding", "cellspacing"],
                                  th: ["colspan", "rowspan", "width", "align", "valign"],
                                  td: ["colspan", "rowspan", "width", "align", "valign"],
                                  div: ["style", "class"],
                                  span: ["style", "class"],
                                  p: ["style", "class"],
                                  h1: ["style", "class"],
                                  h2: ["style", "class"],
                                  h3: ["style", "class"],
                                  h4: ["style", "class"],
                                  h5: ["style", "class"],
                                  h6: ["style", "class"],
                                },
                              }),
                            }}
                          />
                        ) : (
                          <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-sans">
                            {text || msg.snippet || ""}
                          </pre>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}

              {/* Quick reply box */}
              {openThread?.messages && openThread.messages.length > 0 && (
                <div className="p-3 border-t border-border/30 bg-muted/20">
                  <button
                    onClick={() => replyToMessage(openThread.messages![openThread.messages!.length - 1])}
                    className="w-full flex items-center justify-center gap-2 py-2 text-sm kf-radius-md border border-border hover:bg-muted/30 transition-colors"
                  >
                    <Reply className="w-3.5 h-3.5" />
                    Reply
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}

function ActionBtn({
  title, onClick, icon: Icon, active,
}: {
  title: string;
  onClick: () => void;
  icon: React.ElementType;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`p-1.5 kf-radius-sm transition-colors ${
        active ? "text-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${active ? "fill-current" : ""}`} />
    </button>
  );
}
