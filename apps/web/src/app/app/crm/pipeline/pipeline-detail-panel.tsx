"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  ContactDetail,
  ContactDetailData,
  ContactEvent,
  ContactNote,
  ContactTask,
} from "@/components/contacts";
import type { HealthMetrics } from "@/components/contacts/contact-health-score";
import type { JourneyMilestone } from "@/components/contacts/relationship-timeline";
import type { ConversationContextData } from "@/components/contacts/conversation-context";
import type { AiInsight } from "@/components/contacts/ai-copilot";
import type { CrossJourneyResponse } from "@/lib/client";

export interface PipelineDetailPanelProps {
  contact: ContactDetailData | null;
  events: ContactEvent[];
  notes: ContactNote[];
  tasks: ContactTask[];
  loading: boolean;
  detailError?: string | null;
  onRetryDetail?: () => void;
  isPinned: boolean;
  contactName: string;
  healthMetrics: HealthMetrics | null;
  journeyMilestones: JourneyMilestone[];
  crossJourney?: CrossJourneyResponse | null;
  conversationContext: ConversationContextData | null;
  aiInsight: AiInsight | null;
  aiInsightLoading: boolean;
  onTogglePin: (id: string) => void;
  onAddNote: (body: string, source?: string) => Promise<void>;
  onAddTask: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  onCompleteTask: (taskId: string, currentStatus?: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onUpdateNote: (noteId: string, data: { body?: string; source?: string }) => Promise<void>;
  onUpdateTask: (taskId: string, data: { title?: string; dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  onUpdateStatus: (status: string) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onLogEvent: (type: string, description?: string) => Promise<void>;
  onLogCommunication?: (data: { channelType: string; outcome: string; duration?: number; notes?: string }) => Promise<void>;
  onGenerateAiInsight: () => Promise<void>;
  onRefreshConversationContext: () => Promise<void>;
  onClose?: () => void;
  relatedContacts?: Array<{ id: string; firstName?: string | null; lastName?: string | null; email?: string | null; status?: string | null; jobTitle?: string | null }>;
  onSelectRelatedContact?: (contactId: string) => void;
  invoices?: Array<{ id: string; status: string; total?: number | null; currency?: string | null; dueDate?: string | null; issueDate?: string | null; createdAt?: string; paidAt?: string | null }>;
  bookings?: Array<{ id: string; startTime: string; endTime: string; status: string; service?: { name: string; price: number } | null; contact?: { firstName?: string | null } | null }>;
  businessId?: string | null;
}

function PipelineDetailPanelInner({
  contact,
  events,
  notes,
  tasks,
  loading,
  detailError,
  onRetryDetail,
  isPinned,
  contactName,
  healthMetrics,
  journeyMilestones,
  crossJourney,
  conversationContext,
  aiInsight,
  aiInsightLoading,
  onTogglePin,
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
  onLogEvent,
  onLogCommunication,
  onGenerateAiInsight,
  onRefreshConversationContext,
  onClose,
  relatedContacts,
  onSelectRelatedContact,
  invoices,
  bookings,
  businessId,
}: PipelineDetailPanelProps) {
  if (detailError && !loading) {
    return (
      <div className="kf-card p-6 text-center space-y-3" role="alert">
        <div className="flex justify-center">
          <div className="p-2.5 rounded-full bg-red-500/10">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{detailError}</p>
        {onRetryDetail && (
          <button
            onClick={onRetryDetail}
            className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ContactDetail
        contact={contact}
        events={events}
        notes={notes}
        tasks={tasks}
        loading={loading}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        onAddNote={onAddNote}
        onAddTask={onAddTask}
        onCompleteTask={onCompleteTask}
        onDeleteNote={onDeleteNote}
        onDeleteTask={onDeleteTask}
        onUpdateNote={onUpdateNote}
        onUpdateTask={onUpdateTask}
        onUpdateStatus={onUpdateStatus}
        onEdit={onEdit}
        onDelete={onDelete}
        onLogEvent={onLogEvent}
        onLogCommunication={onLogCommunication}
        onClose={onClose}
        healthMetrics={healthMetrics}
        journeyMilestones={journeyMilestones}
        crossJourney={crossJourney}
        conversationContext={conversationContext}
        aiInsight={aiInsight}
        aiInsightLoading={aiInsightLoading}
        onGenerateAiInsight={onGenerateAiInsight}
        onRefreshConversationContext={onRefreshConversationContext}
        relatedContacts={relatedContacts}
        onSelectRelatedContact={onSelectRelatedContact}
        invoices={invoices}
        bookings={bookings}
        businessId={businessId}
      />
    </div>
  );
}

export const PipelineDetailPanel = React.memo(PipelineDetailPanelInner);
