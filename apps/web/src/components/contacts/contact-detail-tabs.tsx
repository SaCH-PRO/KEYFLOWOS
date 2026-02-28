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

interface ContactDetailTabsProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  notes: ContactNote[];
  tasks: ContactTask[];
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
  onAddNote?: (body: string, source?: string) => Promise<void>;
  onAddTask?: (title: string, dueDate?: string) => Promise<void>;
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
    await onAddTask(newTaskTitle.trim(), newTaskDue || undefined);
    setNewTaskTitle("");
    setNewTaskDue("");
    setTaskLoading(false);
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
    await onAddTask(`Note: ${title}`);
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
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Task title"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="kf-input w-full"
              />
              <input
                type="datetime-local"
                value={newTaskDue}
                onChange={(e) => setNewTaskDue(e.target.value)}
                className="kf-input w-full"
              />
            </div>
            <button
              onClick={handleAddTask}
              disabled={!newTaskTitle.trim() || taskLoading}
              className="kf-btn-primary w-full flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {taskLoading ? "Adding..." : "Add Task"}
            </button>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No tasks yet</p>
            ) : (
              <>
                {tasks.slice(0, tasksLimit).map((task) => (
                  <div
                    key={task.id}
                    className="group p-3 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-between"
                  >
                    <div>
                      <p className={`text-sm font-medium ${task.status === "DONE" ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
                      {task.dueDate && (
                        <p className="text-xs text-muted-foreground">
                          Due: {new Date(task.dueDate).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {task.status !== "DONE" && onCompleteTask && (
                        <button
                          onClick={() => onCompleteTask(task.id)}
                          className="p-2 hover:bg-muted rounded-lg transition-colors"
                          title="Complete task"
                        >
                          <svg className="w-5 h-5 text-muted-foreground hover:text-[hsl(var(--kf-accent2))]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                      )}
                      {task.status === "DONE" && (
                        <svg className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                      {onDeleteTask && (
                        <button
                          onClick={() => onDeleteTask(task.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 rounded transition-all"
                          title="Delete task"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {tasks.length > tasksLimit && (
                  <button
                    onClick={() => setTasksLimit((p) => p + 20)}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1 transition-colors"
                  >
                    <ChevronDown className="w-3 h-3" />
                    Show more ({tasks.length - tasksLimit} remaining)
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
