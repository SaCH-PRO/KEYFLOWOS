"use client";

import React, { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  CheckCircle2,
  Clock,
  Eye,
  Pause,
  Play,
  Settings,
  MessageSquare,
  Gift,
  DollarSign,
  Bell,
  Sparkles,
  X,
  Copy,
  Mail,
  Phone,
  Loader2,
  ChevronDown,
  ChevronUp,
  Star,
  Users,
  Heart,
  RotateCcw,
} from "lucide-react";
import { generateAutopilotDraft, executeAutopilotAction } from "@/lib/client";
import type { AutopilotDraft } from "@/lib/client";

export interface AutopilotAction {
  id: string;
  type: "follow_up" | "birthday" | "payment_reminder" | "check_in" | "offer" | "review_request" | "referral_request" | "thank_you" | "re_engage";
  status: "completed" | "pending" | "needs_approval";
  contactName: string;
  contactId: string;
  contactPhone?: string;
  contactEmail?: string;
  description: string;
  scheduledAt?: string;
  completedAt?: string;
}

interface AutopilotActionsProps {
  actions: AutopilotAction[];
  isPaused?: boolean;
  businessId?: string;
  onTogglePause?: () => void;
  onApprove?: (actionId: string) => Promise<void>;
  onDeny?: (actionId: string) => Promise<void>;
  onViewContact?: (contactId: string) => void;
  onOpenSettings?: () => void;
}

const ACTION_ICONS: Record<AutopilotAction["type"], typeof MessageSquare> = {
  follow_up: MessageSquare,
  birthday: Gift,
  payment_reminder: DollarSign,
  check_in: Bell,
  offer: Gift,
  review_request: Star,
  referral_request: Users,
  thank_you: Heart,
  re_engage: RotateCcw,
};

const ACTION_LABELS: Record<AutopilotAction["type"], string> = {
  follow_up: "Follow Up",
  birthday: "Birthday",
  payment_reminder: "Payment",
  check_in: "Check In",
  offer: "Offer",
  review_request: "Review",
  referral_request: "Referral",
  thank_you: "Thank You",
  re_engage: "Re-engage",
};

const TONE_COLORS: Record<string, string> = {
  warm: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  professional: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  friendly: "bg-green-500/15 text-green-400 border-green-500/20",
  urgent: "bg-red-500/15 text-red-400 border-red-500/20",
  celebratory: "bg-purple-500/15 text-purple-400 border-purple-500/20",
};

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } },
  item: { hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } } },
};

