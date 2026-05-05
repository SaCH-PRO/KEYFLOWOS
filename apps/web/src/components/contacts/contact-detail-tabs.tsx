"use client";

import React, { Suspense, useState } from "react";
import { MessageSquare, ListTodo, History, AlertCircle, Loader2, MessageCircle, Briefcase, Shield, Network } from "lucide-react";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "./contact-detail";
import type { HealthMetricsData, JourneyMilestoneData, ConversationContextData, AiInsightData } from "./tab-constants";
import type { CrossJourneyResponse } from "@/lib/client";

const NotesTabPanel = React.lazy(() => import("./notes-tab-panel").then(m => ({ default: m.NotesTabPanel })));
const TasksTabPanel = React.lazy(() => import("./tasks-tab-panel").then(m => ({ default: m.TasksTabPanel })));
const TimelineTabPanel = React.lazy(() => import("./timeline-tab-panel").then(m => ({ default: m.TimelineTabPanel })));
const ConversationsTabPanel = React.lazy(() => import("./conversations-tab-panel").then(m => ({ default: m.ConversationsTabPanel })));
type ConversationsContactLite = import("./conversations-tab-panel").ContactLite;
const DealsTabPanel = React.lazy(() => import("./deals-tab-panel").then(m => ({ default: m.DealsTabPanel })));
const AuditTabPanel = React.lazy(() => import("./audit-tab-panel").then(m => ({ default: m.AuditTabPanel })));
const NetworkTabPanel = React.lazy(() => import("./network-tab-panel").then(m => ({ default: m.NetworkTabPanel })));

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
  businessId?: string | null;
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
  crossJourney?: CrossJourneyResponse | null;
  conversationContext?: ConversationContextData | null;
  aiInsight?: AiInsightData | null;
  aiInsightLoading?: boolean;
  onGenerateAiInsight?: () => Promise<void>;
  onRefreshConversationContext?: () => Promise<void>;
  invoices?: InvoiceSummary[];
  bookings?: BookingSummary[];
}

const LEGACY_TAB_MAP: Record<string, string> = {
  activity: "timeline",
  journey: "timeline",
};

function normalizeTab(tab: string): string {
  return LEGACY_TAB_MAP[tab] ?? tab;
}

export function ContactDetailTabs({
  contact, businessId, events, notes, tasks,
  activeTab, onSetActiveTab,
  onAddNote, onAddTask, onCompleteTask, onDeleteNote, onDeleteTask,
  onUpdateNote, onUpdateTask,
  healthMetrics, journeyMilestones = [],
  crossJourney,
  conversationContext, aiInsight, aiInsightLoading,
  onGenerateAiInsight, onRefreshConversationContext,
  invoices = [], bookings = [],
}: ContactDetailTabsProps) {
  const normalized = normalizeTab(activeTab);
  const [activatedTabs, setActivatedTabs] = useState<Set<string>>(() => new Set(["timeline", normalized]));
  if (!activatedTabs.has(normalized)) {
    setActivatedTabs((prev) => {
      if (prev.has(normalized)) return prev;
      const next = new Set(prev);
      next.add(normalized);
      return next;
    });
  }

  const timelineCount = events.length + notes.length + tasks.length + (invoices?.length ?? 0) + (bookings?.length ?? 0);
  const conversationsCount = events.filter((e) => {
    const t = e.type ?? "";
    return t.startsWith("communication.") || t.startsWith("email.") || t.startsWith("whatsapp.") || t.startsWith("sms.") || t.startsWith("message.") || t.startsWith("call.") || t === "lead_form.submitted" || t === "form.submitted";
  }).length;

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex border-b border-border overflow-x-auto shrink-0" role="tablist">
        {[
          { key: "timeline", label: "Timeline", icon: History, count: timelineCount },
          { key: "conversations", label: "Conversations", icon: MessageCircle, count: conversationsCount },
          { key: "notes", label: "Notes", icon: MessageSquare, count: notes.length },
          { key: "tasks", label: "Tasks", icon: ListTodo, count: tasks.filter((t) => t.status !== "DONE").length },
          { key: "deals", label: "Deals", icon: Briefcase, count: undefined as number | undefined },
          { key: "audit", label: "Audit", icon: Shield, count: undefined as number | undefined },
          { key: "network", label: "Network", icon: Network, count: undefined as number | undefined },
        ].map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            role="tab"
            aria-selected={normalized === key}
            onClick={() => onSetActiveTab(key)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${
              normalized === key
                ? "border-[hsl(var(--kf-accent1))] text-foreground bg-[hsl(var(--kf-accent1))]/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${normalized === key ? "text-[hsl(var(--kf-accent1))]" : ""}`} />
            {label}
            {count != null && count > 0 && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                normalized === key
                  ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]"
                  : "bg-muted text-muted-foreground"
              }`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}>
          {activatedTabs.has("timeline") && (
            <div className={`space-y-3 pt-3 pb-6 ${normalized === "timeline" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="timeline">
                <TimelineTabPanel
                  contact={contact}
                  businessId={businessId}
                  events={events}
                  notes={notes}
                  tasks={tasks}
                  invoices={invoices}
                  bookings={bookings}
                  crossJourney={crossJourney}
                  healthMetrics={healthMetrics}
                  journeyMilestones={journeyMilestones}
                  conversationContext={conversationContext}
                  aiInsight={aiInsight}
                  aiInsightLoading={aiInsightLoading}
                  onGenerateAiInsight={onGenerateAiInsight}
                  onRefreshConversationContext={onRefreshConversationContext}
                  onAddNote={onAddNote}
                  onAddTask={onAddTask}
                />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.has("conversations") && (
            <div className={`space-y-3 pt-3 pb-6 ${normalized === "conversations" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="conversations">
                <ConversationsTabPanel contact={contact as unknown as ConversationsContactLite} businessId={businessId} />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.has("notes") && (
            <div className={`space-y-3 pt-3 pb-6 ${normalized === "notes" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="notes">
                <NotesTabPanel contact={contact} notes={notes} onAddNote={onAddNote} onAddTask={onAddTask} onDeleteNote={onDeleteNote} onUpdateNote={onUpdateNote} />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.has("tasks") && (
            <div className={`space-y-3 pt-3 pb-6 ${normalized === "tasks" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="tasks">
                <TasksTabPanel contact={contact} tasks={tasks} onAddTask={onAddTask} onAddNote={onAddNote} onCompleteTask={onCompleteTask} onDeleteTask={onDeleteTask} onUpdateTask={onUpdateTask} />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.has("deals") && (
            <div className={`space-y-3 pt-3 pb-6 ${normalized === "deals" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="deals">
                <DealsTabPanel contact={contact} businessId={businessId} />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.has("audit") && (
            <div className={`pt-3 pb-6 ${normalized === "audit" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="audit">
                <AuditTabPanel businessId={businessId} contactId={contact.id} />
              </TabErrorBoundary>
            </div>
          )}
          {activatedTabs.has("network") && (
            <div className={`space-y-3 pt-3 pb-6 ${normalized === "network" ? "" : "hidden"}`}>
              <TabErrorBoundary resetKey="network">
                <NetworkTabPanel
                  contactId={contact.id}
                  contactName={`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || undefined}
                  businessId={businessId}
                  onNavigateToContact={(id) => {
                    if (typeof window !== "undefined") {
                      window.location.href = `/app/crm/contacts/${id}`;
                    }
                  }}
                />
              </TabErrorBoundary>
            </div>
          )}
        </Suspense>
      </div>
    </div>
  );
}
