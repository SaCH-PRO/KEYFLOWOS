"use client";

import { useState } from "react";
import {
  Mail,
  Plus,
  MessageSquare,
  ListTodo,
  History,
  MessageCircle,
  Send,
  Copy,
  Bell,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "./contact-detail";

const QUICK_TEMPLATES = [
  { label: "Follow-up", message: "Hi {name}, just following up on our last conversation. How can I help?" },
  { label: "Thank you", message: "Hi {name}, thank you for your business! We truly appreciate it." },
  { label: "Appointment", message: "Hi {name}, this is a reminder about your upcoming appointment. See you soon!" },
  { label: "Payment", message: "Hi {name}, just a friendly reminder about your outstanding balance. Let me know if you have any questions." },
  { label: "Promo", message: "Hi {name}, we have a special offer just for you! Reply to learn more." },
];

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

const WHATSAPP_CHAR_LIMIT = 4096;

interface ContactDetailTabsProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  notes: ContactNote[];
  tasks: ContactTask[];
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
  onAddNote?: (body: string) => Promise<void>;
  onAddTask?: (title: string, dueDate?: string) => Promise<void>;
  onCompleteTask?: (taskId: string) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onLogEvent?: (type: string, description?: string) => Promise<void>;
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
  onLogEvent,
}: ContactDetailTabsProps) {
  const [newNote, setNewNote] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [composeMessage, setComposeMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [timelineLimit, setTimelineLimit] = useState(20);
  const [notesLimit, setNotesLimit] = useState(20);
  const [tasksLimit, setTasksLimit] = useState(20);

  const waPhone = getContactPhone(contact);

  const handleAddNote = async () => {
    if (!newNote.trim() || !onAddNote) return;
    setNoteLoading(true);
    await onAddNote(newNote.trim());
    setNewNote("");
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

  const applyTemplate = (template: string) => {
    setComposeMessage(template.replace("{name}", contact.firstName || "there"));
  };

  const handleCopyMessage = async () => {
    navigator.clipboard.writeText(composeMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onLogEvent?.("message.copied", composeMessage.slice(0, 200));
    setShowFollowUp(true);
  };

  const handleSendWhatsApp = async () => {
    if (!waPhone) return;
    window.open(buildWhatsAppLink(waPhone, composeMessage), "_blank");
    onLogEvent?.("whatsapp.sent", composeMessage.slice(0, 200));
    setShowFollowUp(true);
  };

  const handleSendEmail = async () => {
    if (!contact.email) return;
    const subject = encodeURIComponent("Following up");
    const body = encodeURIComponent(composeMessage);
    window.open(`mailto:${contact.email}?subject=${subject}&body=${body}`, "_blank");
    onLogEvent?.("email.sent", composeMessage.slice(0, 200));
    setShowFollowUp(true);
  };

  const handleFollowUp = async (days: number) => {
    if (!onAddTask) return;
    setFollowUpLoading(true);
    const due = new Date();
    due.setDate(due.getDate() + days);
    const label = days === 1 ? "tomorrow" : days === 3 ? "in 3 days" : "in 1 week";
    await onAddTask(`Follow up with ${contact.firstName || "contact"} ${label}`, due.toISOString());
    onLogEvent?.("followup.scheduled", `Follow-up in ${days} day(s)`);
    setFollowUpLoading(false);
    setShowFollowUp(false);
  };

  const charCount = composeMessage.length;
  const charColor = charCount > WHATSAPP_CHAR_LIMIT ? "text-red-400" : charCount > WHATSAPP_CHAR_LIMIT * 0.8 ? "text-yellow-400" : "text-muted-foreground";

  return (
    <>
      <div className="flex border-b border-border overflow-x-auto" role="tablist">
        {[
          { key: "timeline", label: "Timeline", icon: History },
          { key: "notes", label: "Notes", icon: MessageSquare, count: notes.length },
          { key: "tasks", label: "Tasks", icon: ListTodo, count: tasks.filter((t) => t.status !== "DONE").length },
          { key: "compose", label: "Compose", icon: Send },
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
        {activeTab === "compose" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => applyTemplate(t.message)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <textarea
                placeholder={`Write a message to ${contact.firstName || "this contact"}...`}
                value={composeMessage}
                onChange={(e) => setComposeMessage(e.target.value)}
                className="kf-input w-full min-h-[100px] resize-none"
              />
              {charCount > 0 && (
                <span className={`absolute bottom-2 right-2 text-[10px] ${charColor}`}>
                  {charCount.toLocaleString()}/{WHATSAPP_CHAR_LIMIT.toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {waPhone && (
                <button
                  onClick={handleSendWhatsApp}
                  disabled={!composeMessage.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm transition-colors disabled:opacity-50"
                >
                  <MessageCircle className="w-4 h-4" />
                  Send via WhatsApp
                </button>
              )}
              {contact.email && (
                <button
                  onClick={handleSendEmail}
                  disabled={!composeMessage.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors disabled:opacity-50"
                >
                  <Mail className="w-4 h-4" />
                  Send via Email
                </button>
              )}
              <button
                onClick={handleCopyMessage}
                disabled={!composeMessage.trim()}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition-colors disabled:opacity-50"
              >
                <Copy className="w-4 h-4" />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {showFollowUp && onAddTask && (
              <div className="p-3 rounded-xl bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Bell className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  Remind me to follow up
                </div>
                <div className="flex gap-2">
                  {[
                    { label: "Tomorrow", days: 1 },
                    { label: "In 3 days", days: 3 },
                    { label: "In 1 week", days: 7 },
                  ].map((opt) => (
                    <button
                      key={opt.days}
                      onClick={() => handleFollowUp(opt.days)}
                      disabled={followUpLoading}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowFollowUp(false)}
                    className="px-3 py-1.5 text-xs rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}
          </div>
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

        {activeTab === "notes" && (
          <>
            <div className="flex gap-2">
              <textarea
                placeholder="Add a note..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="kf-input flex-1 min-h-[80px] resize-none"
              />
            </div>
            <button
              onClick={handleAddNote}
              disabled={!newNote.trim() || noteLoading}
              className="kf-btn-primary w-full flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {noteLoading ? "Adding..." : "Add Note"}
            </button>
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No notes yet</p>
            ) : (
              <>
                {notes.slice(0, notesLimit).map((note) => (
                  <div key={note.id} className="group p-3 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {new Date(note.createdAt).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                        {note.source && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {note.source}
                          </span>
                        )}
                      </div>
                      {onDeleteNote && (
                        <button
                          onClick={() => onDeleteNote(note.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
                          title="Delete note"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {notes.length > notesLimit && (
                  <button
                    onClick={() => setNotesLimit((p) => p + 20)}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1 transition-colors"
                  >
                    <ChevronDown className="w-3 h-3" />
                    Show more ({notes.length - notesLimit} remaining)
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
