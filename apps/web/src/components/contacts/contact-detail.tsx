"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MessageSquare, Sparkles, ChevronUp, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import type { CrossJourneyResponse } from "@/lib/client";
import { apiPost, apiGet } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContactDetailHeader } from "./contact-detail-header";
import { ContactDetailStats, MomentumPrimaryCTA } from "./contact-detail-stats";
import { ContactDetailInfo } from "./contact-detail-info";
import { AiContactSummaryPanel } from "./ai-contact-summary";
import { AiLeadScorePanel } from "./ai-lead-score";
import { AiPrepBriefPanel } from "./ai-prep-brief";
import { AiTagSuggestionsPanel } from "./ai-tag-suggestions";
import { NextBestActionCard } from "./next-best-action-card";
import { ContactInsightCard } from "./contact-insight-card";

export type ContactDetailData = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  industry?: string | null;
  status?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  preferredChannel?: string | null;
  tags?: string[];
  displayName?: string | null;
  secondaryEmail?: string | null;
  secondaryPhone?: string | null;
  whatsappNumber?: string | null;
  language?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  timezone?: string | null;
  segment?: string | null;
  lifecycleStage?: string | null;
  marketingOptIn?: boolean | null;
  doNotContact?: boolean | null;
  notesInternal?: string | null;
  ageGroup?: string | null;

  custom?: Record<string, unknown> | null;
  createdAt?: string | null;
  dataQualityScore?: number | null;
  meta?: {
    leadScore?: number | null;
    outstandingBalance?: number | null;
    totalRevenue?: number | null;
    invoiceCount?: number | null;
    bookingCount?: number | null;
    lastInteractionAt?: string | null;
    nextDueTaskAt?: string | null;
  } | null;
};

export type ContactEvent = {
  id: string;
  type: string;
  createdAt: string;
  data?: unknown;
};

export type ContactNote = {
  id: string;
  body: string;
  createdAt: string;
  source?: string | null;
};

export type ContactTask = {
  id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  remindAt?: string | null;
  completedAt?: string | null;
  source?: string | null;
  createdAt?: string | null;
};

export type DetailQuickAction = "create-invoice" | "book-appointment" | "send-quote";

