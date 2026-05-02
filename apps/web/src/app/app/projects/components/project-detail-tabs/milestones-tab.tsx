"use client";

import { useState } from "react";
import {
  Flag,
  Plus,
  Trash2,
  CheckCircle,
  Circle,
  Calendar,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { isOverdue, formatDate } from "../project-constants";

export interface Milestone {
  id: string;
  title: string;
  dueDate?: string;
  completed: boolean;
  description?: string;
}

interface MilestonesTabProps {
  milestones: Milestone[];
  onMilestonesChange: (milestones: Milestone[]) => void;
}

export function MilestonesTab({ milestones, onMilestonesChange }: MilestonesTabProps) {
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    const ms: Milestone = {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      dueDate: newDueDate || undefined,
      completed: false,
    };
    onMilestonesChange([...milestones, ms]);
    setNewTitle("");
    setNewDueDate("");
  };

  const handleToggle = (id: string) => {
    onMilestonesChange(
      milestones.map((m) => (m.id === id ? { ...m, completed: !m.completed } : m))
    );
  };

  const handleDelete = (id: string) => {
    onMilestonesChange(milestones.filter((m) => m.id !== id));
  };

  const completed = milestones.filter((m) => m.completed).length;
  const total = milestones.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  const currentMilestoneIdx = milestones.findIndex((m) => !m.completed);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          <span className="text-xs text-muted-foreground">{completed}/{total} milestones completed</span>
        </div>
        {total > 0 && (
          <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent2))" }}>{progress}%</span>
        )}
      </div>

      {total > 0 && (
        <div className="relative">
          <div className="h-2 rounded-full overflow-hidden bg-muted/30">
            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: "hsl(var(--kf-accent2))" }} />
          </div>
          {total > 1 && (
            <div className="flex justify-between mt-1">
              {milestones.map((ms, i) => (
                <div
                  key={ms.id}
                  className="flex flex-col items-center"
                  style={{ width: `${100 / total}%` }}
                >
                  <div
                    className="w-2 h-2 rounded-full mt-0.5"
                    style={{
                      background: ms.completed
                        ? "hsl(var(--kf-success))"
                        : i === currentMilestoneIdx
                          ? "hsl(var(--kf-accent2))"
                          : "hsl(var(--muted) / 0.5)",
                    }}
                  />
                  <span className="text-[8px] text-muted-foreground/60 mt-0.5 truncate max-w-[60px] text-center">M{i + 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {milestones.map((ms, i) => {
          const overdue = !ms.completed && isOverdue(ms.dueDate);
          const isCurrent = i === currentMilestoneIdx;
          return (
            <div
              key={ms.id}
              className="flex items-center gap-3 py-2.5 px-3 rounded-xl border group transition-colors"
              style={{
                borderColor: overdue
                  ? "hsl(var(--kf-error) / 0.3)"
                  : isCurrent
                    ? "hsl(var(--kf-accent2) / 0.4)"
                    : ms.completed
                      ? "hsl(var(--kf-success) / 0.2)"
                      : "hsl(var(--border) / 0.4)",
                background: isCurrent
                  ? "hsl(var(--kf-accent2) / 0.04)"
                  : ms.completed
                    ? "hsl(var(--kf-success) / 0.04)"
                    : "hsl(var(--card))",
              }}
            >
              <button onClick={() => handleToggle(ms.id)} className="shrink-0">
                {ms.completed
                  ? <CheckCircle className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
                  : isCurrent
                    ? <ChevronRight className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
                    : <Circle className="w-5 h-5 text-muted-foreground" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold rounded-md px-1.5 py-0.5" style={{
                    background: isCurrent ? "hsl(var(--kf-accent2) / 0.15)" : "hsl(var(--muted) / 0.3)",
                    color: isCurrent ? "hsl(var(--kf-accent2))" : "hsl(var(--muted-foreground))",
                  }}>
                    M{i + 1}
                  </span>
                  <span className={`text-sm font-medium truncate ${ms.completed ? "line-through text-muted-foreground" : ""}`}>
                    {ms.title}
                  </span>
                  {isCurrent && (
                    <span className="text-[8px] px-1 py-0.5 rounded font-semibold shrink-0" style={{ background: "hsl(var(--kf-accent2) / 0.15)", color: "hsl(var(--kf-accent2))" }}>
                      CURRENT
                    </span>
                  )}
                </div>
                {i > 0 && !ms.completed && !milestones[i - 1].completed && (
                  <span className="text-[9px] text-muted-foreground/50 mt-0.5 inline-flex items-center gap-0.5">
                    <ChevronRight className="w-2.5 h-2.5" />
                    Depends on M{i}
                  </span>
                )}
              </div>
              {ms.dueDate && (
                <span
                  className="text-[10px] flex items-center gap-0.5 shrink-0"
                  style={{ color: overdue ? "hsl(var(--kf-error))" : "hsl(var(--muted-foreground))" }}
                >
                  <Calendar className="w-3 h-3" />
                  {formatDate(ms.dueDate)}
                </span>
              )}
              <button
                onClick={() => handleDelete(ms.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {milestones.length === 0 && (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
          <Flag className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">No milestones yet</p>
          <p className="text-xs text-muted-foreground mt-1">Milestones mark key delivery checkpoints for this project.</p>
          <div className="mt-3 flex items-center justify-center gap-1 text-[10px] text-muted-foreground/60">
            <Sparkles className="w-3 h-3" />
            <span>Tip: Use milestones to track phases like Design, Development, QA, and Launch</span>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-primary/30 bg-card p-3 flex gap-2">
        <input
          placeholder="Add a milestone..."
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
    </div>
  );
}
