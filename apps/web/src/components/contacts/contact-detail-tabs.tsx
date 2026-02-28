"use client";

import { useState, useMemo } from "react";
import {
  Plus,
  MessageSquare,
  ListTodo,
  History,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Search,
  Copy,
  MessageCircle,
  Mail,
  Pin,
  PinOff,
  ListPlus,
  Phone as PhoneIcon,
  Video,
  Handshake,
  FileText,
  StickyNote,
  Lightbulb,
  AlertCircle,
  Check,
  Clock,
  Flag,
  Bell,
  Calendar,
  ArrowUpDown,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Sparkles,
  DollarSign,
  TrendingUp,
  Users,
  Heart,
  Brain,
  Zap,
  Target,
  RefreshCw,
  Star,
  Gift,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "./contact-detail";

const EVENT_LABELS: Record<string, string> = {
  "contact.created": "Contact created",
  "contact.updated": "Contact updated",
  "contact.merged": "Contacts merged",
  "STATUS_CHANGED": "Status changed",
  "invoice.created": "Invoice created",
  "invoice.sent": "Invoice sent",
  "invoice.paid": "Invoice paid",
  "invoice.overdue": "Invoice overdue",
  "booking.created": "Booking made",
  "booking.confirmed": "Booking confirmed",
  "booking.completed": "Booking completed",
  "booking.cancelled": "Booking cancelled",
  "quote.created": "Quote sent",
  "quote.sent": "Quote sent",
  "quote.accepted": "Quote accepted",
  "note.added": "Note added",
  "note.created": "Note added",
  "task.created": "Task created",
  "task.completed": "Task completed",
  "task.reopened": "Task reopened",
  "email.sent": "Email sent",
  "whatsapp.sent": "WhatsApp message sent",
  "message.copied": "Message copied",
  "form.submitted": "Form submitted",
  "followup.scheduled": "Follow-up scheduled",
  "automation.run": "Automation triggered",
};

const EVENT_ICONS: Record<string, { icon: typeof MessageSquare; color: string }> = {
  "contact.created": { icon: Sparkles, color: "hsl(var(--kf-accent1))" },
  "contact.updated": { icon: RefreshCw, color: "hsl(var(--kf-muted-foreground))" },
  "contact.merged": { icon: Users, color: "hsl(var(--kf-accent2))" },
  "STATUS_CHANGED": { icon: TrendingUp, color: "hsl(var(--kf-accent2))" },
  "invoice.created": { icon: FileText, color: "hsl(217 91% 60%)" },
  "invoice.sent": { icon: Mail, color: "hsl(217 91% 60%)" },
  "invoice.paid": { icon: DollarSign, color: "hsl(142 76% 36%)" },
  "invoice.overdue": { icon: AlertTriangle, color: "hsl(0 84% 60%)" },
  "booking.created": { icon: Calendar, color: "hsl(var(--kf-accent2))" },
  "booking.confirmed": { icon: CheckCircle2, color: "hsl(142 76% 36%)" },
  "booking.completed": { icon: Star, color: "hsl(45 93% 47%)" },
  "booking.cancelled": { icon: AlertCircle, color: "hsl(0 84% 60%)" },
  "quote.created": { icon: FileText, color: "hsl(217 91% 60%)" },
  "quote.sent": { icon: Mail, color: "hsl(217 91% 60%)" },
  "quote.accepted": { icon: CheckCircle2, color: "hsl(142 76% 36%)" },
  "note.added": { icon: StickyNote, color: "hsl(var(--kf-muted-foreground))" },
  "note.created": { icon: StickyNote, color: "hsl(var(--kf-muted-foreground))" },
  "task.created": { icon: ListTodo, color: "hsl(var(--kf-accent2))" },
  "task.completed": { icon: CheckCircle2, color: "hsl(142 76% 36%)" },
  "task.reopened": { icon: RefreshCw, color: "hsl(var(--kf-accent1))" },
  "email.sent": { icon: Mail, color: "hsl(217 91% 60%)" },
  "whatsapp.sent": { icon: MessageCircle, color: "hsl(142 76% 36%)" },
  "message.copied": { icon: Copy, color: "hsl(var(--kf-muted-foreground))" },
  "form.submitted": { icon: FileText, color: "hsl(var(--kf-accent1))" },
  "followup.scheduled": { icon: Bell, color: "hsl(var(--kf-accent1))" },
  "automation.run": { icon: Zap, color: "hsl(var(--kf-accent2))" },
};

const MILESTONE_ICONS: Record<string, { icon: typeof MessageSquare; color: string }> = {
  first_contact: { icon: Sparkles, color: "hsl(var(--kf-accent1))" },
  call: { icon: PhoneIcon, color: "hsl(var(--kf-accent2))" },
  quote_sent: { icon: FileText, color: "hsl(217 91% 60%)" },
  quote_accepted: { icon: CheckCircle2, color: "hsl(142 76% 36%)" },
  payment: { icon: DollarSign, color: "hsl(142 76% 36%)" },
  booking: { icon: Calendar, color: "hsl(var(--kf-accent2))" },
  completed: { icon: Star, color: "hsl(45 93% 47%)" },
  milestone: { icon: Gift, color: "hsl(var(--kf-accent1))" },
  note: { icon: MessageSquare, color: "hsl(var(--kf-muted-foreground))" },
};

const HEALTH_METRICS_CONFIG = [
  { key: "engagement" as const, label: "Engagement", icon: TrendingUp },
  { key: "payment" as const, label: "Payment", icon: DollarSign },
  { key: "responsiveness" as const, label: "Response", icon: MessageSquare },
  { key: "relationship" as const, label: "Relationship", icon: Users },
];

const NOTE_CATEGORIES = [
  { key: "general", label: "General", icon: StickyNote, color: "text-muted-foreground", bg: "bg-muted" },
  { key: "call", label: "Call", icon: PhoneIcon, color: "text-violet-400", bg: "bg-violet-500/10" },
  { key: "meeting", label: "Meeting", icon: Video, color: "text-blue-400", bg: "bg-blue-500/10" },
  { key: "deal", label: "Deal", icon: Handshake, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  { key: "follow-up", label: "Follow-up", icon: AlertCircle, color: "text-amber-400", bg: "bg-amber-500/10" },
  { key: "idea", label: "Idea", icon: Lightbulb, color: "text-yellow-400", bg: "bg-yellow-500/10" },
] as const;

type NoteCategory = (typeof NOTE_CATEGORIES)[number]["key"];

const NOTE_TEMPLATES = [
  { label: "Call summary", category: "call" as NoteCategory, body: "Called {name} — discussed:\n- \n\nNext steps:\n- " },
  { label: "Meeting recap", category: "meeting" as NoteCategory, body: "Met with {name}\n\nKey takeaways:\n- \n\nAction items:\n- " },
  { label: "Deal update", category: "deal" as NoteCategory, body: "Deal update for {name}:\nStatus: \nValue: TTD \nNext milestone: " },
  { label: "Follow-up needed", category: "follow-up" as NoteCategory, body: "Follow up with {name} regarding:\n- \n\nDeadline: " },
  { label: "Quick idea", category: "idea" as NoteCategory, body: "" },
];

function getCategoryConfig(source?: string | null) {
  const key = source?.toLowerCase().replace(/[_\s]/g, "-") || "general";
  return NOTE_CATEGORIES.find((c) => c.key === key) || NOTE_CATEGORIES[0];
}

const TASK_PRIORITIES = [
  { key: "HIGH", label: "High", icon: Flag, color: "text-red-400", bg: "bg-red-500/10" },
  { key: "NORMAL", label: "Normal", icon: Circle, color: "text-blue-400", bg: "bg-blue-500/10" },
  { key: "LOW", label: "Low", icon: ArrowUpDown, color: "text-muted-foreground", bg: "bg-muted" },
] as const;

type TaskPriority = (typeof TASK_PRIORITIES)[number]["key"];
type TaskFilter = "all" | "open" | "done" | "overdue";
type TaskSort = "due" | "priority" | "created";

const TASK_TEMPLATES = [
  { label: "Follow up", title: "Follow up with {name}", priority: "HIGH" as TaskPriority, daysOut: 1 },
  { label: "Send quote", title: "Send quote to {name}", priority: "NORMAL" as TaskPriority, daysOut: 0 },
  { label: "Schedule call", title: "Schedule a call with {name}", priority: "NORMAL" as TaskPriority, daysOut: 2 },
  { label: "Send invoice", title: "Send invoice to {name}", priority: "HIGH" as TaskPriority, daysOut: 0 },
  { label: "Prepare proposal", title: "Prepare proposal for {name}", priority: "NORMAL" as TaskPriority, daysOut: 3 },
];

function getPriorityConfig(priority?: string | null) {
  return TASK_PRIORITIES.find((p) => p.key === priority) || TASK_PRIORITIES[1];
}

function isOverdue(task: ContactTask) {
  if (task.status === "DONE" || !task.dueDate) return false;
  return new Date(task.dueDate) < new Date();
}

function isDueSoon(task: ContactTask) {
  if (task.status === "DONE" || !task.dueDate) return false;
  const due = new Date(task.dueDate);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

function formatRelativeDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
  if (diffDays <= 7) return `In ${diffDays} days`;
  return date.toLocaleDateString("en-TT", { dateStyle: "medium" });
}

interface JourneyMilestoneData {
  id: string;
  type: string;
  title: string;
  description?: string;
  date: string;
  value?: number;
  isNext?: boolean;
}

interface HealthMetricsData {
  engagement: number;
  payment: number;
  responsiveness: number;
  relationship: number;
}

interface ConversationContextData {
  lastDiscussed?: string;
  concerns?: string[];
  preferences?: string[];
  suggestedOpening?: string;
  sentiment?: string;
  engagementLevel?: string;
}

interface AiInsightData {
  summary: string;
  nextBestAction: string;
  reasoning?: string;
  confidence: number;
  suggestedMessage?: string;
  tags?: string[];
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
  healthMetrics?: HealthMetricsData | null;
  journeyMilestones?: JourneyMilestoneData[];
  conversationContext?: ConversationContextData | null;
  aiInsight?: AiInsightData | null;
  aiInsightLoading?: boolean;
  onGenerateAiInsight?: () => Promise<void>;
  onRefreshConversationContext?: () => Promise<void>;
}

export function ContactDetailTabs({
  contact,
  events,
  notes,
  tasks,
  activeTab,
  onSetActiveTab,
  onAddNote,
  onAddTask,
  onCompleteTask,
  onDeleteNote,
  onDeleteTask,
  healthMetrics,
  journeyMilestones = [],
  conversationContext,
  aiInsight,
  aiInsightLoading,
  onGenerateAiInsight,
  onRefreshConversationContext,
}: ContactDetailTabsProps) {
  const [newNote, setNewNote] = useState("");
  const [noteCategory, setNoteCategory] = useState<NoteCategory>("general");
  const [composerOpen, setComposerOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("NORMAL");
  const [newTaskRemindAt, setNewTaskRemindAt] = useState("");
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [timelineLimit, setTimelineLimit] = useState(20);
  const [notesLimit, setNotesLimit] = useState(20);
  const [tasksLimit, setTasksLimit] = useState(20);
  const [noteSearch, setNoteSearch] = useState("");
  const [noteFilter, setNoteFilter] = useState<NoteCategory | "all">("all");
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [taskCreatedId, setTaskCreatedId] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [taskSort, setTaskSort] = useState<TaskSort>("due");
  const [taskCopiedId, setTaskCopiedId] = useState<string | null>(null);
  const [noteCreatedFromTaskId, setNoteCreatedFromTaskId] = useState<string | null>(null);
  const [timelineEventCopied, setTimelineEventCopied] = useState<string | null>(null);
  const [timelineSection, setTimelineSection] = useState<"journey" | "events" | "insights">("journey");
  const [aiSuggestionCopied, setAiSuggestionCopied] = useState(false);

  const waPhone = getContactPhone(contact);

  const handleAddNote = async () => {
    if (!newNote.trim() || !onAddNote) return;
    setNoteLoading(true);
    await onAddNote(newNote.trim(), noteCategory);
    setNewNote("");
    setNoteCategory("general");
    setComposerOpen(false);
    setNoteLoading(false);
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !onAddTask) return;
    setTaskLoading(true);
    await onAddTask(newTaskTitle.trim(), {
      dueDate: newTaskDue ? new Date(newTaskDue).toISOString() : undefined,
      priority: newTaskPriority,
      remindAt: newTaskRemindAt ? new Date(newTaskRemindAt).toISOString() : undefined,
    });
    setNewTaskTitle("");
    setNewTaskDue("");
    setNewTaskPriority("NORMAL");
    setNewTaskRemindAt("");
    setTaskComposerOpen(false);
    setTaskLoading(false);
  };

  const applyTaskTemplate = (template: (typeof TASK_TEMPLATES)[number]) => {
    const title = template.title.replace("{name}", contact.firstName || "contact");
    setNewTaskTitle(title);
    setNewTaskPriority(template.priority);
    if (template.daysOut > 0) {
      const due = new Date();
      due.setDate(due.getDate() + template.daysOut);
      setNewTaskDue(due.toISOString().slice(0, 16));
    }
    setTaskComposerOpen(true);
  };

  const handleCopyTask = (taskId: string, title: string) => {
    navigator.clipboard.writeText(title);
    setTaskCopiedId(taskId);
    setTimeout(() => setTaskCopiedId(null), 2000);
  };

  const handleShareTaskWhatsApp = (title: string, dueDate?: string | null) => {
    if (!waPhone) return;
    const msg = dueDate
      ? `Reminder: ${title}\nDue: ${new Date(dueDate).toLocaleDateString("en-TT", { dateStyle: "medium" })}`
      : `Reminder: ${title}`;
    window.open(buildWhatsAppLink(waPhone, msg), "_blank");
  };

  const handleShareTaskEmail = (title: string, dueDate?: string | null) => {
    if (!contact.email) return;
    const subject = encodeURIComponent(`Task: ${title}`);
    const body = dueDate
      ? encodeURIComponent(`Task: ${title}\nDue: ${new Date(dueDate).toLocaleDateString("en-TT", { dateStyle: "medium" })}`)
      : encodeURIComponent(`Task: ${title}`);
    window.open(`mailto:${contact.email}?subject=${subject}&body=${body}`, "_blank");
  };

  const handleCreateNoteFromTask = async (taskId: string, title: string) => {
    if (!onAddNote) return;
    await onAddNote(`Task: ${title}`, "general");
    setNoteCreatedFromTaskId(taskId);
    setTimeout(() => setNoteCreatedFromTaskId(null), 2000);
  };

  const handleCopyEvent = (eventId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setTimelineEventCopied(eventId);
    setTimeout(() => setTimelineEventCopied(null), 2000);
  };

  const handleCreateTaskFromEvent = async (eventType: string) => {
    if (!onAddTask) return;
    const label = EVENT_LABELS[eventType] || eventType;
    await onAddTask(`Follow up on: ${label}`, { priority: "NORMAL" });
  };

  const handleCreateNoteFromEvent = async (eventType: string) => {
    if (!onAddNote) return;
    const label = EVENT_LABELS[eventType] || eventType;
    await onAddNote(`Event: ${label}`, "general");
  };

  const handleCopyAiSuggestion = (text: string) => {
    navigator.clipboard.writeText(text);
    setAiSuggestionCopied(true);
    setTimeout(() => setAiSuggestionCopied(false), 2000);
  };

  const handleShareAiSuggestionWhatsApp = (text: string) => {
    if (!waPhone) return;
    window.open(buildWhatsAppLink(waPhone, text), "_blank");
  };

  const handleShareAiSuggestionEmail = (text: string) => {
    if (!contact.email) return;
    const subject = encodeURIComponent(`Following up — ${contact.firstName || "contact"}`);
    const body = encodeURIComponent(text);
    window.open(`mailto:${contact.email}?subject=${subject}&body=${body}`, "_blank");
  };

  const applyTemplate = (template: (typeof NOTE_TEMPLATES)[number]) => {
    setNoteCategory(template.category);
    setNewNote(template.body.replace("{name}", contact.firstName || "contact"));
    setComposerOpen(true);
  };

  const togglePin = (noteId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const handleCopyNote = (noteId: string, body: string) => {
    navigator.clipboard.writeText(body);
    setCopiedId(noteId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShareWhatsApp = (body: string) => {
    if (!waPhone) return;
    window.open(buildWhatsAppLink(waPhone, body), "_blank");
  };

  const handleShareEmail = (body: string) => {
    if (!contact.email) return;
    const subject = encodeURIComponent(`Note re: ${contact.firstName || "contact"}`);
    const encodedBody = encodeURIComponent(body);
    window.open(`mailto:${contact.email}?subject=${subject}&body=${encodedBody}`, "_blank");
  };

  const handleCreateTaskFromNote = async (noteId: string, body: string) => {
    if (!onAddTask) return;
    const title = body.length > 80 ? body.slice(0, 77) + "..." : body;
    await onAddTask(`Note: ${title}`, { priority: "NORMAL" });
    setTaskCreatedId(noteId);
    setTimeout(() => setTaskCreatedId(null), 2000);
  };

  const filteredNotes = useMemo(() => {
    let result = [...notes];

    if (noteFilter !== "all") {
      result = result.filter((n) => {
        const cat = getCategoryConfig(n.source);
        return cat.key === noteFilter;
      });
    }

    if (noteSearch.trim()) {
      const q = noteSearch.toLowerCase();
      result = result.filter((n) => n.body.toLowerCase().includes(q));
    }

    const pinned = result.filter((n) => pinnedIds.has(n.id));
    const unpinned = result.filter((n) => !pinnedIds.has(n.id));
    return [...pinned, ...unpinned];
  }, [notes, noteFilter, noteSearch, pinnedIds]);

  const activeCategoryCount = useMemo(() => {
    const counts: Record<string, number> = {};
    notes.forEach((n) => {
      const cat = getCategoryConfig(n.source);
      counts[cat.key] = (counts[cat.key] || 0) + 1;
    });
    return counts;
  }, [notes]);

  const taskCounts = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "DONE").length;
    const done = tasks.filter((t) => t.status === "DONE").length;
    const overdue = tasks.filter((t) => isOverdue(t)).length;
    return { open, done, overdue, all: tasks.length };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    if (taskFilter === "open") result = result.filter((t) => t.status !== "DONE");
    else if (taskFilter === "done") result = result.filter((t) => t.status === "DONE");
    else if (taskFilter === "overdue") result = result.filter((t) => isOverdue(t));

    if (taskSearch.trim()) {
      const q = taskSearch.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      if (taskSort === "priority") {
        const order: Record<string, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };
        return (order[a.priority || "NORMAL"] ?? 1) - (order[b.priority || "NORMAL"] ?? 1);
      }
      if (taskSort === "due") {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    return result;
  }, [tasks, taskFilter, taskSearch, taskSort]);

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

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pt-3 pb-6">
        {activeTab === "notes" && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search notes..."
                  value={noteSearch}
                  onChange={(e) => setNoteSearch(e.target.value)}
                  className="kf-input w-full pl-8 text-sm h-8"
                />
              </div>
              {!composerOpen && onAddNote && (
                <button
                  onClick={() => setComposerOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: "hsl(var(--kf-accent1) / 0.15)", color: "hsl(var(--kf-accent1))" }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Note
                </button>
              )}
            </div>

            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setNoteFilter("all")}
                className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                  noteFilter === "all"
                    ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({notes.length})
              </button>
              {NOTE_CATEGORIES.map((cat) => {
                const count = activeCategoryCount[cat.key] || 0;
                if (count === 0 && noteFilter !== cat.key) return null;
                return (
                  <button
                    key={cat.key}
                    onClick={() => setNoteFilter(noteFilter === cat.key ? "all" : cat.key)}
                    className={`text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                      noteFilter === cat.key
                        ? `${cat.bg} ${cat.color}`
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <cat.icon className="w-2.5 h-2.5" />
                    {cat.label} ({count})
                  </button>
                );
              })}
            </div>

            {composerOpen && onAddNote && (
              <div className="rounded-xl bg-muted/30 border border-border/50 overflow-hidden">
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1 flex-wrap">
                      {NOTE_CATEGORIES.map((cat) => (
                        <button
                          key={cat.key}
                          onClick={() => setNoteCategory(cat.key)}
                          className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors ${
                            noteCategory === cat.key
                              ? `${cat.bg} ${cat.color} ring-1 ring-current/30`
                              : "bg-muted/50 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <cat.icon className="w-2.5 h-2.5" />
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => { setComposerOpen(false); setNewNote(""); }}
                      className="text-muted-foreground hover:text-foreground text-xs px-1.5"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="flex gap-1 flex-wrap">
                    {NOTE_TEMPLATES.map((t) => (
                      <button
                        key={t.label}
                        onClick={() => applyTemplate(t)}
                        className="text-[10px] px-2 py-1 rounded-md bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <textarea
                    placeholder="Write a note..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="kf-input w-full min-h-[80px] resize-none text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleAddNote();
                      }
                    }}
                  />

                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {typeof navigator !== "undefined" && navigator?.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to save
                    </span>
                    <button
                      onClick={handleAddNote}
                      disabled={!newNote.trim() || noteLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium kf-btn-primary disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {noteLoading ? "Saving..." : "Save Note"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {filteredNotes.length === 0 ? (
              <div className="text-center py-6 space-y-2">
                <StickyNote className="w-8 h-8 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {noteSearch || noteFilter !== "all"
                    ? "No matching notes"
                    : "No notes yet"}
                </p>
                {!composerOpen && noteFilter === "all" && !noteSearch && onAddNote && (
                  <button
                    onClick={() => setComposerOpen(true)}
                    className="text-xs text-[hsl(var(--kf-accent2))] hover:underline"
                  >
                    Add your first note
                  </button>
                )}
              </div>
            ) : (
              <>
                {filteredNotes.slice(0, notesLimit).map((note) => {
                  const cat = getCategoryConfig(note.source);
                  const isPinned = pinnedIds.has(note.id);
                  const CatIcon = cat.icon;

                  return (
                    <div
                      key={note.id}
                      className={`group rounded-xl border overflow-hidden transition-colors ${
                        isPinned
                          ? "bg-[hsl(var(--kf-accent1))]/5 border-[hsl(var(--kf-accent1))]/20"
                          : "bg-muted/30 border-border/50"
                      }`}
                    >
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ${cat.bg} ${cat.color}`}>
                              <CatIcon className="w-2.5 h-2.5" />
                              {cat.label}
                            </span>
                            {isPinned && (
                              <Pin className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                            {new Date(note.createdAt).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })}
                          </span>
                        </div>

                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{note.body}</p>
                      </div>

                      <div className="flex items-center gap-0.5 px-2 py-1.5 border-t border-border/30 opacity-0 group-hover:opacity-100 transition-opacity bg-muted/20">
                        <button
                          onClick={() => togglePin(note.id)}
                          className="p-1.5 rounded-md hover:bg-muted transition-colors"
                          title={isPinned ? "Unpin" : "Pin to top"}
                        >
                          {isPinned ? (
                            <PinOff className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <Pin className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </button>

                        <button
                          onClick={() => handleCopyNote(note.id, note.body)}
                          className="p-1.5 rounded-md hover:bg-muted transition-colors"
                          title="Copy note"
                        >
                          {copiedId === note.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </button>

                        {waPhone && (
                          <button
                            onClick={() => handleShareWhatsApp(note.body)}
                            className="p-1.5 rounded-md hover:bg-emerald-500/10 transition-colors"
                            title="Share via WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                          </button>
                        )}

                        {contact.email && (
                          <button
                            onClick={() => handleShareEmail(note.body)}
                            className="p-1.5 rounded-md hover:bg-blue-500/10 transition-colors"
                            title="Share via Email"
                          >
                            <Mail className="w-3.5 h-3.5 text-blue-400" />
                          </button>
                        )}

                        {onAddTask && (
                          <button
                            onClick={() => handleCreateTaskFromNote(note.id, note.body)}
                            className="p-1.5 rounded-md hover:bg-violet-500/10 transition-colors"
                            title="Create task from this note"
                          >
                            {taskCreatedId === note.id ? (
                              <Check className="w-3.5 h-3.5 text-violet-400" />
                            ) : (
                              <ListPlus className="w-3.5 h-3.5 text-violet-400" />
                            )}
                          </button>
                        )}

                        <div className="flex-1" />

                        {onDeleteNote && (
                          <button
                            onClick={() => onDeleteNote(note.id)}
                            className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors"
                            title="Delete note"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredNotes.length > notesLimit && (
                  <button
                    onClick={() => setNotesLimit((p) => p + 20)}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1 transition-colors"
                  >
                    <ChevronDown className="w-3 h-3" />
                    Show more ({filteredNotes.length - notesLimit} remaining)
                  </button>
                )}
              </>
            )}
          </>
        )}

        {activeTab === "timeline" && (
          <>
            <div className="flex items-center gap-1">
              {([
                { key: "journey" as const, label: "Journey", icon: Clock },
                { key: "events" as const, label: "Events", icon: History },
                { key: "insights" as const, label: "Insights", icon: Brain },
              ]).map((s) => (
                <button
                  key={s.key}
                  onClick={() => setTimelineSection(s.key)}
                  className={`text-[10px] px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1 ${
                    timelineSection === s.key
                      ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <s.icon className="w-3 h-3" />
                  {s.label}
                </button>
              ))}
            </div>

            {timelineSection === "journey" && (
              <div className="space-y-3">
                {healthMetrics && (
                  <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium flex items-center gap-1.5">
                        <Heart className="w-3.5 h-3.5" style={{ color: (Object.values(healthMetrics).reduce((s, v) => s + v, 0) / 4) >= 60 ? "hsl(142 76% 36%)" : "hsl(var(--kf-accent1))" }} />
                        Contact Health
                      </span>
                      <span className="text-xs font-medium" style={{
                        color: (Object.values(healthMetrics).reduce((s, v) => s + v, 0) / 4) >= 80
                          ? "hsl(142 76% 36%)"
                          : (Object.values(healthMetrics).reduce((s, v) => s + v, 0) / 4) >= 60
                          ? "hsl(var(--kf-accent2))"
                          : "hsl(var(--kf-accent1))"
                      }}>
                        {Math.round(Object.values(healthMetrics).reduce((s, v) => s + v, 0) / 4)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {HEALTH_METRICS_CONFIG.map(({ key, label, icon: Icon }) => {
                        const value = healthMetrics[key];
                        const barColor = value >= 70 ? "hsl(142 76% 36%)" : value >= 40 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))";
                        return (
                          <div key={key} className="space-y-0.5">
                            <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                              <Icon className="w-2.5 h-2.5" />
                              {label}
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: barColor }} />
                            </div>
                            <div className="text-[9px] font-medium" style={{ color: barColor }}>{value}%</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {journeyMilestones.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                      <Clock className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                      Journey with {contact.firstName || "contact"}
                    </div>
                    <div className="relative pl-5 space-y-3">
                      <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-gradient-to-b from-[hsl(var(--kf-accent1))] via-[hsl(var(--kf-accent2))] to-muted" />

                      {journeyMilestones
                        .filter((m) => !m.isNext)
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                        .map((milestone) => {
                          const config = MILESTONE_ICONS[milestone.type] || { icon: Circle, color: "hsl(var(--kf-muted-foreground))" };
                          const MIcon = config.icon;
                          return (
                            <div key={milestone.id} className="group relative flex gap-2.5">
                              <div
                                className="absolute left-[-14px] p-1 rounded-full bg-background border-2 z-10"
                                style={{ borderColor: config.color }}
                              >
                                <MIcon className="w-2.5 h-2.5" style={{ color: config.color }} />
                              </div>
                              <div className="flex-1 ml-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-sm">{milestone.title}</span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {new Date(milestone.date).toLocaleDateString("en-TT", { month: "short", day: "numeric" })}
                                  </span>
                                </div>
                                {milestone.description && (
                                  <p className="text-[11px] text-muted-foreground mt-0.5">{milestone.description}</p>
                                )}
                                {milestone.value != null && milestone.value > 0 && (
                                  <p className="text-[11px] font-medium mt-0.5" style={{ color: config.color }}>
                                    TTD {milestone.value.toLocaleString()}
                                  </p>
                                )}
                                <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleCopyEvent(milestone.id, `${milestone.title} — ${new Date(milestone.date).toLocaleDateString("en-TT")}`)}
                                    className="p-1 rounded-md hover:bg-muted transition-colors"
                                    title="Copy"
                                  >
                                    {timelineEventCopied === milestone.id ? (
                                      <Check className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3 h-3 text-muted-foreground" />
                                    )}
                                  </button>
                                  {onAddNote && (
                                    <button
                                      onClick={() => handleCreateNoteFromEvent(milestone.type)}
                                      className="p-1 rounded-md hover:bg-violet-500/10 transition-colors"
                                      title="Create note from milestone"
                                    >
                                      <StickyNote className="w-3 h-3 text-violet-400" />
                                    </button>
                                  )}
                                  {onAddTask && (
                                    <button
                                      onClick={() => handleCreateTaskFromEvent(milestone.type)}
                                      className="p-1 rounded-md hover:bg-blue-500/10 transition-colors"
                                      title="Create task from milestone"
                                    >
                                      <ListTodo className="w-3 h-3 text-blue-400" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                      {journeyMilestones.filter((m) => m.isNext).map((nextM) => {
                        const daysDiff = Math.ceil((new Date(nextM.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                        return (
                          <div key={nextM.id} className="relative flex gap-2.5">
                            <div className="absolute left-[-14px] p-1 rounded-full bg-background border-2 border-dashed border-[hsl(var(--kf-accent1))] z-10">
                              <ChevronRight className="w-2.5 h-2.5 text-[hsl(var(--kf-accent1))]" />
                            </div>
                            <div className="flex-1 ml-2 p-2.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-xs flex items-center gap-1">
                                  NEXT: {nextM.title}
                                </span>
                                <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">
                                  {daysDiff > 0 ? `${daysDiff}d away` : daysDiff === 0 ? "Today" : "Overdue"}
                                </span>
                              </div>
                              {nextM.description && (
                                <p className="text-[11px] text-muted-foreground mt-1">{nextM.description}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <Clock className="w-6 h-6 mx-auto text-muted-foreground/40 mb-1" />
                    <p className="text-xs text-muted-foreground">No journey milestones yet</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">Milestones appear as the relationship develops</p>
                  </div>
                )}

                {conversationContext && (
                  <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                        Conversation Context
                      </span>
                      {onRefreshConversationContext && (
                        <button onClick={onRefreshConversationContext} className="p-1 rounded-md hover:bg-muted transition-colors" title="Refresh context">
                          <RefreshCw className="w-3 h-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>

                    {conversationContext.lastDiscussed && (
                      <div className="p-2 rounded-lg bg-muted/30 text-xs">
                        <span className="text-muted-foreground">Last discussed: </span>
                        <span>{conversationContext.lastDiscussed}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      {conversationContext.sentiment && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          conversationContext.sentiment === "positive" ? "bg-emerald-500/10 text-emerald-400"
                          : conversationContext.sentiment === "negative" ? "bg-red-500/10 text-red-400"
                          : "bg-muted text-muted-foreground"
                        }`}>
                          {conversationContext.sentiment === "positive" ? "Positive" : conversationContext.sentiment === "negative" ? "Needs care" : "Neutral"} sentiment
                        </span>
                      )}
                      {conversationContext.engagementLevel && (
                        <span className="text-[10px] text-muted-foreground">
                          Engagement: <span className="font-medium capitalize">{conversationContext.engagementLevel}</span>
                        </span>
                      )}
                    </div>

                    {conversationContext.concerns && conversationContext.concerns.length > 0 && (
                      <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                        <div className="text-[10px] font-medium text-amber-400 flex items-center gap-1 mb-1">
                          <AlertCircle className="w-2.5 h-2.5" />
                          Concerns
                        </div>
                        {conversationContext.concerns.map((c, i) => (
                          <p key={i} className="text-[11px] flex items-start gap-1">
                            <span className="text-amber-400">•</span> {c}
                          </p>
                        ))}
                      </div>
                    )}

                    {conversationContext.preferences && conversationContext.preferences.length > 0 && (
                      <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent2))]/10">
                        <div className="text-[10px] font-medium text-[hsl(var(--kf-accent2))] flex items-center gap-1 mb-1">
                          <Heart className="w-2.5 h-2.5" />
                          Preferences
                        </div>
                        {conversationContext.preferences.map((p, i) => (
                          <p key={i} className="text-[11px] flex items-start gap-1">
                            <span className="text-[hsl(var(--kf-accent2))]">•</span> {p}
                          </p>
                        ))}
                      </div>
                    )}

                    {conversationContext.suggestedOpening && (
                      <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/10">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" />
                            Suggested opening
                          </span>
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => handleCopyAiSuggestion(conversationContext.suggestedOpening!)} className="p-1 rounded-md hover:bg-muted transition-colors" title="Copy">
                              {aiSuggestionCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                            </button>
                            {waPhone && (
                              <button onClick={() => handleShareAiSuggestionWhatsApp(conversationContext.suggestedOpening!)} className="p-1 rounded-md hover:bg-emerald-500/10 transition-colors" title="Send via WhatsApp">
                                <MessageCircle className="w-3 h-3 text-emerald-500" />
                              </button>
                            )}
                            {contact.email && (
                              <button onClick={() => handleShareAiSuggestionEmail(conversationContext.suggestedOpening!)} className="p-1 rounded-md hover:bg-blue-500/10 transition-colors" title="Send via Email">
                                <Mail className="w-3 h-3 text-blue-400" />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-[11px] italic">"{conversationContext.suggestedOpening}"</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {timelineSection === "events" && (
              <div className="space-y-2">
                {events.length === 0 ? (
                  <div className="text-center py-6 space-y-1">
                    <History className="w-6 h-6 mx-auto text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground">No events yet</p>
                  </div>
                ) : (
                  <>
                    <div className="relative pl-5 space-y-2">
                      <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-border/50" />
                      {events.slice(0, timelineLimit).map((event) => {
                        const evConfig = EVENT_ICONS[event.type] || { icon: Circle, color: "hsl(var(--kf-muted-foreground))" };
                        const EvIcon = evConfig.icon;
                        return (
                          <div key={event.id} className="group relative flex gap-2.5">
                            <div
                              className="absolute left-[-14px] p-1 rounded-full bg-background border-2 z-10"
                              style={{ borderColor: evConfig.color }}
                            >
                              <EvIcon className="w-2.5 h-2.5" style={{ color: evConfig.color }} />
                            </div>
                            <div className="flex-1 ml-2 p-2.5 rounded-xl bg-muted/30 border border-border/50">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">{EVENT_LABELS[event.type] || event.type}</span>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  {new Date(event.createdAt).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })}
                                </span>
                              </div>
                              <div className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handleCopyEvent(event.id, `${EVENT_LABELS[event.type] || event.type} — ${new Date(event.createdAt).toLocaleString("en-TT")}`)}
                                  className="p-1 rounded-md hover:bg-muted transition-colors"
                                  title="Copy event"
                                >
                                  {timelineEventCopied === event.id ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3 text-muted-foreground" />
                                  )}
                                </button>
                                {onAddNote && (
                                  <button
                                    onClick={() => handleCreateNoteFromEvent(event.type)}
                                    className="p-1 rounded-md hover:bg-violet-500/10 transition-colors"
                                    title="Create note from event"
                                  >
                                    <StickyNote className="w-3 h-3 text-violet-400" />
                                  </button>
                                )}
                                {onAddTask && (
                                  <button
                                    onClick={() => handleCreateTaskFromEvent(event.type)}
                                    className="p-1 rounded-md hover:bg-blue-500/10 transition-colors"
                                    title="Create task from event"
                                  >
                                    <ListTodo className="w-3 h-3 text-blue-400" />
                                  </button>
                                )}
                                {waPhone && (
                                  <button
                                    onClick={() => handleShareTaskWhatsApp(EVENT_LABELS[event.type] || event.type)}
                                    className="p-1 rounded-md hover:bg-emerald-500/10 transition-colors"
                                    title="Share via WhatsApp"
                                  >
                                    <MessageCircle className="w-3 h-3 text-emerald-500" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {events.length > timelineLimit && (
                      <button
                        onClick={() => setTimelineLimit((p) => p + 20)}
                        className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1 transition-colors"
                      >
                        <ChevronDown className="w-3 h-3" />
                        Show more ({events.length - timelineLimit} remaining)
                      </button>
                    )}
                    {timelineLimit > 20 && (
                      <button
                        onClick={() => setTimelineLimit(20)}
                        className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 flex items-center justify-center gap-1 transition-colors"
                      >
                        <ChevronUp className="w-3 h-3" />
                        Show less
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {timelineSection === "insights" && (
              <div className="space-y-3">
                {aiInsight ? (
                  <>
                    <div className="rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/5 to-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent1))]/20 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] flex items-center gap-1 mb-1">
                            <Brain className="w-3 h-3" />
                            AI Summary
                          </div>
                          <p className="text-sm">{aiInsight.summary}</p>
                        </div>
                        {aiInsight.confidence > 0 && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                            aiInsight.confidence >= 80 ? "bg-emerald-500/10 text-emerald-400"
                            : aiInsight.confidence >= 50 ? "bg-amber-500/10 text-amber-400"
                            : "bg-red-500/10 text-red-400"
                          }`}>
                            {aiInsight.confidence}%
                          </span>
                        )}
                      </div>
                      {aiInsight.reasoning && (
                        <p className="text-[11px] text-muted-foreground italic">{aiInsight.reasoning}</p>
                      )}
                    </div>

                    <div className="rounded-xl bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/20 p-3 space-y-1">
                      <div className="text-[10px] font-medium text-[hsl(var(--kf-accent2))] flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        Next Best Action
                      </div>
                      <p className="text-sm font-medium">{aiInsight.nextBestAction}</p>
                      <div className="flex items-center gap-0.5 pt-1">
                        {onAddTask && (
                          <button
                            onClick={() => onAddTask(aiInsight.nextBestAction, { priority: "HIGH" })}
                            className="text-[10px] px-2 py-1 rounded-md bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors flex items-center gap-1"
                          >
                            <ListTodo className="w-2.5 h-2.5" />
                            Create Task
                          </button>
                        )}
                        {onAddNote && (
                          <button
                            onClick={() => onAddNote(aiInsight.nextBestAction, "general")}
                            className="text-[10px] px-2 py-1 rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                          >
                            <StickyNote className="w-2.5 h-2.5" />
                            Save as Note
                          </button>
                        )}
                      </div>
                    </div>

                    {aiInsight.suggestedMessage && (
                      <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            Suggested Message
                          </span>
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => handleCopyAiSuggestion(aiInsight.suggestedMessage!)} className="p-1 rounded-md hover:bg-muted transition-colors" title="Copy">
                              {aiSuggestionCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                            </button>
                            {waPhone && (
                              <button onClick={() => handleShareAiSuggestionWhatsApp(aiInsight.suggestedMessage!)} className="p-1 rounded-md hover:bg-emerald-500/10 transition-colors" title="Send via WhatsApp">
                                <MessageCircle className="w-3 h-3 text-emerald-500" />
                              </button>
                            )}
                            {contact.email && (
                              <button onClick={() => handleShareAiSuggestionEmail(aiInsight.suggestedMessage!)} className="p-1 rounded-md hover:bg-blue-500/10 transition-colors" title="Send via Email">
                                <Mail className="w-3 h-3 text-blue-400" />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm italic border-l-2 border-[hsl(var(--kf-accent1))] pl-2.5">"{aiInsight.suggestedMessage}"</p>
                      </div>
                    )}

                    {aiInsight.tags && aiInsight.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {aiInsight.tags.map((tag) => (
                          <span key={tag} className="px-2 py-0.5 text-[10px] rounded-full bg-muted text-muted-foreground">{tag}</span>
                        ))}
                      </div>
                    )}

                    {onGenerateAiInsight && (
                      <button
                        onClick={onGenerateAiInsight}
                        disabled={aiInsightLoading}
                        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${aiInsightLoading ? "animate-spin" : ""}`} />
                        {aiInsightLoading ? "Analyzing..." : "Regenerate Insights"}
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-6 space-y-3">
                    <div className="mx-auto w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <Brain className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">AI-powered insights for this contact</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">Analyzes activity, payments, and engagement</p>
                    </div>
                    {onGenerateAiInsight && (
                      <button
                        onClick={onGenerateAiInsight}
                        disabled={aiInsightLoading}
                        className="kf-btn-primary inline-flex items-center gap-1.5 text-xs"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {aiInsightLoading ? "Analyzing..." : "Generate Insights"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "tasks" && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  className="kf-input w-full pl-8 text-sm h-8"
                />
              </div>
              {!taskComposerOpen && onAddTask && (
                <button
                  onClick={() => setTaskComposerOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: "hsl(var(--kf-accent2) / 0.15)", color: "hsl(var(--kf-accent2))" }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Task
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {([
                { key: "all" as TaskFilter, label: "All", count: taskCounts.all },
                { key: "open" as TaskFilter, label: "Open", count: taskCounts.open },
                { key: "done" as TaskFilter, label: "Done", count: taskCounts.done },
                { key: "overdue" as TaskFilter, label: "Overdue", count: taskCounts.overdue },
              ] as const).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setTaskFilter(f.key)}
                  className={`text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                    taskFilter === f.key
                      ? f.key === "overdue"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))]"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.key === "overdue" && <AlertTriangle className="w-2.5 h-2.5" />}
                  {f.label} ({f.count})
                </button>
              ))}
              <div className="flex-1" />
              <div className="flex items-center gap-0.5">
                {([
                  { key: "due" as TaskSort, label: "Due", icon: Calendar },
                  { key: "priority" as TaskSort, label: "Priority", icon: Flag },
                  { key: "created" as TaskSort, label: "Newest", icon: Clock },
                ] as const).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setTaskSort(s.key)}
                    className={`text-[10px] px-1.5 py-1 rounded-md transition-colors flex items-center gap-0.5 ${
                      taskSort === s.key
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title={`Sort by ${s.label}`}
                  >
                    <s.icon className="w-2.5 h-2.5" />
                  </button>
                ))}
              </div>
            </div>

            {taskComposerOpen && onAddTask && (
              <div className="rounded-xl bg-muted/30 border border-border/50 overflow-hidden">
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1 flex-wrap">
                      {TASK_PRIORITIES.map((p) => (
                        <button
                          key={p.key}
                          onClick={() => setNewTaskPriority(p.key)}
                          className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors ${
                            newTaskPriority === p.key
                              ? `${p.bg} ${p.color} ring-1 ring-current/30`
                              : "bg-muted/50 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <p.icon className="w-2.5 h-2.5" />
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => { setTaskComposerOpen(false); setNewTaskTitle(""); setNewTaskDue(""); setNewTaskRemindAt(""); setNewTaskPriority("NORMAL"); }}
                      className="text-muted-foreground hover:text-foreground text-xs px-1.5"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="flex gap-1 flex-wrap">
                    {TASK_TEMPLATES.map((t) => (
                      <button
                        key={t.label}
                        onClick={() => applyTaskTemplate(t)}
                        className="text-[10px] px-2 py-1 rounded-md bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    placeholder="What needs to be done?"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    className="kf-input w-full text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleAddTask();
                      }
                    }}
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground mb-0.5 block">Due date</label>
                      <input
                        type="datetime-local"
                        value={newTaskDue}
                        onChange={(e) => setNewTaskDue(e.target.value)}
                        className="kf-input w-full text-xs h-8"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground mb-0.5 block">Remind at</label>
                      <input
                        type="datetime-local"
                        value={newTaskRemindAt}
                        onChange={(e) => setNewTaskRemindAt(e.target.value)}
                        className="kf-input w-full text-xs h-8"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {typeof navigator !== "undefined" && navigator?.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to save
                    </span>
                    <button
                      onClick={handleAddTask}
                      disabled={!newTaskTitle.trim() || taskLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium kf-btn-primary disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {taskLoading ? "Saving..." : "Add Task"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {filteredTasks.length === 0 ? (
              <div className="text-center py-6 space-y-2">
                <ListTodo className="w-8 h-8 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {taskSearch || taskFilter !== "all"
                    ? "No matching tasks"
                    : "No tasks yet"}
                </p>
                {!taskComposerOpen && taskFilter === "all" && !taskSearch && onAddTask && (
                  <button
                    onClick={() => setTaskComposerOpen(true)}
                    className="text-xs text-[hsl(var(--kf-accent2))] hover:underline"
                  >
                    Add your first task
                  </button>
                )}
              </div>
            ) : (
              <>
                {filteredTasks.slice(0, tasksLimit).map((task) => {
                  const prio = getPriorityConfig(task.priority);
                  const PrioIcon = prio.icon;
                  const overdue = isOverdue(task);
                  const dueSoon = isDueSoon(task);
                  const isDone = task.status === "DONE";

                  return (
                    <div
                      key={task.id}
                      className={`group rounded-xl border overflow-hidden transition-colors ${
                        overdue
                          ? "bg-red-500/5 border-red-500/20"
                          : dueSoon
                          ? "bg-amber-500/5 border-amber-500/20"
                          : isDone
                          ? "bg-muted/20 border-border/30"
                          : "bg-muted/30 border-border/50"
                      }`}
                    >
                      <div className="p-3">
                        <div className="flex items-start gap-2">
                          {onCompleteTask && (
                            <button
                              onClick={() => onCompleteTask(task.id, task.status ?? undefined)}
                              className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 transition-colors flex items-center justify-center ${
                                isDone
                                  ? "border-[hsl(var(--kf-accent2))] bg-[hsl(var(--kf-accent2))]/20 hover:border-muted-foreground/40 hover:bg-transparent"
                                  : "border-muted-foreground/40 hover:border-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/10"
                              }`}
                              title={isDone ? "Mark as incomplete" : "Complete task"}
                            >
                              <Check className={`w-3 h-3 ${isDone ? "text-[hsl(var(--kf-accent2))]" : "opacity-0 group-hover:opacity-30 text-[hsl(var(--kf-accent2))]"}`} />
                            </button>
                          )}
                          {isDone && !onCompleteTask && (
                            <CheckCircle2 className="mt-0.5 shrink-0 w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ${prio.bg} ${prio.color}`}>
                                <PrioIcon className="w-2.5 h-2.5" />
                                {prio.label}
                              </span>
                              {overdue && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-400">
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  Overdue
                                </span>
                              )}
                              {dueSoon && !overdue && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400">
                                  <Clock className="w-2.5 h-2.5" />
                                  Due soon
                                </span>
                              )}
                              {isDone && task.completedAt && (
                                <span className="text-[10px] text-muted-foreground">
                                  Completed {formatRelativeDate(task.completedAt)}
                                </span>
                              )}
                            </div>
                            <p className={`text-sm font-medium leading-snug ${isDone ? "line-through text-muted-foreground" : ""}`}>
                              {task.title}
                            </p>
                            <div className="flex items-center gap-3 mt-1">
                              {task.dueDate && (
                                <span className={`flex items-center gap-1 text-[11px] ${
                                  overdue ? "text-red-400" : dueSoon ? "text-amber-400" : "text-muted-foreground"
                                }`}>
                                  <Calendar className="w-3 h-3" />
                                  {formatRelativeDate(task.dueDate)}
                                </span>
                              )}
                              {task.remindAt && (
                                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Bell className="w-3 h-3" />
                                  {formatRelativeDate(task.remindAt)}
                                </span>
                              )}
                              {task.source && task.source !== "crm" && (
                                <span className="text-[10px] text-muted-foreground/60">
                                  via {task.source}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 px-2 py-1.5 border-t border-border/30 opacity-0 group-hover:opacity-100 transition-opacity bg-muted/20">
                        <button
                          onClick={() => handleCopyTask(task.id, task.title)}
                          className="p-1.5 rounded-md hover:bg-muted transition-colors"
                          title="Copy task"
                        >
                          {taskCopiedId === task.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </button>

                        {waPhone && (
                          <button
                            onClick={() => handleShareTaskWhatsApp(task.title, task.dueDate)}
                            className="p-1.5 rounded-md hover:bg-emerald-500/10 transition-colors"
                            title="Send reminder via WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                          </button>
                        )}

                        {contact.email && (
                          <button
                            onClick={() => handleShareTaskEmail(task.title, task.dueDate)}
                            className="p-1.5 rounded-md hover:bg-blue-500/10 transition-colors"
                            title="Send reminder via Email"
                          >
                            <Mail className="w-3.5 h-3.5 text-blue-400" />
                          </button>
                        )}

                        {onAddNote && (
                          <button
                            onClick={() => handleCreateNoteFromTask(task.id, task.title)}
                            className="p-1.5 rounded-md hover:bg-violet-500/10 transition-colors"
                            title="Create note from this task"
                          >
                            {noteCreatedFromTaskId === task.id ? (
                              <Check className="w-3.5 h-3.5 text-violet-400" />
                            ) : (
                              <StickyNote className="w-3.5 h-3.5 text-violet-400" />
                            )}
                          </button>
                        )}

                        <div className="flex-1" />

                        {onDeleteTask && (
                          <button
                            onClick={() => onDeleteTask(task.id)}
                            className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors"
                            title="Delete task"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredTasks.length > tasksLimit && (
                  <button
                    onClick={() => setTasksLimit((p) => p + 20)}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1 transition-colors"
                  >
                    <ChevronDown className="w-3 h-3" />
                    Show more ({filteredTasks.length - tasksLimit} remaining)
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
