"use client";

import React, { Suspense, useRef } from "react";
import { MessageSquare, ListTodo, History, AlertCircle, Loader2, Activity, Route } from "lucide-react";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "./contact-detail";
import type { HealthMetricsData, JourneyMilestoneData, ConversationContextData, AiInsightData } from "./tab-constants";

const NotesTabPanel = React.lazy(() => import("./notes-tab-panel").then(m => ({ default: m.NotesTabPanel })));
const TasksTabPanel = React.lazy(() => import("./tasks-tab-panel").then(m => ({ default: m.TasksTabPanel })));
const TimelineTabPanel = React.lazy(() => import("./timeline-tab-panel").then(m => ({ default: m.TimelineTabPanel })));
const ActivityTimeline = React.lazy(() => import("./activity-timeline").then(m => ({ default: m.ActivityTimeline })));
const ContactJourneyTimeline = React.lazy(() => import("./contact-journey-timeline").then(m => ({ default: m.ContactJourneyTimeline })));

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

interface InvoiceSummary {
  id: string;
  status: string;
  total?: number | null;
  currency?: string | null;
  dueDate?: string | null;
  issueDate?: string | null;
  createdAt?: string;
  paidAt?: string | null;
}

interface BookingSummary {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  service?: { name: string; price: number } | null;
  contact?: { firstName?: string | null } | null;
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
  invoices?: InvoiceSummary[];
  bookings?: BookingSummary[];
}

export function ContactDetailTabs({
  contact, events, notes, tasks,
  activeTab, onSetActiveTab,
  onAddNote, onAddTask, onCompleteTask, onDeleteNote, onDeleteTask,
  onUpdateNote, onUpdateTask,
  healthMetrics, journeyMilestones = [],
  conversationContext, aiInsight, aiInsightLoading,
  onGenerateAiInsight, onRefreshConversationContext,
  invoices = [], bookings = [],
}: ContactDetailTabsProps) {
  const activatedTabs = useRef(new Set<string>(["activity"]));
  if (!activatedTabs.current.has(activeTab)) {
    activatedTabs.current.add(activeTab);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex border-b border-border overflow-x-auto shrink-0" role="tablist">
        {[
          { key: "activity", label: "Activity", icon: Activity, count: events.length + notes.length + tasks.length },
          { key: "journey", label: "Journey", icon: Route },
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
        <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}>
          {activatedTabs.current.has("activity") && (
            <div className={`space-y-3 pt-3 pb-6 ${activeTab === "activity" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="activity">
                <ActivityTimeline contact={contact} events={events} notes={notes} tasks={tasks} />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.current.has("journey") && (
            <div className={`space-y-3 pt-3 pb-6 ${activeTab === "journey" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="journey">
                <ContactJourneyTimeline contact={contact} events={events} invoices={invoices} bookings={bookings} />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.current.has("notes") && (
            <div className={`space-y-3 pt-3 pb-6 ${activeTab === "notes" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="notes">
                <NotesTabPanel contact={contact} notes={notes} onAddNote={onAddNote} onAddTask={onAddTask} onDeleteNote={onDeleteNote} onUpdateNote={onUpdateNote} />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.current.has("tasks") && (
            <div className={`space-y-3 pt-3 pb-6 ${activeTab === "tasks" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="tasks">
                <TasksTabPanel contact={contact} tasks={tasks} onAddTask={onAddTask} onAddNote={onAddNote} onCompleteTask={onCompleteTask} onDeleteTask={onDeleteTask} onUpdateTask={onUpdateTask} />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.current.has("timeline") && (
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
          )}
        </Suspense>
      </div>
    </div>
  );
}
