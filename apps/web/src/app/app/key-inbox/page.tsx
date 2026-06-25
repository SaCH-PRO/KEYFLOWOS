"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Inbox,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  CalendarDays,
  Bot,
  Tag,
  AlertTriangle,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { getChannelIcon } from "@/lib/channel-icons";
import { KEY_INBOX_CHANNEL_OPTIONS, normalizeFrontendChannel } from "@/lib/key-inbox/channels";
import {
  fetchThreads,
  fetchThread,
  updateThread,
  replyToThread,
  analyzeThread,
  executeThreadAction,
  fetchThreadTimeline,
  type KeyInboxThread,
  type KeyInboxMessage,
  type KeyInboxSuggestedAction,
} from "@/lib/api/key-inbox";
import { StandardModuleLayout } from "@/components/ui/standard-module-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/app/app/finance/components/confirm-dialog";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "WAITING", label: "Waiting" },
  { value: "DONE", label: "Done" },
  { value: "ARCHIVED", label: "Archived" },
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "LOW", label: "Low" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const CHANNEL_OPTIONS = KEY_INBOX_CHANNEL_OPTIONS;

const INTENT_OPTIONS = [
  { value: "", label: "All intents" },
  { value: "lead_inquiry", label: "Lead" },
  { value: "invoice_request", label: "Invoice" },
  { value: "booking_request", label: "Booking" },
  { value: "support_request", label: "Support" },
  { value: "complaint", label: "Complaint" },
  { value: "pricing_question", label: "Pricing" },
  { value: "general", label: "General" },
];

