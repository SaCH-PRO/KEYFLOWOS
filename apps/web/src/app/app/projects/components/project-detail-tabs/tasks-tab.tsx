"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  Trash2,
  Plus,
  Calendar,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { ProjectTask } from "@/lib/client";
import { isOverdue, formatDate } from "../project-constants";

interface TasksTabProps {
  tasks: ProjectTask[];
  projectId: string;
  onAddTask: (projectId: string, title: string, dueDate?: string) => void;
  onToggleTask: (projectId: string, task: ProjectTask) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
  onUpdateTask: (projectId: string, taskId: string, data: { dueDate?: string | null }) => void;
}

export function TasksTab({
  tasks, projectId, onAddTask, onToggleTask, onDeleteTask, onUpdateTask,
}: TasksTabProps) {
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  const [filter, setFilter] = useState<"all" | "overdue" | "upcoming">("all");

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
    onAddTask(projectId, newTitle.trim(), newDueDate || undefined);
    setNewTitle("");
    setNewDueDate("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">{incomplete.length} remaining · {completed.length} completed</span>
        {overdueTasks.length > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-md font-medium" style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
            {overdueTasks.length} overdue
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
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
      </div>

      <div className="rounded-xl border border-primary/30 bg-card p-3 flex gap-2">
        <input
          placeholder="Add a new task..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
        />
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
            onToggle={onToggleTask}
            onDelete={onDeleteTask}
            onUpdate={onUpdateTask}
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
                  onToggle={onToggleTask}
                  onDelete={onDeleteTask}
                  onUpdate={onUpdateTask}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, projectId, onToggle, onDelete, onUpdate }: {
  task: ProjectTask;
  projectId: string;
  onToggle: (pid: string, task: ProjectTask) => void;
  onDelete: (pid: string, tid: string) => void;
  onUpdate: (pid: string, tid: string, data: { dueDate?: string | null }) => void;
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
      <span className={`text-sm flex-1 ${task.isCompleted ? "line-through text-muted-foreground" : ""}`}>
        {task.title}
      </span>
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
