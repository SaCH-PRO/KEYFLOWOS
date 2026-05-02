"use client";

import { useState, useMemo } from "react";
import {
  MessageSquare,
  ListTodo,
  Phone,
  Mail,
  DollarSign,
  Calendar,
  Settings,
  StickyNote,
  Clock,
  Circle,
  Sparkles,
  Zap,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Star,
  Copy,
  Bell,
  TrendingUp,
  Users,
  RefreshCw,
  Tags,
  UserX,
  MessageCircle,
  Handshake,
  Video,
  ChevronDown,
  ChevronUp,
  Filter,
} from "lucide-react";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "./contact-detail";

type FilterType = "all" | "notes" | "tasks" | "calls" | "emails" | "payments" | "system";

interface TimelineItem {
  id: string;
  kind: "event" | "note" | "task";
  filterCategory: FilterType;
  icon: typeof MessageSquare;
  iconColor: string;
  title: string;
  description?: string;
  timestamp: string;
  raw: ContactEvent | ContactNote | ContactTask;
}

const FILTER_PILLS: { key: FilterType; label: string; icon: typeof MessageSquare }[] = [
  { key: "all", label: "All", icon: Filter },
  { key: "notes", label: "Notes", icon: StickyNote },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "calls", label: "Calls", icon: Phone },
  { key: "emails", label: "Emails", icon: Mail },
  { key: "payments", label: "Payments", icon: DollarSign },
  { key: "system", label: "System", icon: Settings },
];

const EVENT_TYPE_MAP: Record<string, { icon: typeof MessageSquare; color: string; label: string; filter: FilterType }> = {
  "contact.created": { icon: Sparkles, color: "hsl(var(--kf-accent1))", label: "Contact created", filter: "system" },
  "contact.updated": { icon: RefreshCw, color: "hsl(var(--kf-muted-foreground))", label: "Contact updated", filter: "system" },
  "contact.merged": { icon: Users, color: "hsl(var(--kf-accent2))", label: "Contacts merged", filter: "system" },
  "contact.deleted": { icon: UserX, color: "hsl(0 84% 60%)", label: "Contact deleted", filter: "system" },
  "contact.imported": { icon: Users, color: "hsl(var(--kf-accent2))", label: "Contact imported", filter: "system" },
  "contact.imported_from_media": { icon: Sparkles, color: "hsl(var(--kf-accent2))", label: "Contact scanned", filter: "system" },
  "status.changed": { icon: TrendingUp, color: "hsl(var(--kf-accent2))", label: "Status changed", filter: "system" },
  "STATUS_CHANGED": { icon: TrendingUp, color: "hsl(var(--kf-accent2))", label: "Status changed", filter: "system" },
  "invoice.created": { icon: FileText, color: "hsl(217 91% 60%)", label: "Invoice created", filter: "payments" },
  "invoice.sent": { icon: Mail, color: "hsl(217 91% 60%)", label: "Invoice sent", filter: "payments" },
  "invoice.paid": { icon: DollarSign, color: "hsl(142 76% 36%)", label: "Invoice paid", filter: "payments" },
  "invoice.overdue": { icon: AlertTriangle, color: "hsl(0 84% 60%)", label: "Invoice overdue", filter: "payments" },
  "invoice.void": { icon: FileText, color: "hsl(var(--kf-muted-foreground))", label: "Invoice voided", filter: "payments" },
  "invoice.payment_failed": { icon: AlertTriangle, color: "hsl(0 84% 60%)", label: "Payment failed", filter: "payments" },
  "booking.created": { icon: Calendar, color: "hsl(var(--kf-accent2))", label: "Booking made", filter: "system" },
  "booking.confirmed": { icon: CheckCircle2, color: "hsl(142 76% 36%)", label: "Booking confirmed", filter: "system" },
  "booking.completed": { icon: Star, color: "hsl(45 93% 47%)", label: "Booking completed", filter: "system" },
  "booking.cancelled": { icon: AlertTriangle, color: "hsl(0 84% 60%)", label: "Booking cancelled", filter: "system" },
  "quote.created": { icon: FileText, color: "hsl(217 91% 60%)", label: "Quote sent", filter: "payments" },
  "quote.sent": { icon: Mail, color: "hsl(217 91% 60%)", label: "Quote sent", filter: "payments" },
  "quote.accepted": { icon: CheckCircle2, color: "hsl(142 76% 36%)", label: "Quote accepted", filter: "payments" },
  "quote.rejected": { icon: AlertTriangle, color: "hsl(0 84% 60%)", label: "Quote rejected", filter: "payments" },
  "note.added": { icon: StickyNote, color: "hsl(var(--kf-muted-foreground))", label: "Note added", filter: "notes" },
  "note.created": { icon: StickyNote, color: "hsl(var(--kf-muted-foreground))", label: "Note added", filter: "notes" },
  "note.deleted": { icon: StickyNote, color: "hsl(var(--kf-muted-foreground))", label: "Note deleted", filter: "notes" },
  "task.created": { icon: ListTodo, color: "hsl(var(--kf-accent2))", label: "Task created", filter: "tasks" },
  "task.completed": { icon: CheckCircle2, color: "hsl(142 76% 36%)", label: "Task completed", filter: "tasks" },
  "task.reopened": { icon: RefreshCw, color: "hsl(var(--kf-accent1))", label: "Task reopened", filter: "tasks" },
  "task.deleted": { icon: ListTodo, color: "hsl(var(--kf-muted-foreground))", label: "Task deleted", filter: "tasks" },
  "email.sent": { icon: Mail, color: "hsl(217 91% 60%)", label: "Email sent", filter: "emails" },
  "whatsapp.sent": { icon: MessageCircle, color: "hsl(142 76% 36%)", label: "WhatsApp sent", filter: "calls" },
  "message.copied": { icon: Copy, color: "hsl(var(--kf-muted-foreground))", label: "Message copied", filter: "system" },
  "form.submitted": { icon: FileText, color: "hsl(var(--kf-accent1))", label: "Form submitted", filter: "system" },
  "followup.scheduled": { icon: Bell, color: "hsl(var(--kf-accent1))", label: "Follow-up scheduled", filter: "system" },
  "automation.run": { icon: Zap, color: "hsl(var(--kf-accent2))", label: "Automation triggered", filter: "system" },
  "automation.executed": { icon: Zap, color: "hsl(var(--kf-accent2))", label: "Automation executed", filter: "system" },
  "bulk.updated": { icon: Tags, color: "hsl(var(--kf-accent2))", label: "Bulk updated", filter: "system" },
  "call.logged": { icon: Phone, color: "hsl(var(--kf-accent2))", label: "Call logged", filter: "calls" },
  "meeting.logged": { icon: Video, color: "hsl(217 91% 60%)", label: "Meeting logged", filter: "calls" },
  "sms.logged": { icon: MessageSquare, color: "hsl(var(--kf-accent2))", label: "SMS logged", filter: "calls" },
};

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return new Intl.DateTimeFormat("en-TT", { dateStyle: "medium" }).format(new Date(dateStr));
}