interface ContactDetailProps {
  contact: ContactDetailData | null;
  events?: ContactEvent[];
  // The props below through `invoices` fed the side panel's tabs (retired, BUG-062): accepted, no longer drawn.
  notes?: ContactNote[];
  tasks?: ContactTask[];
  loading?: boolean;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  onClose?: () => void;
  onAddNote?: (body: string, source?: string) => Promise<void>;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  onCompleteTask?: (taskId: string, currentStatus?: string) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onUpdateNote?: (noteId: string, data: { body?: string; source?: string }) => Promise<void>;
  onUpdateTask?: (taskId: string, data: { title?: string; dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  onUpdateStatus?: (status: string) => Promise<void>;
  onEdit?: () => void;
  onDelete?: () => void;
  onQuickAction?: (contactId: string, action: DetailQuickAction) => void;
  onLogEvent?: (type: string, description?: string) => Promise<void>;
  healthMetrics?: { engagement: number; payment?: number; responsiveness: number; relationship: number } | null;
  journeyMilestones?: Array<{ id: string; type: string; title: string; description?: string; date: string; value?: number; isNext?: boolean }>;
  crossJourney?: CrossJourneyResponse | null;
  conversationContext?: { lastDiscussed?: string; concerns?: string[]; preferences?: string[]; suggestedOpening?: string; sentiment?: string; engagementLevel?: string } | null;
  aiInsight?: { summary: string; nextBestAction: string; reasoning?: string; confidence: number; suggestedMessage?: string; tags?: string[] } | null;
  aiInsightLoading?: boolean;
  onGenerateAiInsight?: () => Promise<void>;
  insightSnapshot?: import("@/lib/client").ContactInsightSnapshot | null;
  insightLoading?: boolean;
  onRecomputeInsight?: () => Promise<void> | void;
  revenueSummary?: import("@/lib/client").ContactRevenueSummary | null;
  onRefreshConversationContext?: () => Promise<void>;
  relatedContacts?: Array<{ id: string; firstName?: string | null; lastName?: string | null; email?: string | null; status?: string | null; jobTitle?: string | null }>;
  onSelectRelatedContact?: (contactId: string) => void;
  customFieldValues?: Array<{ id: string; definitionId: string; value?: unknown; definition: { name: string; label: string; type: string; description: string | null; placeholder: string | null } }>;
  invoices?: Array<{ id: string; status: string; total?: number | null; currency?: string | null; dueDate?: string | null; issueDate?: string | null; createdAt?: string; paidAt?: string | null }>;
  bookings?: Array<{ id: string; startTime: string; endTime: string; status: string; service?: { name: string; price: number } | null; contact?: { firstName?: string | null } | null }>;
  businessId?: string | null;
}

/** What the panel's confirm dialog asks: each action brings its own words. */
interface ConfirmRequest {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void;
}

const NO_CONFIRM: ConfirmRequest = { open: false, title: "", message: "", confirmLabel: "", action: () => {} };

export function ContactDetail({
  contact,
  events = [],
  loading,
  isPinned,
  onTogglePin,
  onClose,
  onAddTask,
  onUpdateStatus,
  onEdit,
  onDelete,
  onQuickAction,
  onLogEvent: _onLogEvent,
  aiInsight,
  aiInsightLoading,
  onGenerateAiInsight,
  insightSnapshot,
  insightLoading,
  onRecomputeInsight,
  revenueSummary,
  relatedContacts,
  onSelectRelatedContact,
  bookings,
  customFieldValues,
  businessId,
}: ContactDetailProps) {
  // Each action says what it does (BUG-128): a delete goes to Trash, a GDPR forget erases for good.
  const [confirmState, setConfirmState] = useState<ConfirmRequest>(NO_CONFIRM);
  if (loading) {
    return (
      <div className="kf-card p-5 space-y-4 h-full">
        <div className="flex items-start gap-3">
          <div className="h-14 w-14 rounded-full bg-white/5 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-5 w-40 rounded bg-white/5 animate-pulse" />
            <div className="h-3 w-28 rounded bg-white/5 animate-pulse" />
            <div className="h-3 w-36 rounded bg-white/5 animate-pulse" />
          </div>
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 flex-1 rounded-lg bg-white/5 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-white/[0.02] p-3 space-y-2">
              <div className="h-3 w-12 rounded bg-white/5 animate-pulse" />
              <div className="h-6 w-16 rounded bg-white/5 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="h-8 w-full rounded-xl bg-white/5 animate-pulse" />
          <div className="h-8 w-full rounded-xl bg-white/5 animate-pulse" />
        </div>
        <div className="space-y-3 flex-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-white/[0.02] p-3 space-y-2">
              <div className="h-3 w-full rounded bg-white/5 animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-white/5 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="kf-card p-6 flex flex-col items-center justify-center min-h-[300px] text-center">
        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <MessageSquare className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Select a client to view details</p>
      </div>
    );
  }

  const handleDeleteClick = () => {
    if (!onDelete) return;
    setConfirmState({
      open: true,
      title: "Delete client?",
      // A single delete is a soft delete, offered for Undo first (use-contact-actions.ts handleDeleteContact).
      message: "The client moves to Trash. You can undo right after, or restore them from Trash later.",
      confirmLabel: "Delete",
      action: () => {
        onDelete();
      },
    });
  };

  const handleExportClick = async () => {
    if (!businessId) { toast.error("No active workspace"); return; }
    const t = toast.loading("Preparing GDPR export…");
    try {
      const job = await apiPost<{ jobId: string; token: string; expiresAt: string }>({
        path: `/crm/businesses/${businessId}/contacts/${contact.id}/export`,
        body: {},
      });
      if (job.error || !job.data) throw new Error(job.error || "Export failed");
      const dl = await apiGet<{ url: string; filename: string; expiresInSeconds: number }>(
        `/crm/contact-exports/${job.data.token}/download?format=zip`,
      );
      if (dl.error || !dl.data) throw new Error(dl.error || "Could not resolve download");
      toast.success("Export ready — opening download", { id: t });
      window.open(dl.data.url, "_blank");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed", { id: t });
    }
  };

  const handleForgetClick = () => {
    if (!businessId) { toast.error("No active workspace"); return; }
    setConfirmState({
      open: true,
      title: "Forget this client?",
      // contact-privacy.service.ts: the contact is removed now and its personal data purged when the business's
      // grace period ends (an operator can cancel the request until then, through the API: reviews CDC-2, m1).
      message: "The client is removed now. Their personal data is erased for good when the grace period ends.",
      confirmLabel: "Forget",
      action: async () => {
        const t = toast.loading("Submitting forget request…");
        try {
          const res = await apiPost<{ purgeAt: string }>({
            path: `/crm/businesses/${businessId}/contacts/${contact.id}/forget`,
            body: { reason: "User-initiated GDPR forget request" },
          });
          if (res.error) throw new Error(res.error || "Forget failed");
          toast.success("Contact scheduled for purge after grace window", { id: t });
          if (onClose) onClose();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Forget failed", { id: t });
        }
      },
    });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="kf-card p-3 sm:p-5 space-y-3 sm:space-y-4"
      >
        <ContactDetailHeader
          contact={contact}
          businessId={businessId}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          onClose={onClose}
          onEdit={onEdit}
          onDelete={onDelete ? handleDeleteClick : undefined}
          onExport={businessId ? handleExportClick : undefined}
          onForget={businessId ? handleForgetClick : undefined}
          onUpdateStatus={onUpdateStatus}
          onQuickAction={onQuickAction}
          onAddTask={onAddTask}
          nextBookingDate={bookings?.find(b => new Date(b.startTime).getTime() > Date.now())?.startTime}
        />

        {/* BUG-062: the side panel is a summary; the contact's page holds the timeline, notes, tasks and money. */}
        <Link
          href={`/app/crm/contacts/${encodeURIComponent(contact.id)}/overview`}
          className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[32px] py-1.5 text-xs font-medium text-[hsl(var(--kf-accent2))] hover:underline"
        >
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          Open {`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "client"}&apos;s page
        </Link>

        <MomentumPrimaryCTA
          contactId={contact.id}
          contactName={`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "client"}
          onAddTask={onAddTask}
          // SEC-R015d-1 (R0-15d review): momentum is read from the business this
          // contact is shown in, not whatever kf_business_id says.
          businessId={businessId}
        />

        {(insightSnapshot || insightLoading) && (
          <ContactInsightCard
            snapshot={insightSnapshot ?? null}
            loading={insightLoading}
            contact={{
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email,
              phone: contact.phone,
              whatsappNumber: contact.whatsappNumber,
            }}
            onRefresh={onRecomputeInsight}
            onAddTask={onAddTask}
            revenueSummary={revenueSummary ?? null}
            businessId={businessId}
          />
        )}

        {(aiInsight || onGenerateAiInsight) && (
          <NextBestActionCard
            aiInsight={aiInsight}
            loading={aiInsightLoading}
            onGenerate={onGenerateAiInsight}
          />
        )}

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-3 sm:space-y-4 min-w-0">
            <ContactDetailStats
              contact={contact}
              events={events}
              onQuickAction={onQuickAction}
              businessId={businessId}
            />
            <ContactDetailInfo
              contact={contact}
              relatedContacts={relatedContacts}
              onSelectRelatedContact={onSelectRelatedContact}
              onAddTask={onAddTask}
              customFieldValues={customFieldValues}
              // SEC-R015c-1 (R0-15d): the panel reads the custom fields of, and
              // writes the consent flags to (SEC-R015d-1), the business this
              // contact is shown in, not whatever kf_business_id says.
              businessId={businessId}
            />
          </div>

          <div className="lg:col-span-4 space-y-2 min-w-0">
            <div className="flex items-center gap-2 px-1 py-1 border-t border-border/30 pt-3 lg:border-t-0 lg:pt-1">
              <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Intelligence</span>
            </div>
            <AiContactSummaryPanel contactId={contact.id} />
            <AiPrepBriefPanel contactId={contact.id} />
            <AiLeadScorePanel contactId={contact.id} currentScore={contact.meta?.leadScore} />
            <AiTagSuggestionsPanel contactId={contact.id} currentTags={contact.tags} />
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] text-xs font-medium text-muted-foreground transition-colors border border-border/30 min-h-[44px]"
            aria-label="Collapse contact details"
          >
            <ChevronUp className="w-4 h-4" />
            Collapse
          </button>
        )}
      </motion.div>

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant="danger"
        onConfirm={() => {
          confirmState.action();
          setConfirmState(NO_CONFIRM);
        }}
        onCancel={() => setConfirmState(NO_CONFIRM)}
      />
    </>
  );
}