const URGENCY_OPTIONS = [
  { value: "", label: "All urgencies" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const SENTIMENT_OPTIONS = [
  { value: "", label: "All sentiments" },
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "negative", label: "Negative" },
];

const SEND_STATUS_OPTIONS = [
  { value: "", label: "All send statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "QUEUED", label: "Sending" },
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
  { value: "NOT_SUPPORTED", label: "Not supported" },
];

function relativeTime(dateStr?: string | null) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

export default function KeyInboxPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId();

  const [threads, setThreads] = useState<KeyInboxThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<KeyInboxThread | null>(null);
  const [timeline, setTimeline] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    action: KeyInboxSuggestedAction;
    index: number;
    messageId?: string;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmForm, setConfirmForm] = useState({ title: "", dueDate: "", content: "" });

  const searchParams = useSearchParams();
  const initialFilters = useMemo(
    () => ({
      channel: normalizeFrontendChannel(searchParams.get("channel")),
      status: searchParams.get("status") ?? "OPEN",
      priority: searchParams.get("priority") ?? "",
      intent: searchParams.get("intent") ?? "",
      urgency: searchParams.get("urgency") ?? "",
      sentiment: searchParams.get("sentiment") ?? "",
      sendStatus: searchParams.get("sendStatus") ?? "",
      search: searchParams.get("search") ?? "",
    }),
    [searchParams],
  );
  const [filters, setFilters] = useState(initialFilters);

  const loadThreads = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await fetchThreads(businessId, {
      channel: filters.channel || undefined,
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      intent: filters.intent || undefined,
      urgency: filters.urgency || undefined,
      sentiment: filters.sentiment || undefined,
      sendStatus: filters.sendStatus || undefined,
      search: filters.search || undefined,
      limit: 50,
    });
    if (error) {
      toast.error(error);
    } else {
      setThreads(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, filters.channel, filters.status, filters.priority, filters.intent, filters.urgency, filters.sentiment, filters.sendStatus]);

  // Debounce search
  useEffect(() => {
    if (!businessId) return;
    const timer = setTimeout(() => loadThreads(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, filters.search]);

  const selectThread = async (thread: KeyInboxThread) => {
    if (!businessId) return;
    setDetailLoading(true);
    const [{ data }, { data: events }] = await Promise.all([
      fetchThread(businessId, thread.id),
      fetchThreadTimeline(businessId, thread.id),
    ]);
    if (data) {
      setSelectedThread(data);
      setTimeline(events ?? []);
    } else {
      toast.error("Failed to load thread");
    }
    setDetailLoading(false);
  };

  const closeThread = () => {
    setSelectedThread(null);
    setTimeline([]);
  };

  const handleUpdateThread = async (patch: { status?: string; priority?: string }) => {
    if (!businessId || !selectedThread) return;
    const { data, error } = await updateThread(businessId, selectedThread.id, patch);
    if (error || !data) {
      toast.error(error ?? "Update failed");
      return;
    }
    setSelectedThread({ ...selectedThread, ...data });
    await loadThreads();
  };

  const handleReply = async (mode: "draft" | "send") => {
    if (!businessId || !selectedThread || !replyText.trim()) return;
    setSendingReply(true);
    const { data, error } = await replyToThread(businessId, selectedThread.id, replyText.trim(), mode);
    if (error || !data) {
      toast.error(error ?? "Failed to save reply");
    } else {
      setReplyText("");
      setSelectedThread({ ...selectedThread, messages: [data.message, ...(selectedThread.messages ?? [])] });
      await loadThreads();
      if (mode === "send" && data.sendResult && !data.sendResult.success) {
        toast.error(data.sendResult.error ?? "Reply could not be sent");
      } else {
        toast.success(mode === "send" ? "Reply sent" : "Draft saved");
      }
    }
    setSendingReply(false);
  };

  const handleRetry = async (message: KeyInboxMessage) => {
    if (!businessId || !selectedThread || !message.contentText?.trim()) return;
    setSendingReply(true);
    const { data, error } = await replyToThread(businessId, selectedThread.id, message.contentText.trim(), "send");
    if (error || !data) {
      toast.error(error ?? "Retry failed");
    } else {
      setSelectedThread({ ...selectedThread, messages: [data.message, ...(selectedThread.messages ?? [])] });
      await loadThreads();
      if (data.sendResult && !data.sendResult.success) {
        toast.error(data.sendResult.error ?? "Retry could not be sent");
      } else {
        toast.success("Retry sent");
      }
    }
    setSendingReply(false);
  };

  const handleAnalyze = async () => {
    if (!businessId || !selectedThread) return;
    setAnalyzing(true);
    const { data, error } = await analyzeThread(businessId, selectedThread.id);
    if (error || !data) {
      toast.error(error ?? "Analysis failed");
    } else {
      setSelectedThread({ ...selectedThread, ...data });
      toast.success("Analysis refreshed");
    }
    setAnalyzing(false);
  };

  const openConfirmAction = (action: KeyInboxSuggestedAction, index: number, messageId?: string) => {
    setConfirmAction({ action, index, messageId });
    setConfirmForm({
      title: typeof action.payload?.title === "string" ? action.payload.title : "",
      dueDate:
        typeof action.payload?.dueDate === "string"
          ? action.payload.dueDate.slice(0, 16)
          : "",
      content:
        typeof action.payload?.draft === "string"
          ? action.payload.draft
          : typeof action.payload?.content === "string"
            ? action.payload.content
            : "",
    });
  };

  const handleConfirmAction = async () => {
    if (!businessId || !selectedThread || !confirmAction) return;
    const { action, index, messageId } = confirmAction;
    const actionKey = `${messageId ?? "thread"}-${index}`;
    setConfirmLoading(true);
    setExecutingAction(actionKey);

    const payloadOverride: Record<string, unknown> = {};
    if (action.type === "create_task" || action.type === "schedule_followup") {
      if (confirmForm.title.trim()) payloadOverride.title = confirmForm.title.trim();
      if (confirmForm.dueDate) payloadOverride.dueDate = new Date(confirmForm.dueDate).toISOString();
    }
    if (action.type === "draft_reply" && confirmForm.content.trim()) {
      payloadOverride.draft = confirmForm.content.trim();
      payloadOverride.content = confirmForm.content.trim();
    }

    const { data, error } = await executeThreadAction(businessId, selectedThread.id, index, messageId, payloadOverride);
    if (error || !data) {
      toast.error(error ?? "Action failed");
    } else {
      setConfirmAction(null);
      if (data.redirectUrl) {
        router.push(data.redirectUrl);
      } else {
        toast.success(data.message);
        await selectThread(selectedThread);
        await loadThreads();
      }
    }
    setConfirmLoading(false);
    setExecutingAction(null);
  };

  const handleExecuteAction = (action: KeyInboxSuggestedAction, index: number, messageId?: string) => {
    openConfirmAction(action, index, messageId);
  };

  const metrics = useMemo(() => {
    const total = threads.length;
    const urgent = threads.filter((t) => t.aiUrgency === "urgent" || t.priority === "URGENT").length;
    const leads = threads.filter((t) => t.aiIntent === "lead_inquiry").length;
    return { total, urgent, leads };
  }, [threads]);

  const FilterSelect = ({
    value,
    onChange,
    options,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
  }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2.5 py-1.5 kf-radius-md kf-text-caption bg-muted/30 border border-border/20 text-foreground/80 min-w-[110px]"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  const ThreadRow = ({ thread }: { thread: KeyInboxThread }) => {
    const { icon: Icon, label, color } = getChannelIcon(thread.channel);
    const isSelected = selectedThread?.id === thread.id;
    return (
      <button
        onClick={() => selectThread(thread)}
        className={`w-full text-left px-3 py-3 border-b border-border/10 transition-colors hover:bg-muted/20 ${
          isSelected ? "bg-muted/30" : ""
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-8 h-8 kf-radius-md flex items-center justify-center flex-shrink-0"
            style={{ background: `${color}20` }}
          >
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="kf-text-caption font-medium text-foreground truncate">{thread.subject || label}</span>
              <span className="kf-text-micro text-muted-foreground whitespace-nowrap">{relativeTime(thread.lastMessageAt)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {thread.aiIntent && <Badge variant="secondary">{thread.aiIntent.replace(/_/g, " ")}</Badge>}
              {thread.aiUrgency && thread.aiUrgency !== "normal" && (
                <Badge variant={thread.aiUrgency === "urgent" || thread.aiUrgency === "high" ? "destructive" : "outline"}>
                  {thread.aiUrgency}
                </Badge>
              )}
              <StatusBadge status={thread.status.toLowerCase()} size="sm" />
            </div>
          </div>
        </div>
      </button>
    );
  };

  const MessageBubble = ({ message }: { message: KeyInboxMessage }) => {
    const isOutbound = message.direction === "OUTBOUND";
    return (
      <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[85%] kf-radius-lg px-3 py-2.5 ${
            isOutbound ? "bg-[hsl(var(--kf-accent1))]/10 text-foreground" : "bg-muted/40 text-foreground"
          }`}
        >
          <div className="kf-text-caption whitespace-pre-wrap">{message.contentText}</div>
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 space-y-1">
              {message.attachments.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block kf-text-micro text-[hsl(var(--kf-accent1))] hover:underline truncate"
                >
                  {a.type}: {a.url}
                </a>
              ))}
            </div>
          )}
          <div className={`mt-1 kf-text-micro text-muted-foreground ${isOutbound ? "text-right" : ""}`}>
            {formatDateTime(message.receivedAt ?? message.sentAt ?? message.createdAt)}
            {isOutbound && message.sendStatus && (
              <span className="ml-2 inline-flex items-center gap-1.5">
                {message.sendStatus === "SENT" && <span className="text-emerald-400">✓ Sent</span>}
                {message.sendStatus === "DRAFT" && <span>Draft</span>}
                {message.sendStatus === "QUEUED" && <span>Sending...</span>}
                {message.sendStatus === "FAILED" && (
                  <>
                    <span className="text-destructive">Failed: {message.sendError ?? "send error"}</span>
                    <button
                      onClick={() => handleRetry(message)}
                      disabled={sendingReply}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 kf-radius-md bg-muted/50 hover:bg-muted/70 text-foreground disabled:opacity-50"
                      title="Retry sending this reply"
                    >
                      {sendingReply ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Retry
                    </button>
                  </>
                )}
                {message.sendStatus === "NOT_SUPPORTED" && (
                  <span className="text-amber-400">Sending not enabled for this channel</span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ActionButton = ({
    action,
    index,
    messageId,
  }: {
    action: KeyInboxSuggestedAction;
    index: number;
    messageId?: string;
  }) => {
    const actionKey = `${messageId ?? "thread"}-${index}`;
    const isLoading = executingAction === actionKey;
    return (
      <button
        key={index}
        disabled={isLoading}
        onClick={() => handleExecuteAction(action, index, messageId)}
        className="w-full text-left px-3 py-2 kf-radius-md border border-border/20 bg-card/40 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="kf-text-caption font-medium">{action.label}</div>
            <div className="kf-text-micro text-muted-foreground">{action.type.replace(/_/g, " ")}</div>
          </div>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>
    );
  };

  const threadList = (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border/20 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect value={filters.channel} onChange={(v) => setFilters((f) => ({ ...f, channel: v }))} options={CHANNEL_OPTIONS} placeholder="Channel" />
          <FilterSelect value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} options={STATUS_OPTIONS} placeholder="Status" />
          <FilterSelect value={filters.priority} onChange={(v) => setFilters((f) => ({ ...f, priority: v }))} options={PRIORITY_OPTIONS} placeholder="Priority" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect value={filters.intent} onChange={(v) => setFilters((f) => ({ ...f, intent: v }))} options={INTENT_OPTIONS} placeholder="Intent" />
          <FilterSelect value={filters.urgency} onChange={(v) => setFilters((f) => ({ ...f, urgency: v }))} options={URGENCY_OPTIONS} placeholder="Urgency" />
          <FilterSelect value={filters.sentiment} onChange={(v) => setFilters((f) => ({ ...f, sentiment: v }))} options={SENTIMENT_OPTIONS} placeholder="Sentiment" />
          <FilterSelect value={filters.sendStatus} onChange={(v) => setFilters((f) => ({ ...f, sendStatus: v }))} options={SEND_STATUS_OPTIONS} placeholder="Send status" />
        </div>
        <input
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Search subject, sender, message..."
          className="w-full px-3 py-1.5 kf-radius-md kf-text-caption bg-muted/30 border border-border/20 text-foreground/80"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && threads.length === 0 && (
          <div className="p-4">
            <SkeletonList rows={6} cols={3} />
          </div>
        )}
        {!loading && threads.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={Inbox}
              title="No threads yet"
              description="Connect channels in Key Connect to start seeing messages here."
              actionLabel="Key Connect"
              actionIcon={ShieldCheck}
              onAction={() => router.push("/app/key-connect")}
              variant="compact"
            />
          </div>
        )}
        {threads.map((thread) => (
          <ThreadRow key={thread.id} thread={thread} />
        ))}
      </div>
    </div>
  );

  const detailPanel = selectedThread ? (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/20">
        <div className="flex items-center gap-2">
          <button onClick={closeThread} className="md:hidden p-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="kf-text-body font-semibold truncate">{selectedThread.subject || "Thread"}</h2>
            <p className="kf-text-micro text-muted-foreground">
              {getChannelIcon(selectedThread.channel).label} · {relativeTime(selectedThread.lastMessageAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedThread.status}
            onChange={(e) => handleUpdateThread({ status: e.target.value })}
            className="px-2 py-1 kf-radius-md kf-text-micro bg-muted/30 border border-border/20"
          >
            {STATUS_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={selectedThread.priority}
            onChange={(e) => handleUpdateThread({ priority: e.target.value })}
            className="px-2 py-1 kf-radius-md kf-text-micro bg-muted/30 border border-border/20"
          >
            {PRIORITY_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* AI Summary */}
        <div className="kf-card kf-radius-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              <h3 className="kf-text-emphasis font-semibold">AI Summary</h3>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="inline-flex items-center gap-1 px-2 py-1 kf-radius-md kf-text-micro bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Re-analyze"}
            </button>
          </div>
          <p className="kf-text-body text-foreground/90">{selectedThread.aiSummary || "No summary yet."}</p>
          <div className="flex flex-wrap gap-2">
            {selectedThread.aiIntent && <Badge variant="secondary"><Tag className="w-3 h-3 mr-1" />{selectedThread.aiIntent.replace(/_/g, " ")}</Badge>}
            {selectedThread.aiSentiment && <Badge variant="outline">{selectedThread.aiSentiment}</Badge>}
            {selectedThread.aiUrgency && (
              <Badge variant={selectedThread.aiUrgency === "urgent" || selectedThread.aiUrgency === "high" ? "destructive" : "outline"}>
                {selectedThread.aiUrgency}
              </Badge>
            )}

          </div>
        </div>

        {/* Suggested actions from thread */}
        {selectedThread.messages && selectedThread.messages.length > 0 && (
          <SuggestedActionsPanel
            messages={selectedThread.messages}
            onExecute={handleExecuteAction}
            executingAction={executingAction}
          />
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <div className="kf-card kf-radius-lg p-4 space-y-2">
            <h3 className="kf-text-emphasis font-semibold flex items-center gap-2">
              <CalendarDays className="w-4 h-4" /> Timeline
            </h3>
            <div className="space-y-2">
              {timeline.map((event, i) => (
                <div key={i} className="flex items-start gap-2 kf-text-caption">
                  <span className="text-muted-foreground whitespace-nowrap">{formatDateTime(String(event.createdAt ?? ""))}</span>
                  <span className="text-foreground/80">{String(event.eventType ?? event.action ?? "event")}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="space-y-3">
          <h3 className="kf-text-emphasis font-semibold">Messages</h3>
          {(selectedThread.messages ?? []).map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      </div>

      {/* Reply composer */}
      <div className="p-3 border-t border-border/20 bg-card/30">
        <div className="flex items-end gap-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type a reply..."
            rows={2}
            className="flex-1 px-3 py-2 kf-radius-md kf-text-body bg-muted/30 border border-border/20 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleReply("send");
              }
            }}
          />
          <button
            onClick={() => handleReply("draft")}
            disabled={!replyText.trim() || sendingReply}
            className="px-3 py-2 kf-radius-md kf-text-caption font-medium bg-muted/50 hover:bg-muted/70 text-foreground disabled:opacity-50 inline-flex items-center gap-1"
          >
            {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Draft
          </button>
          <button
            onClick={() => handleReply("send")}
            disabled={!replyText.trim() || sendingReply}
            className="px-3 py-2 kf-radius-md kf-text-caption font-medium bg-[hsl(var(--kf-accent1))] text-white disabled:opacity-50 inline-flex items-center gap-1"
          >
            {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className="hidden md:flex flex-col items-center justify-center h-full text-center p-8">
      <Inbox className="w-12 h-12 text-muted-foreground/30 mb-3" />
      <h3 className="kf-text-emphasis font-semibold">Select a thread</h3>
      <p className="kf-text-caption text-muted-foreground mt-1">Choose an item from the list to view messages and AI insights.</p>
    </div>
  );

  return (
    <StandardModuleLayout
      workspace="inbox"
      icon={Inbox}
      title="Key Inbox"
      subtitle="Unified omnichannel command center"
      headerRight={
        <div className="flex items-center gap-2">
          <Link
            href="/app/key-inbox/brief"
            className="inline-flex items-center gap-1 px-3 py-1.5 kf-radius-md kf-text-caption font-medium bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Brief
          </Link>
          <button
            onClick={loadThreads}
            disabled={loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 kf-radius-md kf-text-caption font-medium bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      }
      metricStrip={
        <div className="grid grid-cols-3 gap-3">
          <div className="kf-card kf-radius-lg p-3 text-center">
            <div className="kf-text-micro text-muted-foreground">Threads</div>
            <div className="text-xl font-semibold">{metrics.total}</div>
          </div>
          <div className="kf-card kf-radius-lg p-3 text-center">
            <div className="kf-text-micro text-muted-foreground">Urgent</div>
            <div className="text-xl font-semibold text-destructive">{metrics.urgent}</div>
          </div>
          <div className="kf-card kf-radius-lg p-3 text-center">
            <div className="kf-text-micro text-muted-foreground">Leads</div>
            <div className="text-xl font-semibold">{metrics.leads}</div>
          </div>
        </div>
      }
    >
      <div className="h-[calc(100vh-14rem)] md:h-[calc(100vh-16rem)] -mx-4 -mb-4 border-t border-border/20">
        <div className="h-full flex">
          <div className={`w-full md:w-80 lg:w-96 border-r border-border/20 ${selectedThread ? "hidden md:flex" : "flex"}`}>
            {threadList}
          </div>
          <div className={`flex-1 min-w-0 ${selectedThread ? "flex" : "hidden md:flex"}`}>
            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[hsl(var(--kf-accent1))]" />
              </div>
            ) : (
              detailPanel
            )}
          </div>
        </div>
      </div>
      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          title={confirmAction.action.label}
          description={
            confirmAction.action.type === "create_task"
              ? "Review the task details before creating it."
              : confirmAction.action.type === "schedule_followup"
                ? "Review the follow-up details before scheduling."
                : confirmAction.action.type === "draft_reply"
                  ? "Review and edit the AI draft before saving."
                  : confirmAction.action.type === "create_contact"
                    ? selectedThread?.contactId
                      ? "A contact is already linked to this thread. No new contact will be created."
                      : "Create a new contact from this conversation."
                    : confirmAction.action.type === "create_invoice"
                      ? "You will be redirected to create an invoice."
                      : confirmAction.action.type === "create_booking"
                        ? "You will be redirected to create a booking."
                        : `Run the suggested action: ${confirmAction.action.type.replace(/_/g, " ")}.`
          }
          confirmLabel={
            confirmAction.action.type === "create_invoice"
              ? "Create Invoice"
              : confirmAction.action.type === "create_booking"
                ? "Create Booking"
                : confirmAction.action.type === "create_contact"
                  ? "Create Contact"
                  : "Confirm"
          }
          cancelLabel="Cancel"
          variant="primary"
          onConfirm={handleConfirmAction}
          onCancel={() => setConfirmAction(null)}
          loading={confirmLoading}
        >
          {(confirmAction.action.type === "create_task" || confirmAction.action.type === "schedule_followup") && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
                <input
                  type="text"
                  value={confirmForm.title}
                  onChange={(e) => setConfirmForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Due date</label>
                <input
                  type="datetime-local"
                  value={confirmForm.dueDate}
                  onChange={(e) => setConfirmForm((f) => ({ ...f, dueDate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-xs"
                />
              </div>
            </div>
          )}
          {confirmAction.action.type === "draft_reply" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Draft content</label>
              <textarea
                value={confirmForm.content}
                onChange={(e) => setConfirmForm((f) => ({ ...f, content: e.target.value }))}
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-xs resize-none"
              />
            </div>
          )}
        </ConfirmDialog>
      )}
    </StandardModuleLayout>
  );
}

function SuggestedActionsPanel({
  messages,
  onExecute,
  executingAction,
}: {
  messages: KeyInboxMessage[];
  onExecute: (action: KeyInboxSuggestedAction, index: number, messageId?: string) => void;
  executingAction: string | null;
}) {
  const rows: { messageId?: string; actions: KeyInboxSuggestedAction[] }[] = [];
  for (const message of messages) {
    if (message.suggestedActions && message.suggestedActions.length > 0) {
      rows.push({ messageId: message.id, actions: message.suggestedActions });
    }
  }
  if (rows.length === 0) return null;

  return (
    <div className="kf-card kf-radius-lg p-4 space-y-3">
      <h3 className="kf-text-emphasis font-semibold flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-[hsl(var(--kf-accent2))]" /> Suggested actions
      </h3>
      <div className="space-y-2">
        {rows.map((row) =>
          row.actions.map((action, idx) => {
            const key = `${row.messageId ?? "thread"}-${idx}`;
            const isLoading = executingAction === key;
            return (
              <button
                key={key}
                disabled={isLoading}
                onClick={() => onExecute(action, idx, row.messageId)}
                className="w-full text-left px-3 py-2 kf-radius-md border border-border/20 bg-card/40 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="kf-text-caption font-medium">{action.label}</div>
                    <div className="kf-text-micro text-muted-foreground">{action.type.replace(/_/g, " ")}</div>
                  </div>
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
