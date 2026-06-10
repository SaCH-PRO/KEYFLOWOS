"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Mail, Phone, Instagram, Facebook, CheckCircle2, Loader2, Send, RefreshCw, FileText, Sparkles, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPostSimple } from "@/lib/api";
import { ResponseDraftPanel } from "@/components/communications/response-draft-panel";
import { fetchUnifiedInbox, generateReplyDraft, type DraftItem } from "@/lib/api/omnichannel";

interface Thread {
  id: string;
  contact: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
  channel: string;
  channelId: string;
  subject: string | null;
  status: string;
  assignedRole: string | null;
  priority: number;
  lastMessageAt: string | null;
  messages: Array<{ body: string; createdAt: string; direction: string }>;
}

interface ThreadMessage {
  id: string;
  direction: string;
  body: string;
  role: string | null;
  intent: string | null;
  sentiment: string | null;
  aiDraft: boolean;
  aiApproved: boolean;
  createdAt: string;
}

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  whatsapp: MessageSquare,
  email: Mail,
  sms: Phone,
  instagram: Instagram,
  messenger: Facebook,
};

const ROLE_COLORS: Record<string, string> = {
  sales: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  finance: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  support: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  operations: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  marketing: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  general: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

export default function UnifiedInboxPage() {
  const businessId = getStoredBusinessId();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("open");
  const [filterChannel, setFilterChannel] = useState<string>("");
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  // Role filter removed — Key auto-detects role intelligently

  const loadThreads = useCallback(async () => {
    if (!businessId) return;
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterChannel) params.set("channel", filterChannel);
      const [inboxRes, unifiedRes] = await Promise.all([
        apiGet<{ threads: Thread[] }>(`/ai/businesses/${businessId}/inbox?${params}`),
        fetchUnifiedInbox(businessId, { limit: 20 }),
      ]);
      setThreads(inboxRes.data?.threads ?? []);
      setDrafts((unifiedRes.data?.drafts?.items ?? []) as DraftItem[]);
    } catch {
      toast.error("Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [businessId, filterStatus, filterChannel]);

  const loadMessages = async (threadId: string) => {
    if (!businessId) return;
    try {
      const res = await apiGet<{ messages: ThreadMessage[] }>(`/ai/businesses/${businessId}/inbox/${threadId}`);
      setMessages(res.data?.messages ?? []);
    } catch {
      toast.error("Failed to load messages");
    }
  };

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const selectThread = async (thread: Thread) => {
    setSelectedThread(thread);
    await loadMessages(thread.id);
  };

  const sendReply = async () => {
    if (!businessId || !selectedThread || !replyText.trim()) return;
    try {
      await apiPostSimple(`/ai/businesses/${businessId}/inbox/${selectedThread.id}/reply`, { body: replyText });
      setReplyText("");
      await loadMessages(selectedThread.id);
      await loadThreads();
    } catch {
      toast.error("Failed to send reply");
    }
  };

  const handleGenerateReply = async () => {
    if (!businessId || !selectedThread) return;
    setGeneratingDraft(true);
    try {
      const res = await generateReplyDraft(businessId, selectedThread.id);
      if (res.data?.draft) {
        toast.success("Draft generated! Check the drafts panel.");
        await loadThreads();
      } else {
        toast.error("Failed to generate draft");
      }
    } catch {
      toast.error("Failed to generate draft");
    } finally {
      setGeneratingDraft(false);
    }
  };

  const resolveThread = async () => {
    if (!businessId || !selectedThread) return;
    try {
      await apiPostSimple(`/ai/businesses/${businessId}/inbox/${selectedThread.id}/resolve`, {});
      toast.success("Thread resolved");
      setSelectedThread(null);
      setMessages([]);
      await loadThreads();
    } catch {
      toast.error("Failed to resolve thread");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full md:h-[calc(100vh-4rem)] flex -mx-3 -mt-3 sm:-mx-4 sm:-mt-4 md:-mx-6 md:-mt-6">
      {/* Sidebar */}
      <div className={`w-full md:w-80 border-r border-border/20 flex flex-col ${selectedThread ? "hidden md:flex" : "flex"}`}>
        {/* Header */}
        <div className="p-2 md:p-4 border-b border-border/20">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
            <h1 className="text-sm font-bold text-foreground/90">Unified Inbox</h1>
            <button
              onClick={() => setShowDrafts((v) => !v)}
              className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                showDrafts
                  ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                  : "text-muted-foreground hover:bg-muted/30"
              }`}
            >
              <FileText className="w-3 h-3" />
              Drafts {drafts.length > 0 && `(${drafts.length})`}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="flex-1 px-2 py-1 rounded-md bg-muted/30 border border-border/20 text-xs text-foreground/70"
            >
              <option value="">All Status</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
            </select>
            <select
              value={filterChannel}
              onChange={(e) => setFilterChannel(e.target.value)}
              className="flex-1 px-2 py-1 rounded-md bg-muted/30 border border-border/20 text-xs text-foreground/70"
            >
              <option value="">All Channels</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="instagram">Instagram</option>
              <option value="messenger">Messenger</option>
            </select>
            <button onClick={loadThreads} className="p-1.5 rounded-md text-muted-foreground/40 hover:text-foreground/70 hover:bg-muted/30 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="text-center py-10">
              <MessageSquare className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/40">No conversations</p>
            </div>
          ) : (
            threads.map((thread) => {
              const ChannelIcon = CHANNEL_ICONS[thread.channel] ?? MessageSquare;
              const lastMsg = thread.messages?.[0];
              return (
                <button
                  key={thread.id}
                  onClick={() => selectThread(thread)}
                  className={`w-full text-left p-2 md:p-3 border-b border-border/10 hover:bg-muted/20 transition-colors ${
                    selectedThread?.id === thread.id ? "bg-muted/30" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <ChannelIcon className="w-3.5 h-3.5 text-muted-foreground/40" />
                    <span className="text-xs font-medium text-foreground/70 truncate">
                      {thread.contact ? `${thread.contact.firstName ?? ""} ${thread.contact.lastName ?? ""}`.trim() || thread.contact.email || thread.contact.phone || "Unknown" : "Unknown"}
                    </span>
                    {thread.assignedRole && (
                      <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium border ${ROLE_COLORS[thread.assignedRole] ?? ROLE_COLORS.general}`}>
                        {thread.assignedRole}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground/50 truncate">{lastMsg?.body ?? "No messages"}</p>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Drafts Panel */}
      {showDrafts && (
        <div className="w-96 border-r border-border/20 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              <h2 className="text-sm font-semibold text-foreground/80">Response Drafts</h2>
              {drafts.length > 0 && (
                <span className="text-xs text-muted-foreground">{drafts.length}</span>
              )}
            </div>
            <button
              onClick={() => setShowDrafts(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Hide
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <ResponseDraftPanel businessId={businessId ?? ""} drafts={drafts} onMutate={loadThreads} />
          </div>
        </div>
      )}

      {/* Thread View */}
      <div className={`flex-1 flex flex-col ${selectedThread ? "flex" : "hidden md:flex"}`}>
        {selectedThread ? (
          <>
            {/* Thread Header */}
            <div className="p-2 md:p-4 border-b border-border/20 flex items-center justify-between">
              <div className="flex items-center min-w-0">
                <button
                  onClick={() => { setSelectedThread(null); setMessages([]); }}
                  className="md:hidden mr-2 p-1 rounded-md hover:bg-muted/30 shrink-0"
                  aria-label="Back to threads"
                >
                  <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                </button>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground/80 truncate">
                  {selectedThread.contact ? `${selectedThread.contact.firstName ?? ""} ${selectedThread.contact.lastName ?? ""}`.trim() || selectedThread.contact.email || "Unknown" : "Unknown"}
                </h2>
                <p className="text-xs text-muted-foreground/40 truncate">
                  {selectedThread.channel} · {selectedThread.channelId}
                </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedThread.assignedRole && (
                  <span className={`px-2 py-1 rounded-md text-[10px] font-medium border ${ROLE_COLORS[selectedThread.assignedRole] ?? ROLE_COLORS.general}`}>
                    {selectedThread.assignedRole}
                  </span>
                )}
                <button
                  onClick={resolveThread}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Resolve
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.direction === "inbound" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[70%] px-3 py-2 rounded-xl text-sm ${
                      msg.direction === "inbound"
                        ? "bg-muted/30 text-foreground/80"
                        : msg.aiDraft
                        ? "border border-dashed border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/5 text-foreground/70"
                        : "bg-[hsl(var(--kf-accent1))]/10 text-foreground/80"
                    }`}
                  >
                    <p>{msg.body}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] text-muted-foreground/40">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {msg.aiDraft && (
                        <span className="text-[10px] text-[hsl(var(--kf-accent1))]">AI Draft</span>
                      )}
                      {msg.role && (
                        <span className="text-[10px] text-muted-foreground/30">· {msg.role}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Reply Box */}
            <div className="p-2 md:p-4 border-t border-border/20">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendReply()}
                  placeholder="Type a reply..."
                  className="flex-1 px-2 md:px-3 py-1.5 md:py-2 rounded-lg bg-muted/30 border border-border/20 text-sm text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                />
                <button
                  onClick={handleGenerateReply}
                  disabled={generatingDraft}
                  className="p-1.5 md:p-2 rounded-lg bg-muted/40 text-muted-foreground hover:text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors disabled:opacity-50 shrink-0"
                  title="Generate AI reply draft"
                >
                  {generatingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </button>
                <button
                  onClick={sendReply}
                  className="p-1.5 md:p-2 rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground/40">Select a conversation to view messages</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