function DraftPreview({ draft, onSendWhatsApp, onSendEmail, onMarkDone, onCopy, sending }: {
  draft: AutopilotDraft;
  onSendWhatsApp: () => void;
  onSendEmail: () => void;
  onMarkDone: () => void;
  onCopy: () => void;
  sending: boolean;
}) {
  const toneClass = TONE_COLORS[draft.tone] || TONE_COLORS.warm;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3 }}
      className="overflow-hidden"
    >
      <div className="mt-2.5 p-3 rounded-lg border border-[hsl(var(--kf-accent2))]/20 bg-[hsl(var(--kf-accent2))]/[0.03]">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--kf-accent2))]/80">AI Draft</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${toneClass}`}>
            {draft.tone}
          </span>
          <span className="text-[10px] text-muted-foreground/50 ml-auto flex items-center gap-1">
            {draft.suggestedChannel === "whatsapp" ? <Phone className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
            {draft.suggestedChannel === "whatsapp" ? "WhatsApp" : "Email"}
          </span>
        </div>

        {draft.subject && (
          <p className="text-xs font-medium text-foreground/80 mb-1">
            {draft.subject}
          </p>
        )}
        <p className="text-xs text-muted-foreground/80 leading-relaxed whitespace-pre-wrap">
          {draft.message}
        </p>

        <div className="flex items-center gap-1.5 mt-3">
          <button
            onClick={onSendWhatsApp}
            disabled={sending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20 transition-all disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
            Open WhatsApp
          </button>
          <button
            onClick={onSendEmail}
            disabled={sending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold rounded-lg bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border border-blue-500/20 transition-all disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
            Open Email
          </button>
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg hover:bg-white/[0.06] text-muted-foreground/60 transition-all"
          >
            <Copy className="w-3 h-3" />
            Copy
          </button>
          <button
            onClick={onMarkDone}
            disabled={sending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold rounded-lg bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/25 border border-[hsl(var(--kf-accent2))]/20 transition-all disabled:opacity-50 ml-auto"
          >
            <CheckCircle2 className="w-3 h-3" />
            Mark Done
          </button>
        </div>
      </div>
    </motion.div>
  );
}

const ApprovalCard = React.memo(function ApprovalCard({
  action, approving, drafts, draftLoading, businessId: _businessId,
  onApprove, onDeny, onViewContact, onGenerateDraft, onExecute,
}: {
  action: AutopilotAction;
  approving: string | null;
  drafts: Record<string, AutopilotDraft>;
  draftLoading: Record<string, boolean>;
  businessId?: string;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onViewContact: (id: string) => void;
  onGenerateDraft: (action: AutopilotAction) => void;
  onExecute: (action: AutopilotAction, channel: string, message: string) => void;
}) {
  const Icon = ACTION_ICONS[action.type];
  const isApproving = approving === action.id;
  const draft = drafts[action.id];
  const isLoadingDraft = draftLoading[action.id];
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  const handleGenerateDraft = useCallback(() => {
    setExpanded(true);
    if (!draft) {
      onGenerateDraft(action);
    }
  }, [action, draft, onGenerateDraft]);

  const handleSendWhatsApp = useCallback(async () => {
    if (!draft) return;
    setSending(true);
    const phone = (action.contactPhone || "").replace(/[^0-9+]/g, "");
    const text = encodeURIComponent(draft.message);
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank");
    onExecute(action, "whatsapp", draft.message);
    setSending(false);
    setDone(true);
  }, [action, draft, onExecute]);

  const handleSendEmail = useCallback(async () => {
    if (!draft) return;
    setSending(true);
    const email = action.contactEmail || "";
    const subject = encodeURIComponent(draft.subject);
    const body = encodeURIComponent(draft.message);
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
    onExecute(action, "email", draft.message);
    setSending(false);
    setDone(true);
  }, [action, draft, onExecute]);

  const handleMarkDone = useCallback(async () => {
    if (!draft) return;
    setSending(true);
    onExecute(action, "manual", draft.message);
    setSending(false);
    setDone(true);
  }, [action, draft, onExecute]);

  const handleCopy = useCallback(() => {
    if (!draft) return;
    navigator.clipboard.writeText(draft.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [draft]);

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{ delay: 0.5, duration: 0.3 }}
        className="rounded-xl border border-[hsl(var(--kf-accent2))]/30 bg-[hsl(var(--kf-accent2))]/[0.06] p-3"
      >
        <div className="flex items-center gap-2 text-[hsl(var(--kf-accent2))]">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">Done — {action.contactName}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={stagger.item}
      layout
      className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/[0.06] transition-all p-3"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
          <Icon className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <button
              onClick={() => onViewContact(action.contactId)}
              className="text-sm font-semibold hover:text-[hsl(var(--kf-accent1))] transition-colors truncate"
            >
              {action.contactName}
            </button>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400">
              {ACTION_LABELS[action.type]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">{action.description}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleGenerateDraft}
            disabled={isLoadingDraft}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/20 border border-[hsl(var(--kf-accent2))]/20 transition-all disabled:opacity-50"
          >
            {isLoadingDraft ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <Sparkles className="w-3 h-3" />
                <span className="hidden sm:inline">{draft ? "View" : "AI Draft"}</span>
                <span className="sm:hidden">{draft ? "" : "AI"}</span>
              </>
            )}
            {expanded ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
          </button>
          <button
            onClick={() => onApprove(action.id)}
            disabled={isApproving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]/80 text-white hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm"
          >
            {isApproving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3" />
                <span className="hidden sm:inline">Approve</span>
              </>
            )}
          </button>
          <button
            onClick={() => onDeny(action.id)}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
            aria-label="Skip action"
          >
            <X className="w-4 h-4 text-muted-foreground/50 hover:text-muted-foreground" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && isLoadingDraft && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 p-3 rounded-lg border border-border/30 bg-white/[0.02] space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))] animate-spin" />
                <span className="text-xs text-muted-foreground/60">Generating AI draft...</span>
              </div>
              <div className="space-y-1.5">
                <div className="h-3 w-2/3 rounded bg-white/[0.04] animate-pulse" />
                <div className="h-3 w-full rounded bg-white/[0.04] animate-pulse" />
                <div className="h-3 w-4/5 rounded bg-white/[0.04] animate-pulse" />
              </div>
            </div>
          </motion.div>
        )}

        {expanded && draft && !isLoadingDraft && (
          <DraftPreview
            draft={draft}
            onSendWhatsApp={handleSendWhatsApp}
            onSendEmail={handleSendEmail}
            onMarkDone={handleMarkDone}
            onCopy={handleCopy}
            sending={sending}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
});

