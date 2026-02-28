"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContactDetailHeader } from "./contact-detail-header";
import { ContactDetailStats } from "./contact-detail-stats";
import { ContactDetailInfo } from "./contact-detail-info";
import { ContactDetailTabs } from "./contact-detail-tabs";

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
  createdAt?: string | null;
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
  healthMetrics?: { engagement: number; payment: number; responsiveness: number; relationship: number } | null;
  journeyMilestones?: Array<{ id: string; type: string; title: string; description?: string; date: string; value?: number; isNext?: boolean }>;
  conversationContext?: { lastDiscussed?: string; concerns?: string[]; preferences?: string[]; suggestedOpening?: string; sentiment?: string; engagementLevel?: string } | null;
  aiInsight?: { summary: string; nextBestAction: string; reasoning?: string; confidence: number; suggestedMessage?: string; tags?: string[] } | null;
  aiInsightLoading?: boolean;
  onGenerateAiInsight?: () => Promise<void>;
  onRefreshConversationContext?: () => Promise<void>;
}

export function ContactDetail({
  contact,
  events = [],
  notes = [],
  tasks = [],
  loading,
  isPinned,
  onTogglePin,
  onClose,
  onAddNote,
  onAddTask,
  onCompleteTask,
  onDeleteNote,
  onDeleteTask,
  onUpdateNote,
  onUpdateTask,
  onUpdateStatus,
  onEdit,
  onDelete,
  onQuickAction,
  onLogEvent,
  healthMetrics,
  journeyMilestones,
  conversationContext,
  aiInsight,
  aiInsightLoading,
  onGenerateAiInsight,
  onRefreshConversationContext,
}: ContactDetailProps) {
  const [activeTab, setActiveTab] = useState<string>("notes");
  const [confirmState, setConfirmState] = useState<{ open: boolean; action: () => void }>({
    open: false,
    action: () => {},
  });

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
        <div className="flex gap-2 border-b border-border/30 pb-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 w-20 rounded-lg bg-white/5 animate-pulse" />
          ))}
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
        <p className="text-muted-foreground">Select a contact to view details</p>
      </div>
    );
  }

  const handleDeleteClick = () => {
    if (!onDelete) return;
    setConfirmState({
      open: true,
      action: () => {
        onDelete();
      },
    });
  };

  const handleDeleteNote = (noteId: string) => {
    if (!onDeleteNote) return;
    setConfirmState({
      open: true,
      action: async () => {
        await onDeleteNote(noteId);
      },
    });
  };

  const handleDeleteTask = (taskId: string) => {
    if (!onDeleteTask) return;
    setConfirmState({
      open: true,
      action: async () => {
        await onDeleteTask(taskId);
      },
    });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="kf-card p-5 space-y-4 h-full flex flex-col overflow-hidden"
      >
        <div className="shrink-0">
          <ContactDetailHeader
            contact={contact}
            isPinned={isPinned}
            onTogglePin={onTogglePin}
            onClose={onClose}
            onEdit={onEdit}
            onDelete={onDelete ? handleDeleteClick : undefined}
            onUpdateStatus={onUpdateStatus}
            onQuickAction={onQuickAction}
            onLogEvent={onLogEvent}
            onAddTask={onAddTask}
          />
        </div>

        <div className="shrink-0">
          <ContactDetailStats
            contact={contact}
            events={events}
            onSetActiveTab={setActiveTab}
            onQuickAction={onQuickAction}
          />
        </div>

        <div className="shrink-0">
          <ContactDetailInfo contact={contact} />
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <ContactDetailTabs
            contact={contact}
            events={events}
            notes={notes}
            tasks={tasks}
            activeTab={activeTab}
            onSetActiveTab={setActiveTab}
            onAddNote={onAddNote}
            onAddTask={onAddTask}
            onCompleteTask={onCompleteTask}
            onDeleteNote={onDeleteNote ? handleDeleteNote : undefined}
            onDeleteTask={onDeleteTask ? handleDeleteTask : undefined}
            onUpdateNote={onUpdateNote}
            onUpdateTask={onUpdateTask}
            healthMetrics={healthMetrics}
            journeyMilestones={journeyMilestones}
            conversationContext={conversationContext}
            aiInsight={aiInsight}
            aiInsightLoading={aiInsightLoading}
            onGenerateAiInsight={onGenerateAiInsight}
            onRefreshConversationContext={onRefreshConversationContext}
          />
        </div>
      </motion.div>

      <ConfirmDialog
        open={confirmState.open}
        title="Confirm Delete"
        message="Are you sure? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          confirmState.action();
          setConfirmState({ open: false, action: () => {} });
        }}
        onCancel={() => setConfirmState({ open: false, action: () => {} })}
      />
    </>
  );
}
