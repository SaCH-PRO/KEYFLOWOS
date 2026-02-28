"use client";

import React from "react";
import {
  ContactDetail,
  ContactDetailData,
  ContactEvent,
  ContactNote,
  ContactTask,
  ContactHealthScore,
  RelationshipTimeline,
  ConversationContext,
  AiCopilot,
} from "@/components/contacts";
import type { HealthMetrics } from "@/components/contacts/contact-health-score";
import type { JourneyMilestone } from "@/components/contacts/relationship-timeline";
import type { ConversationContextData } from "@/components/contacts/conversation-context";
import type { AiInsight } from "@/components/contacts/ai-copilot";

export interface PipelineDetailPanelProps {
  contact: ContactDetailData | null;
  events: ContactEvent[];
  notes: ContactNote[];
  tasks: ContactTask[];
  loading: boolean;
  isPinned: boolean;
  contactName: string;
  healthMetrics: HealthMetrics | null;
  journeyMilestones: JourneyMilestone[];
  conversationContext: ConversationContextData | null;
  aiInsight: AiInsight | null;
  aiInsightLoading: boolean;
  onTogglePin: (id: string) => void;
  onAddNote: (body: string, source?: string) => Promise<void>;
  onAddTask: (title: string, dueDate?: string) => Promise<void>;
  onCompleteTask: (taskId: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onUpdateStatus: (status: string) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onLogEvent: (type: string, description?: string) => Promise<void>;
  onGenerateAiInsight: () => Promise<void>;
  onRefreshConversationContext: () => Promise<void>;
  onClose?: () => void;
}

function PipelineDetailPanelInner({
  contact,
  events,
  notes,
  tasks,
  loading,
  isPinned,
  contactName,
  healthMetrics,
  journeyMilestones,
  conversationContext,
  aiInsight,
  aiInsightLoading,
  onTogglePin,
  onAddNote,
  onAddTask,
  onCompleteTask,
  onDeleteNote,
  onDeleteTask,
  onUpdateStatus,
  onEdit,
  onDelete,
  onLogEvent,
  onGenerateAiInsight,
  onRefreshConversationContext,
  onClose,
}: PipelineDetailPanelProps) {
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
        onUpdateStatus={onUpdateStatus}
        onEdit={onEdit}
        onDelete={onDelete}
        onLogEvent={onLogEvent}
        onClose={onClose}
      />

      {contact && (
        <>
          <AiCopilot
            contactName={contactName}
            insight={aiInsight}
            isLoading={aiInsightLoading}
            onGenerateInsight={onGenerateAiInsight}
          />

          {healthMetrics && (
            <div className="kf-card p-5">
              <ContactHealthScore
                metrics={healthMetrics}
                tip={
                  healthMetrics.relationship < 60
                    ? "Schedule a personal check-in call to strengthen this relationship"
                    : healthMetrics.engagement < 60
                    ? "Send a personalized offer to re-engage this contact"
                    : undefined
                }
              />
            </div>
          )}

          {journeyMilestones.length > 0 && (
            <div className="kf-card p-5">
              <RelationshipTimeline contactName={contactName} milestones={journeyMilestones} />
            </div>
          )}

          {conversationContext && (
            <div className="kf-card p-5">
              <ConversationContext
                data={conversationContext}
                contactName={contactName}
                onRefresh={onRefreshConversationContext}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const PipelineDetailPanel = React.memo(PipelineDetailPanelInner);
