"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Circle, Trash2, Plus, ListChecks, Calendar } from "lucide-react";
import { ProjectTask } from "@/lib/client";

interface TaskListProps {
  tasks: ProjectTask[];
  projectId: string;
  onToggleTask: (projectId: string, task: ProjectTask) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
  onAddTask: (projectId: string, title: string, dueDate?: string) => void;
  onUpdateTask?: (projectId: string, taskId: string, data: { dueDate?: string | null }) => void;
}

function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TaskList({ tasks, projectId, onToggleTask, onDeleteTask, onAddTask, onUpdateTask }: TaskListProps) {
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");

  const handleAdd = () => {
    if (!newTaskTitle.trim()) return;
    onAddTask(projectId, newTaskTitle.trim(), newTaskDueDate || undefined);
    setNewTaskTitle("");
    setNewTaskDueDate("");
  };

  return (
    <div className="mt-3 ml-6 space-y-1">
      {tasks.length === 0 && (
        <div className="flex items-center gap-3 py-3 px-3 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.08)" }}>
          <ListChecks className="w-5 h-5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent2) / 0.5)" }} />
          <div>
            <p className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent2))" }}>No tasks yet</p>
            <p className="text-[10px] text-muted-foreground">Add your first task below to start tracking progress.</p>
          </div>
        </div>
      )}
      {tasks.map((task) => {
        const overdue = !task.isCompleted && isOverdue(task.dueDate);
        return (
          <div key={task.id} className="flex items-center gap-2 group py-1">
            <button
              onClick={() => onToggleTask(projectId, task)}
              className="flex-shrink-0 transition-colors"
              style={{ color: task.isCompleted ? "#22c55e" : "hsl(var(--muted-foreground))" }}
            >
              {task.isCompleted ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Circle className="w-4 h-4" />
              )}
            </button>
            <span className={`text-xs flex-1 ${task.isCompleted ? "line-through text-muted-foreground" : ""}`}>
              {task.title}
            </span>
            {task.dueDate && (
              <span
                className="text-[10px] flex items-center gap-0.5 flex-shrink-0"
                style={{ color: overdue ? "hsl(var(--kf-error))" : "hsl(var(--muted-foreground))" }}
              >
                <Calendar className="w-3 h-3" />
                {formatDate(task.dueDate)}
              </span>
            )}
            {onUpdateTask && !task.dueDate && (
              <input
                type="date"
                className="opacity-0 group-hover:opacity-100 transition-opacity bg-transparent text-[10px] text-muted-foreground w-[90px] focus:outline-none"
                onChange={(e) => {
                  if (e.target.value) {
                    onUpdateTask(projectId, task.id, { dueDate: e.target.value });
                  }
                }}
              />
            )}
            <button
              onClick={() => onDeleteTask(projectId, task.id)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-2 mt-2">
        <input
          placeholder="Add task..."
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 bg-transparent border-b border-border/40 text-xs py-1 focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
        />
        <input
          type="date"
          value={newTaskDueDate}
          onChange={(e) => setNewTaskDueDate(e.target.value)}
          className="bg-transparent border-b border-border/40 text-xs py-1 text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))] w-[100px]"
        />
        <button onClick={handleAdd} className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center">
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
