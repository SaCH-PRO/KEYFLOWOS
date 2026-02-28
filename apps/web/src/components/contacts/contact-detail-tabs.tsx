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
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "./contact-detail";

const EVENT_LABELS: Record<string, string> = {
  "contact.created": "Contact created",
  "contact.updated": "Contact updated",
  "invoice.created": "Invoice created",
  "invoice.paid": "Invoice paid",
  "booking.created": "Booking made",
  "booking.completed": "Booking completed",
  "quote.created": "Quote sent",
  "quote.accepted": "Quote accepted",
  "note.added": "Note added",
  "note.created": "Note added",
  "task.created": "Task created",
  "task.completed": "Task completed",
  "email.sent": "Email sent",
  "whatsapp.sent": "WhatsApp message sent",
  "message.copied": "Message copied",
  "form.submitted": "Form submitted",
  "followup.scheduled": "Follow-up scheduled",
};

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

interface ContactDetailTabsProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  notes: ContactNote[];
  tasks: ContactTask[];
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
  onAddNote?: (body: string, source?: string) => Promise<void>;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  onCompleteTask?: (taskId: string) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
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
    <>
      <div className="flex border-b border-border overflow-x-auto" role="tablist">
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
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors border-b-2 -mb-px whitespace-nowrap ${
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

      <div className="space-y-3">
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
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No events yet</p>
            ) : (
              <>
                <div className="relative pl-4 border-l-2 border-border/50 space-y-3">
                  {events.slice(0, timelineLimit).map((event) => (
                    <div key={event.id} className="relative">
                      <div className="absolute -left-[21px] top-2 w-2.5 h-2.5 rounded-full border-2 border-border bg-background" />
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{EVENT_LABELS[event.type] || event.type}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(event.createdAt).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
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
                          {onCompleteTask && !isDone && (
                            <button
                              onClick={() => onCompleteTask(task.id)}
                              className="mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 border-muted-foreground/40 hover:border-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/10 transition-colors flex items-center justify-center"
                              title="Complete task"
                            >
                              <Check className="w-3 h-3 opacity-0 group-hover:opacity-30 text-[hsl(var(--kf-accent2))]" />
                            </button>
                          )}
                          {isDone && (
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
    </>
  );
}
