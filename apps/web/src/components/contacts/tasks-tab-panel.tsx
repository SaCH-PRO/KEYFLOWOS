"use client";

import { useState, useMemo } from "react";
import { useCompose } from "@/components/email/compose-context";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Copy,
  MessageCircle,
  Mail,
  ListTodo,
  StickyNote,
  Check,
  Clock,
  Flag,
  Bell,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  ChevronDown,
  Pencil,
  X,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactDetailData, ContactTask } from "./contact-detail";
import {
  TASK_PRIORITIES,
  TASK_TEMPLATES,
  getPriorityConfig,
  isOverdue,
  isDueSoon,
  formatRelativeDate,
  formatDateTimeTZ,
  type TaskPriority,
  type TaskFilter,
  type TaskSort,
} from "./tab-constants";

interface TasksTabPanelProps {
  contact: ContactDetailData;
  tasks: ContactTask[];
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  onAddNote?: (body: string, source?: string) => Promise<void>;
  onCompleteTask?: (taskId: string, currentStatus?: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onUpdateTask?: (taskId: string, data: { title?: string; dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
}

export function TasksTabPanel({ contact, tasks, onAddTask, onAddNote, onCompleteTask, onDeleteTask, onUpdateTask }: TasksTabPanelProps) {
  const compose = useCompose();
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("NORMAL");
  const [newTaskRemindAt, setNewTaskRemindAt] = useState("");
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [tasksLimit, setTasksLimit] = useState(20);
  const [taskSearch, setTaskSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [taskSort, setTaskSort] = useState<TaskSort>("due");
  const [taskCopiedId, setTaskCopiedId] = useState<string | null>(null);
  const [noteCreatedFromTaskId, setNoteCreatedFromTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDue, setEditTaskDue] = useState("");
  const [editTaskPriority, setEditTaskPriority] = useState<TaskPriority>("NORMAL");
  const [editTaskRemindAt, setEditTaskRemindAt] = useState("");
  const [editTaskLoading, setEditTaskLoading] = useState(false);

  const waPhone = getContactPhone(contact);

  const startEditTask = (task: ContactTask) => {
    setEditingTaskId(task.id);
    setEditTaskTitle(task.title);
    setEditTaskDue(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : "");
    setEditTaskPriority((task.priority as TaskPriority) || "NORMAL");
    setEditTaskRemindAt(task.remindAt ? new Date(task.remindAt).toISOString().slice(0, 16) : "");
  };

  const cancelEditTask = () => {
    setEditingTaskId(null);
    setEditTaskTitle("");
    setEditTaskDue("");
    setEditTaskPriority("NORMAL");
    setEditTaskRemindAt("");
  };

  const handleSaveEditTask = async () => {
    if (!editingTaskId || !editTaskTitle.trim() || !onUpdateTask) return;
    setEditTaskLoading(true);
    try {
      await onUpdateTask(editingTaskId, {
        title: editTaskTitle.trim(),
        dueDate: editTaskDue ? new Date(editTaskDue).toISOString() : undefined,
        priority: editTaskPriority,
        remindAt: editTaskRemindAt ? new Date(editTaskRemindAt).toISOString() : undefined,
      });
      cancelEditTask();
      toast.success("Task updated");
    } catch {
      toast.error("Failed to update task");
    } finally {
      setEditTaskLoading(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !onAddTask) return;
    setTaskLoading(true);
    try {
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
    } catch {
      toast.error("Failed to add task");
    } finally {
      setTaskLoading(false);
    }
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
      ? `Reminder: ${title}\nDue: ${formatDateTimeTZ(dueDate)}`
      : `Reminder: ${title}`;
    window.open(buildWhatsAppLink(waPhone, msg), "_blank");
  };

  const handleShareTaskEmail = (title: string, dueDate?: string | null) => {
    if (!contact.email) return;
    const bodyText = dueDate
      ? `Task: ${title}<br/>Due: ${formatDateTimeTZ(dueDate)}`
      : `Task: ${title}`;
    compose.open({
      to: contact.email,
      subject: `Task: ${title}`,
      body: `<p>${bodyText}</p>`,
    });
  };

  const handleCreateNoteFromTask = async (taskId: string, title: string) => {
    if (!onAddNote) return;
    try {
      await onAddNote(`Task: ${title}`, "general");
      setNoteCreatedFromTaskId(taskId);
      setTimeout(() => setNoteCreatedFromTaskId(null), 2000);
    } catch {
      toast.error("Failed to create note from task");
    }
  };

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
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input type="text" placeholder="Search tasks..." value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} className="kf-input w-full pl-8 text-sm h-8" />
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
                ? f.key === "overdue" ? "bg-red-500/15 text-red-400" : "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))]"
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
                taskSort === s.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
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
                      newTaskPriority === p.key ? `${p.bg} ${p.color} ring-1 ring-current/30` : "bg-muted/50 text-muted-foreground hover:text-foreground"
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
                <button key={t.label} onClick={() => applyTaskTemplate(t)} className="text-[10px] px-2 py-1 rounded-md bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
                  {t.label}
                </button>
              ))}
            </div>
            <input
              type="text" placeholder="What needs to be done?" value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)} className="kf-input w-full text-sm" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAddTask(); } }}
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground mb-0.5 block">Due date</label>
                <input type="datetime-local" value={newTaskDue} onChange={(e) => setNewTaskDue(e.target.value)} className="kf-input w-full text-xs h-8" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-0.5 block">Remind at</label>
                <input type="datetime-local" value={newTaskRemindAt} onChange={(e) => setNewTaskRemindAt(e.target.value)} className="kf-input w-full text-xs h-8" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {typeof navigator !== "undefined" && navigator?.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to save
              </span>
              <button onClick={handleAddTask} disabled={!newTaskTitle.trim() || taskLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium kf-btn-primary disabled:opacity-50">
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
          <p className="text-sm text-muted-foreground">{taskSearch || taskFilter !== "all" ? "No matching tasks" : "No tasks yet"}</p>
          {!taskComposerOpen && taskFilter === "all" && !taskSearch && onAddTask && (
            <button onClick={() => setTaskComposerOpen(true)} className="text-xs text-[hsl(var(--kf-accent2))] hover:underline">Add your first task</button>
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
                  overdue ? "bg-red-500/5 border-red-500/20" : dueSoon ? "bg-amber-500/5 border-amber-500/20" : isDone ? "bg-muted/20 border-border/30" : "bg-muted/30 border-border/50"
                }`}
              >
                  {editingTaskId === task.id ? (
                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1 flex-wrap">
                        {TASK_PRIORITIES.map((p) => (
                          <button
                            key={p.key}
                            onClick={() => setEditTaskPriority(p.key)}
                            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors ${
                              editTaskPriority === p.key ? `${p.bg} ${p.color} ring-1 ring-current/30` : "bg-muted/50 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <p.icon className="w-2.5 h-2.5" />
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <button onClick={cancelEditTask} className="p-1 rounded-md hover:bg-muted transition-colors" title="Cancel editing">
                        <X className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </div>
                    <input
                      type="text" value={editTaskTitle} onChange={(e) => setEditTaskTitle(e.target.value)}
                      className="kf-input w-full text-sm" autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSaveEditTask(); }
                        if (e.key === "Escape") cancelEditTask();
                      }}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground mb-0.5 block">Due date</label>
                        <input type="datetime-local" value={editTaskDue} onChange={(e) => setEditTaskDue(e.target.value)} className="kf-input w-full text-xs h-8" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground mb-0.5 block">Remind at</label>
                        <input type="datetime-local" value={editTaskRemindAt} onChange={(e) => setEditTaskRemindAt(e.target.value)} className="kf-input w-full text-xs h-8" />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={cancelEditTask} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEditTask}
                        disabled={!editTaskTitle.trim() || editTaskLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium kf-btn-primary disabled:opacity-50"
                      >
                        {editTaskLoading ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="p-3">
                      <div className="flex items-start gap-2">
                        {onCompleteTask && (
                          <button
                            onClick={async () => { try { await onCompleteTask(task.id, task.status ?? undefined); } catch { toast.error("Failed to update task status"); } }}
                            className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 transition-colors flex items-center justify-center ${
                              isDone ? "border-[hsl(var(--kf-accent2))] bg-[hsl(var(--kf-accent2))]/20 hover:border-muted-foreground/40 hover:bg-transparent" : "border-muted-foreground/40 hover:border-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/10"
                            }`}
                            title={isDone ? "Mark as incomplete" : "Complete task"}
                          >
                            <Check className={`w-3 h-3 ${isDone ? "text-[hsl(var(--kf-accent2))]" : "opacity-0 group-hover:opacity-30 text-[hsl(var(--kf-accent2))]"}`} />
                          </button>
                        )}
                        {isDone && !onCompleteTask && <CheckCircle2 className="mt-0.5 shrink-0 w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />}
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
                            {isDone && task.completedAt && <span className="text-[10px] text-muted-foreground">Completed {formatRelativeDate(task.completedAt)}</span>}
                          </div>
                          <p className={`text-sm font-medium leading-snug ${isDone ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
                          <div className="flex items-center gap-3 mt-1">
                            {task.dueDate && (
                              <span className={`flex items-center gap-1 text-[11px] ${overdue ? "text-red-400" : dueSoon ? "text-amber-400" : "text-muted-foreground"}`}>
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
                            {task.source && task.source !== "crm" && <span className="text-[10px] text-muted-foreground/60">via {task.source}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 px-2 py-1.5 border-t border-border/30 opacity-0 group-hover:opacity-100 transition-opacity bg-muted/20">
                      {onUpdateTask && (
                        <button onClick={() => startEditTask(task)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Edit task">
                          <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      )}
                      <button onClick={() => handleCopyTask(task.id, task.title)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Copy task">
                        {taskCopiedId === task.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                      </button>
                      {waPhone && (
                        <button onClick={() => handleShareTaskWhatsApp(task.title, task.dueDate)} className="p-1.5 rounded-md hover:bg-emerald-500/10 transition-colors" title="Send reminder via WhatsApp">
                          <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                        </button>
                      )}
                      {contact.email && (
                        <button onClick={() => handleShareTaskEmail(task.title, task.dueDate)} className="p-1.5 rounded-md hover:bg-blue-500/10 transition-colors" title="Send reminder via Email">
                          <Mail className="w-3.5 h-3.5 text-blue-400" />
                        </button>
                      )}
                      {onAddNote && (
                        <button onClick={() => handleCreateNoteFromTask(task.id, task.title)} className="p-1.5 rounded-md hover:bg-violet-500/10 transition-colors" title="Create note from this task">
                          {noteCreatedFromTaskId === task.id ? <Check className="w-3.5 h-3.5 text-violet-400" /> : <StickyNote className="w-3.5 h-3.5 text-violet-400" />}
                        </button>
                      )}
                      <div className="flex-1" />
                      {onDeleteTask && (
                        <button onClick={async () => { try { await onDeleteTask(task.id); } catch { toast.error("Failed to delete task"); } }} className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors" title="Delete task">
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      )}
                    </div>
                  </>
                )}
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
  );
}
