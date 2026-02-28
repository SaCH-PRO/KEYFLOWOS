"use client";

import { useState } from "react";
import {
  Plus,
  MessageSquare,
  ListTodo,
  History,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
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
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [timelineLimit, setTimelineLimit] = useState(20);
  const [notesLimit, setNotesLimit] = useState(20);
  const [tasksLimit, setTasksLimit] = useState(20);

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