function getEventDescription(event: ContactEvent): string | undefined {

  const data = event.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  if ((event.type === "status.changed" || event.type === "STATUS_CHANGED") && data.from && data.to) {
    return `${data.from} → ${data.to}`;
  }
  if (event.type === "bulk.updated" && data.status) {
    return `Status → ${data.status}`;
  }
  if (event.type === "bulk.updated" && Array.isArray(data.addedTags)) {
    return `Tags: ${(data.addedTags as string[]).join(", ")}`;
  }
  if (data.description && typeof data.description === "string") {
    return data.description;
  }
  return undefined;
}

interface ActivityTimelineProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  notes: ContactNote[];
  tasks: ContactTask[];
}

export function ActivityTimeline({ contact: _contact, events, notes, tasks }: ActivityTimelineProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [limit, setLimit] = useState(25);

  const items = useMemo<TimelineItem[]>(() => {
    const result: TimelineItem[] = [];

    for (const event of events) {
      const mapping = EVENT_TYPE_MAP[event.type];
      result.push({
        id: `ev-${event.id}`,
        kind: "event",
        filterCategory: mapping?.filter ?? "system",
        icon: mapping?.icon ?? Circle,
        iconColor: mapping?.color ?? "hsl(var(--kf-muted-foreground))",
        title: mapping?.label ?? event.type,
        description: getEventDescription(event),
        timestamp: event.createdAt,
        raw: event,
      });
    }

    for (const note of notes) {
      const noteCategory = note.source?.toLowerCase() ?? "general";
      let noteIcon = StickyNote;
      let noteColor = "hsl(var(--kf-muted-foreground))";
      if (noteCategory === "call") { noteIcon = Phone; noteColor = "hsl(var(--kf-accent2))"; }
      else if (noteCategory === "meeting") { noteIcon = Video; noteColor = "hsl(217 91% 60%)"; }
      else if (noteCategory === "deal") { noteIcon = Handshake; noteColor = "hsl(142 76% 36%)"; }
      else if (noteCategory === "follow-up") { noteIcon = Bell; noteColor = "hsl(var(--kf-accent1))"; }

      result.push({
        id: `note-${note.id}`,
        kind: "note",
        filterCategory: "notes",
        icon: noteIcon,
        iconColor: noteColor,
        title: "Note added",
        description: note.body.length > 120 ? note.body.slice(0, 120) + "…" : note.body,
        timestamp: note.createdAt,
        raw: note,
      });
    }

    for (const task of tasks) {
      const isDone = task.status === "DONE";
      result.push({
        id: `task-${task.id}`,
        kind: "task",
        filterCategory: "tasks",
        icon: isDone ? CheckCircle2 : ListTodo,
        iconColor: isDone ? "hsl(142 76% 36%)" : "hsl(var(--kf-accent2))",
        title: isDone ? "Task completed" : "Task created",
        description: task.title,
        timestamp: (isDone && task.completedAt) ? task.completedAt : (task.createdAt ?? new Date().toISOString()),
        raw: task,
      });
    }

    result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return result;
  }, [events, notes, tasks]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.filterCategory === filter);
  }, [items, filter]);

  const visible = filtered.slice(0, limit);
  const remaining = filtered.length - limit;

  const filterCounts = useMemo(() => {
    const counts: Record<FilterType, number> = { all: items.length, notes: 0, tasks: 0, calls: 0, emails: 0, payments: 0, system: 0 };
    for (const item of items) {
      counts[item.filterCategory] = (counts[item.filterCategory] || 0) + 1;
    }
    return counts;
  }, [items]);

  const groupedByDate = useMemo(() => {
    const groups: { label: string; items: TimelineItem[] }[] = [];
    let currentLabel = "";
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const todayStr = today.toDateString();
    const yesterdayStr = yesterday.toDateString();

    for (const item of visible) {
      const d = new Date(item.timestamp);
      const dStr = d.toDateString();
      let label: string;
      if (dStr === todayStr) label = "Today";
      else if (dStr === yesterdayStr) label = "Yesterday";
      else {
        const diffDays = Math.floor((today.getTime() - d.getTime()) / 86400000);
        if (diffDays < 7) label = "This Week";
        else if (diffDays < 30) label = "This Month";
        else label = d.toLocaleDateString("en-TT", { month: "long", year: "numeric" });
      }
      if (label !== currentLabel) {
        groups.push({ label, items: [] });
        currentLabel = label;
      }
      groups[groups.length - 1].items.push(item);
    }
    return groups;
  }, [visible]);

  if (items.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <Clock className="w-8 h-8 mx-auto text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No activity yet</p>
        <p className="text-xs text-muted-foreground/60">
          Notes, tasks, and events will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {FILTER_PILLS.map(({ key, label, icon: Icon }) => {
          const count = filterCounts[key];
          const isActive = filter === key;
          return (
            <button
              key={key}
              onClick={() => { setFilter(key); setLimit(25); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-all ${
                isActive
                  ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] shadow-sm shadow-[hsl(var(--kf-accent1))]/10"
                  : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
              {count > 0 && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                  isActive ? "bg-[hsl(var(--kf-accent1))]/20" : "bg-white/[0.06]"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {groupedByDate.map((group) => (
          <div key={group.label} className="space-y-1">
            <div className="flex items-center gap-2 px-1 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{group.label}</span>
              <div className="flex-1 h-px bg-border/30" />
              <span className="text-[10px] text-muted-foreground/40">{group.items.length}</span>
            </div>
            <div className="relative pl-5 space-y-1">
              <div className="absolute left-[9px] top-2 bottom-2 w-[2px] rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))]/40 via-border/30 to-transparent" />

              {group.items.map((item, idx) => {
                const Icon = item.icon;
                const isFirst = idx === 0 && group === groupedByDate[0];

                return (
                  <div key={item.id} className="group relative flex gap-3">
                    <div
                      className={`absolute left-[-12px] p-[5px] rounded-full bg-background border-2 z-10 transition-transform group-hover:scale-110 ${
                        isFirst ? "ring-2 ring-offset-1 ring-offset-background" : ""
                      }`}
                      style={{
                        borderColor: item.iconColor,
                        ...(isFirst ? { ringColor: item.iconColor } : {}),
                      }}
                    >
                      <Icon className="w-2.5 h-2.5" style={{ color: item.iconColor }} />
                    </div>

                    <div className="flex-1 ml-1 p-3 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1] transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{item.title}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                            item.kind === "note" ? "bg-violet-500/10 text-violet-400"
                              : item.kind === "task" ? "bg-blue-500/10 text-blue-400"
                              : "bg-white/[0.06] text-muted-foreground"
                          }`}>
                            {item.kind === "note" ? "Note" : item.kind === "task" ? "Task" : "Event"}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                          {getRelativeTime(item.timestamp)}
                        </span>
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                      )}
                      <div className="text-[10px] text-muted-foreground/50 mt-1">
                        {new Date(item.timestamp).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <button
          onClick={() => setLimit((p) => p + 25)}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1 transition-colors"
        >
          <ChevronDown className="w-3 h-3" />
          Show more ({remaining} remaining)
        </button>
      )}
      {limit > 25 && (
        <button
          onClick={() => setLimit(25)}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 flex items-center justify-center gap-1 transition-colors"
        >
          <ChevronUp className="w-3 h-3" />
          Show less
        </button>
      )}
    </div>
  );
}
