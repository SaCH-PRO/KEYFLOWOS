"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Circle, Trash2, Plus } from "lucide-react";
import { ProjectTask } from "@/lib/client";

interface TaskListProps {
  tasks: ProjectTask[];
  projectId: string;
  onToggleTask: (projectId: string, task: ProjectTask) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
  onAddTask: (projectId: string, title: string) => void;
}

export function TaskList({ tasks, projectId, onToggleTask, onDeleteTask, onAddTask }: TaskListProps) {
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const handleAdd = () => {
    if (!newTaskTitle.trim()) return;
    onAddTask(projectId, newTaskTitle.trim());
    setNewTaskTitle("");
  };

  return (
    <div className="mt-3 ml-6 space-y-1">
      {tasks.length === 0 && (
        <p className="text-xs text-muted-foreground py-2" style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}>
          No tasks yet — add one below to start tracking progress.
        </p>
      )}
      {tasks.map((task) => (
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
          <button
            onClick={() => onDeleteTask(projectId, task.id)}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2 mt-2">
        <input
          placeholder="Add task..."
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 bg-transparent border-b border-border/40 text-xs py-1 focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
        />
        <button onClick={handleAdd} className="text-muted-foreground hover:text-white">
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
