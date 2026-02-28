"use client";

import React from "react";
import { MessageSquare, ListTodo, History, AlertCircle } from "lucide-react";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "./contact-detail";
import type { HealthMetricsData, JourneyMilestoneData, ConversationContextData, AiInsightData } from "./tab-constants";
import { NotesTabPanel } from "./notes-tab-panel";
import { TasksTabPanel } from "./tasks-tab-panel";
import { TimelineTabPanel } from "./timeline-tab-panel";

class TabErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center space-y-2">
          <AlertCircle className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Something went wrong loading this section.</p>
          <button onClick={() => this.setState({ hasError: false })} className="text-xs text-[hsl(var(--kf-accent2))] hover:underline">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface ContactDetailTabsProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  notes: ContactNote[];
  tasks: ContactTask[];
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
  onAddNote?: (body: string, source?: string) => Promise<void>;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  onCompleteTask?: (taskId: string, currentStatus?: string) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onUpdateNote?: (noteId: string, data: { body?: string; source?: string }) => Promise<void>;
  onUpdateTask?: (taskId: string, data: { title?: string; dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  healthMetrics?: HealthMetricsData | null;
  journeyMilestones?: JourneyMilestoneData[];
  conversationContext?: ConversationContextData | null;
  aiInsight?: AiInsightData | null;
  aiInsightLoading?: boolean;
  onGenerateAiInsight?: () => Promise<void>;
  onRefreshConversationContext?: () => Promise<void>;
}

export function ContactDetailTabs({
  contact, events, notes, tasks,
  activeTab, onSetActiveTab,
  onAddNote, onAddTask, onCompleteTask, onDeleteNote, onDeleteTask,
  onUpdateNote, onUpdateTask,
  healthMetrics, journeyMilestones = [],
  conversationContext, aiInsight, aiInsightLoading,
  onGenerateAiInsight, onRefreshConversationContext,
}: ContactDetailTabsProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex border-b border-border overflow-x-auto shrink-0" role="tablist">
        {[
          { key: "notes", label: "Notes", icon: MessageSquare, count: notes.length },
          { key: "tasks", label: "Tasks", icon: ListTodo, count: tasks.filter((t) => t.status !== "DONE").length },
          { key: "timeline", label: "Timeline", icon: History },
        ].map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => onSetActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              activeTab === key
                ? "border-[hsl(var(--kf-accent1))] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
            {count != null && count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted">{count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className={`space-y-3 pt-3 pb-6 ${activeTab === "notes" ? "" : "hidden"}`}>
          <TabErrorBoundary resetKey="notes">
            <NotesTabPanel contact={contact} notes={notes} onAddNote={onAddNote} onAddTask={onAddTask} onDeleteNote={onDeleteNote} onUpdateNote={onUpdateNote} />
          </TabErrorBoundary>
        </div>
        <div className={`space-y-3 pt-3 pb-6 ${activeTab === "tasks" ? "" : "hidden"}`}>
          <TabErrorBoundary resetKey="tasks">
            <TasksTabPanel contact={contact} tasks={tasks} onAddTask={onAddTask} onAddNote={onAddNote} onCompleteTask={onCompleteTask} onDeleteTask={onDeleteTask} onUpdateTask={onUpdateTask} />
          </TabErrorBoundary>
        </div>
        <div className={`space-y-3 pt-3 pb-6 ${activeTab === "timeline" ? "" : "hidden"}`}>
          <TabErrorBoundary resetKey="timeline">
            <TimelineTabPanel
              contact={contact} events={events}
              healthMetrics={healthMetrics} journeyMilestones={journeyMilestones}
              conversationContext={conversationContext} aiInsight={aiInsight} aiInsightLoading={aiInsightLoading}
              onGenerateAiInsight={onGenerateAiInsight} onRefreshConversationContext={onRefreshConversationContext}
              onAddNote={onAddNote} onAddTask={onAddTask}
            />
          </TabErrorBoundary>
        </div>
      </div>
    </div>
  );
}