export const AutopilotActions = React.memo(function AutopilotActions({
  actions, isPaused = false, businessId, onTogglePause, onApprove, onDeny, onViewContact, onOpenSettings,
}: AutopilotActionsProps) {
  const [approving, setApproving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AutopilotDraft>>({});
  const [draftLoading, setDraftLoading] = useState<Record<string, boolean>>({});

  const { completedToday, pending, needsApproval } = useMemo(() => ({
    completedToday: actions.filter((a) => a.status === "completed"),
    pending: actions.filter((a) => a.status === "pending"),
    needsApproval: actions.filter((a) => a.status === "needs_approval"),
  }), [actions]);

  const handleApprove = useCallback(async (actionId: string) => {
    if (!onApprove) return;
    setApproving(actionId);
    await onApprove(actionId);
    setApproving(null);
  }, [onApprove]);

  const handleDeny = useCallback((actionId: string) => {
    onDeny?.(actionId);
  }, [onDeny]);

  const handleViewContact = useCallback((contactId: string) => {
    onViewContact?.(contactId);
  }, [onViewContact]);

  const handleGenerateDraft = useCallback(async (action: AutopilotAction) => {
    setDraftLoading((prev) => ({ ...prev, [action.id]: true }));
    try {
      const result = await generateAutopilotDraft(
        action.id,
        {
          type: action.type,
          contactId: action.contactId,
          contactName: action.contactName,
          description: action.description,
        },
        businessId,
      );
      if (result.data) {
        setDrafts((prev) => ({ ...prev, [action.id]: result.data! }));
      }
    } catch (err) {
      console.error("Failed to generate draft:", err);
    } finally {
      setDraftLoading((prev) => ({ ...prev, [action.id]: false }));
    }
  }, [businessId]);

  const handleExecute = useCallback(async (action: AutopilotAction, channel: string, message: string) => {
    try {
      await executeAutopilotAction(
        action.id,
        { contactId: action.contactId, channel, message },
        businessId,
      );
    } catch (err) {
      console.error("Failed to execute action:", err);
    }
  }, [businessId]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="rounded-2xl border border-border/50 bg-card overflow-hidden"
    >
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${
              isPaused
                ? "bg-muted"
                : "bg-gradient-to-br from-[hsl(var(--kf-accent2))]/15 to-[hsl(var(--kf-accent2))]/5"
            }`}>
              <Bot className={`w-4 h-4 ${isPaused ? "text-muted-foreground" : "text-[hsl(var(--kf-accent2))]"}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Autopilot</h3>
                {isPaused && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-muted text-muted-foreground border border-border/50">
                    PAUSED
                  </span>
                )}
                {needsApproval.length > 0 && !isPaused && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/20">
                    <Eye className="w-3 h-3" />
                    {needsApproval.length}
                  </span>
                )}
                {Object.keys(drafts).length > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] border border-[hsl(var(--kf-accent2))]/20">
                    <Sparkles className="w-3 h-3" />
                    {Object.keys(drafts).length}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {completedToday.length} done today • {pending.length} scheduled
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onTogglePause}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg transition-all ${
                isPaused
                  ? "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/25"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {isPaused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/[0.03] transition-all"
              aria-label="Autopilot settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {needsApproval.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-amber-400 to-amber-500/50" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">Needs Approval</span>
            </div>
            <motion.div
              variants={stagger.container}
              initial="hidden"
              animate="visible"
              className="space-y-2"
            >
              {needsApproval.map((action) => (
                <ApprovalCard
                  key={action.id}
                  action={action}
                  approving={approving}
                  drafts={drafts}
                  draftLoading={draftLoading}
                  businessId={businessId}
                  onApprove={handleApprove}
                  onDeny={handleDeny}
                  onViewContact={handleViewContact}
                  onGenerateDraft={handleGenerateDraft}
                  onExecute={handleExecute}
                />
              ))}
            </motion.div>
          </div>
        )}

        {completedToday.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]/30" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Completed Today</span>
            </div>
            <div className="space-y-1">
              {completedToday.slice(0, 4).map((action) => {
                const Icon = ACTION_ICONS[action.type];
                return (
                  <div
                    key={action.id}
                    className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-white/[0.02] transition-colors group"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]/60 shrink-0" />
                    <Icon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    <span className="text-xs text-muted-foreground/70 flex-1 truncate">{action.description}</span>
                    <button
                      onClick={() => handleViewContact(action.contactId)}
                      className="text-[10px] text-muted-foreground/50 hover:text-[hsl(var(--kf-accent1))] transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                    >
                      {action.contactName}
                    </button>
                    {action.completedAt && (
                      <span className="text-[10px] text-muted-foreground/40 shrink-0">
                        {new Date(action.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                );
              })}
              {completedToday.length > 4 && (
                <p className="text-[10px] text-muted-foreground/50 text-center py-1">
                  +{completedToday.length - 4} more completed
                </p>
              )}
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-blue-400 to-blue-500/30" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Scheduled</span>
            </div>
            <div className="space-y-1">
              {pending.slice(0, 4).map((action) => {
                const Icon = ACTION_ICONS[action.type];
                return (
                  <div
                    key={action.id}
                    className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-white/[0.02] transition-colors"
                  >
                    <Clock className="w-3.5 h-3.5 text-blue-400/50 shrink-0" />
                    <Icon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    <span className="text-xs text-muted-foreground/70 flex-1 truncate">{action.description}</span>
                    <button
                      onClick={() => handleViewContact(action.contactId)}
                      className="text-[10px] text-muted-foreground/50 hover:text-[hsl(var(--kf-accent1))] transition-colors shrink-0"
                    >
                      {action.contactName}
                    </button>
                    {action.scheduledAt && (
                      <span className="text-[10px] text-muted-foreground/40 shrink-0">
                        {new Date(action.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                );
              })}
              {pending.length > 4 && (
                <p className="text-[10px] text-muted-foreground/50 text-center py-1">
                  +{pending.length - 4} more scheduled
                </p>
              )}
            </div>
          </div>
        )}

        {actions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground/80">Autopilot Ready</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Actions will appear as your pipeline grows</p>
          </div>
        )}
      </div>
    </motion.div>
  );
});
