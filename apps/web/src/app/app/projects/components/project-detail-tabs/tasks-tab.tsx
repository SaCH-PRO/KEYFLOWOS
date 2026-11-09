"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Trash2,
  Plus,
  Calendar,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Timer,
  LayoutGrid,
  List,
  UserCheck,
} from "lucide-react";
import { ProjectTask } from "@/lib/client";
import { fetchTaskAssigneeOptions, type ProjectBoardTask, type TaskAssigneeOption, type TaskMove } from "@/lib/api/projects";
import { isOverdue, formatDate } from "../project-constants";
import { TaskKanban, type KanbanTask } from "../task-kanban";

interface TasksTabProps {
  tasks: ProjectTask[];
  projectId: string;
  businessId?: string | null;
  onAddTask: (projectId: string, title: string, dueDate?: string, assigneeId?: string) => void;
  onToggleTask: (projectId: string, task: ProjectTask) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
  onUpdateTask: (projectId: string, taskId: string, data: { dueDate?: string | null; estimatedHours?: number | null; trackedHours?: number }) => void;
  /** The assignee write (PATCH .../tasks/:taskId {assigneeId}); null unassigns. */
  onAssignTask?: (projectId: string, taskId: string, assigneeId: string | null) => void;
  /** A Kanban move to another column: the server's status door. Resolves false when refused. */
  onUpdateTaskStatus?: (projectId: string, taskId: string, status: string, position: number) => Promise<boolean>;
  /** A Kanban column reorder: the position of every task whose position changed. Resolves false when refused. */
  onReorderTasks?: (projectId: string, updates: TaskMove[]) => Promise<boolean>;
}

/**
 * PR196-PROJECTS-WEB (WPD-10, D-87): who a project task may be given to, a member of the
 * business or one of its booking staff (GET .../task-assignments/options; KEY left out).
 * null until the list has loaded; [] when it could not be read.
 */
export function useTaskAssigneeOptions(businessId: string | null | undefined): TaskAssigneeOption[] | null {
  const [options, setOptions] = useState<TaskAssigneeOption[] | null>(null);
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void fetchTaskAssigneeOptions(businessId).then((res) => {
      if (!cancelled) setOptions(res.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);
  return options;
}

/**
 * The assignee picker. Members and booking staff are grouped; a task given to someone the list
 * does not name keeps that assignment on screen instead of reading "Unassigned" (WPD-10).
 */
function AssigneeSelect({ value, options, label, className, onChange }: {
  value: string | null | undefined;
  options: TaskAssigneeOption[] | null;
  label: string;
  className: string;
  onChange: (assigneeId: string | null) => void;
}) {
  const members = (options ?? []).filter((o) => o.type === "User");
  const staff = (options ?? []).filter((o) => o.type === "StaffMember");
  const listed = !!value && (options ?? []).some((o) => o.id === value);
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={label}
      className={className}
      title="Assigned to"
    >
      <option value="">Unassigned</option>
      {members.length > 0 && (
        <optgroup label="Team members">
          {members.map((m) => <option key={`u-${m.id}`} value={m.id}>{m.name}</option>)}
        </optgroup>
      )}
      {staff.length > 0 && (
        <optgroup label="Booking staff">
          {staff.map((s) => <option key={`s-${s.id}`} value={s.id}>{s.name}</option>)}
        </optgroup>
      )}
      {value && !listed && <option value={value}>Assigned (not in the list)</option>}
    </select>
  );
}

export function TasksTab({
  tasks, projectId, businessId, onAddTask, onToggleTask, onDeleteTask, onUpdateTask, onAssignTask, onUpdateTaskStatus, onReorderTasks,
}: TasksTabProps) {
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  const [filter, setFilter] = useState<"all" | "overdue" | "upcoming">("all");
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const assigneeOptions = useTaskAssigneeOptions(businessId);

  const completed = tasks.filter((t) => t.isCompleted);
  const incomplete = tasks.filter((t) => !t.isCompleted);
  const overdueTasks = incomplete.filter((t) => isOverdue(t.dueDate));

  const filtered = filter === "overdue"
    ? overdueTasks
    : filter === "upcoming"
      ? incomplete.filter((t) => t.dueDate && !isOverdue(t.dueDate))
      : incomplete;

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    onAddTask(projectId, newTitle.trim(), newDueDate || undefined, newAssigneeId || undefined);
    setNewTitle("");
    setNewDueDate("");
    setNewAssigneeId("");
  };

  // WPD-06: the board reads the server's status and position (the order the server keeps for the
  // Kanban), not sortOrder. Memoised on the task list so the board resyncs only when it changes.
  // SEC-W196-1: it also gets the completion, so a task completed or reopened without its status
  // changing shows where its completion puts it.
  const kanbanTasks = useMemo<KanbanTask[]>(() => tasks.map((t, idx) => {
    const board = t as ProjectBoardTask;
    return {
      id: t.id,
      title: t.title,
      description: t.description ?? null,
      status: board.status || (t.isCompleted ? "DONE" : "TODO"),
      isCompleted: !!t.isCompleted,
      position: typeof board.position === "number" ? board.position : idx,
      priority: t.priority || "NORMAL",
      dueDate: t.dueDate ?? null,
      assigneeId: t.assigneeId ?? null,
      estimatedHours: t.estimatedHours ?? null,
      trackedHours: t.trackedHours ?? 0,
    };
  }), [tasks]);

  const assign = onAssignTask ? (taskId: string, assigneeId: string | null) => onAssignTask(projectId, taskId, assigneeId) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">{incomplete.length} remaining · {completed.length} completed</span>
        {overdueTasks.length > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-md font-medium" style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
            {overdueTasks.length} overdue
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {viewMode === "list" && (
            <div className="flex items-center gap-1">
              {(["all", "overdue", "upcoming"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[10px] px-2 py-1 rounded-lg capitalize transition-colors ${filter === f ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          {onUpdateTaskStatus && onReorderTasks && (
            <div className="flex items-center rounded-lg border border-border/50 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-label="List view"
                aria-pressed={viewMode === "list"}
                className={`p-1 rounded-md text-xs transition-colors ${viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("kanban")}
                aria-label="Kanban board"
                aria-pressed={viewMode === "kanban"}
                className={`p-1 rounded-md text-xs transition-colors ${viewMode === "kanban" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-primary/30 bg-card p-3 flex flex-wrap gap-2 items-center">
        <input
          placeholder="Add a new task..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 min-w-[160px] bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
        />
        {businessId && (
          <AssigneeSelect
            value={newAssigneeId}
            options={assigneeOptions}
            label="Assign new task"
            className="bg-transparent text-xs text-muted-foreground border border-border/40 rounded-md px-2 py-1 focus:outline-none"
            onChange={(id) => setNewAssigneeId(id ?? "")}
          />
        )}
        <input
          type="date"
          value={newDueDate}
          onChange={(e) => setNewDueDate(e.target.value)}
          className="bg-transparent text-xs text-muted-foreground w-[110px] focus:outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={!newTitle.trim()}
          className="kf-btn-primary px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      {viewMode === "kanban" && onUpdateTaskStatus && onReorderTasks ? (
        <TaskKanban
          tasks={kanbanTasks}
          onUpdate={(taskId, status, position) => onUpdateTaskStatus(projectId, taskId, status, position)}
          onReorder={(updates) => onReorderTasks(projectId, updates)}
        />
      ) : (
        <>
          <div className="space-y-1">
            {filtered.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground">
                {filter === "all" ? "No tasks remaining. Great work!" : `No ${filter} tasks.`}
              </div>
            )}
            {filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                projectId={projectId}
                assigneeOptions={businessId ? assigneeOptions : null}
                onToggle={onToggleTask}
                onDelete={onDeleteTask}
                onUpdate={onUpdateTask}
                onAssign={businessId ? assign : undefined}
              />
            ))}
          </div>

          {completed.length > 0 && (
            <div>
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                {showCompleted ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {completed.length} completed task{completed.length > 1 ? "s" : ""}
              </button>
              {showCompleted && (
                <div className="space-y-1 mt-1">
                  {completed.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      projectId={projectId}
                      assigneeOptions={businessId ? assigneeOptions : null}
                      onToggle={onToggleTask}
                      onDelete={onDeleteTask}
                      onUpdate={onUpdateTask}
                      onAssign={businessId ? assign : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TaskRow({ task, projectId, assigneeOptions, onToggle, onDelete, onUpdate, onAssign }: {
  task: ProjectTask;
  projectId: string;
  assigneeOptions: TaskAssigneeOption[] | null;
  onToggle: (pid: string, task: ProjectTask) => void;
  onDelete: (pid: string, tid: string) => void;
  onUpdate: (pid: string, tid: string, data: { dueDate?: string | null; estimatedHours?: number | null; trackedHours?: number }) => void;
  onAssign?: (taskId: string, assigneeId: string | null) => void;
}) {
  const overdue = !task.isCompleted && isOverdue(task.dueDate);

  return (
    <div
      className="flex items-center gap-3 py-2 px-3 rounded-lg group hover:bg-muted/10 transition-colors"
      style={overdue ? { borderLeft: "2px solid hsl(var(--kf-error))" } : undefined}
    >
      <button
        onClick={() => onToggle(projectId, task)}
        className="shrink-0 transition-colors"
        style={{ color: task.isCompleted ? "#22c55e" : "hsl(var(--muted-foreground))" }}
      >
        {task.isCompleted ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
      </button>
      <span className={`text-sm flex-1 min-w-0 truncate ${task.isCompleted ? "line-through text-muted-foreground" : ""}`}>
        {task.title}
      </span>

      {/* Assignee picker: members and booking staff (D-87) */}
      {onAssign && (
        <div className="flex items-center gap-1 shrink-0 opacity-75 group-hover:opacity-100 transition-opacity">
          <UserCheck className="w-3 h-3 text-muted-foreground" />
          <AssigneeSelect
            value={task.assigneeId}
            options={assigneeOptions}
            label={`Assign ${task.title}`}
            className="bg-transparent text-[10px] text-muted-foreground focus:outline-none max-w-[120px] truncate cursor-pointer"
            onChange={(assigneeId) => onAssign(task.id, assigneeId)}
          />
        </div>
      )}

      {/* Time tracking inputs */}
      <div className="flex items-center gap-1.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
        <Timer className="w-3 h-3 text-muted-foreground" />
        <input
          type="number"
          min={0}
          step={0.5}
          placeholder="Est"
          value={task.estimatedHours ?? ""}
          onChange={(e) => {
            const val = e.target.value === "" ? null : parseFloat(e.target.value);
            onUpdate(projectId, task.id, { estimatedHours: val });
          }}
          className="w-10 bg-transparent text-[10px] text-muted-foreground focus:outline-none text-center border-b border-transparent focus:border-border"
          title="Estimated hours"
        />
        <span className="text-[10px] text-muted-foreground">/</span>
        <input
          type="number"
          min={0}
          step={0.5}
          placeholder="Trk"
          value={task.trackedHours ?? ""}
          onChange={(e) => {
            const val = e.target.value === "" ? 0 : parseFloat(e.target.value);
            onUpdate(projectId, task.id, { trackedHours: val });
          }}
          className="w-10 bg-transparent text-[10px] text-foreground focus:outline-none text-center border-b border-transparent focus:border-border font-medium"
          title="Tracked hours"
        />
      </div>

      {task.dueDate && (
        <span
          className="text-[10px] flex items-center gap-0.5 shrink-0"
          style={{ color: overdue ? "hsl(var(--kf-error))" : "hsl(var(--muted-foreground))" }}
        >
          {overdue && <AlertTriangle className="w-3 h-3" />}
          <Calendar className="w-3 h-3" />
          {formatDate(task.dueDate)}
        </span>
      )}
      {!task.dueDate && !task.isCompleted && (
        <input
          type="date"
          className="opacity-0 group-hover:opacity-100 transition-opacity bg-transparent text-[10px] text-muted-foreground w-[100px] focus:outline-none"
          onChange={(e) => {
            if (e.target.value) onUpdate(projectId, task.id, { dueDate: e.target.value });
          }}
        />
      )}
      <button
        onClick={() => onDelete(projectId, task.id)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
