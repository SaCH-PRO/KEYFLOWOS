"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Clock, ArrowRight, X, RotateCcw, AlertCircle, Copy } from "lucide-react";
import {
  InterruptedTask,
  getTasksForModule,
  markTaskCompleted,
  markTaskDiscarded,
  subscribeToBroadcast,
} from "@/lib/resume-task-registry";
import { cn } from "@/lib/utils";

interface ResumePromptProps {
  module: string;
  className?: string;
  onResume?: (task: InterruptedTask) => void;
  onDiscard?: (task: InterruptedTask) => void;
  onDuplicateDraft?: (task: InterruptedTask) => void;
  maxShown?: number;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ResumePrompt({
  module,
  className,
  onResume,
  onDiscard,
  onDuplicateDraft,
  maxShown = 3,
}: ResumePromptProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<InterruptedTask[]>([]);

  const refresh = useCallback(() => {
    const found = getTasksForModule(module).slice(0, maxShown);
    setTasks(found);
  }, [module, maxShown]);

  useEffect(() => {
    refresh();

    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);

    const unsubscribe = subscribeToBroadcast((event) => {
      if (event.type === "completed" || event.type === "discarded" || event.type === "source-changed") {
        refresh();
      }
    });

    return () => {
      window.removeEventListener("storage", onStorage);
      unsubscribe();
    };
  }, [refresh]);

  if (tasks.length === 0) return null;

  const handleResume = (task: InterruptedTask) => {
    if (onResume) {
      onResume(task);
    } else {
      router.push(task.route);
    }
  };

  const handleDiscard = (task: InterruptedTask) => {
    markTaskDiscarded(task.id);
    if (onDiscard) onDiscard(task);
    refresh();
  };

  const handleDuplicateDraft = (task: InterruptedTask) => {
    markTaskDiscarded(task.id);
    if (onDuplicateDraft) {
      onDuplicateDraft(task);
    } else {
      const url = new URL(task.route, window.location.href);
      url.searchParams.set("duplicateFrom", task.draftId ?? task.id);
      router.push(url.pathname + url.search);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {tasks.map((task) => {
        const sourceChanged = !!task.sourceChangedAt;
        const hasDraft = !!task.draftId;

        return (
          <div
            key={task.id}
            className={cn(
              "flex items-start gap-3 px-4 py-3 rounded-xl border bg-card/60 backdrop-blur-sm group",
              sourceChanged ? "border-amber-500/40" : "border-border/60"
            )}
          >
            <div
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                sourceChanged ? "bg-amber-500/10" : "bg-muted/50"
              )}
            >
              {sourceChanged ? (
                <AlertCircle className="w-4 h-4 text-amber-500" />
              ) : (
                <RotateCcw className="w-4 h-4 text-muted-foreground" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">{task.label}</span>
                {hasDraft && !sourceChanged && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                    Draft
                  </span>
                )}
                {sourceChanged && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                    Source changed
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground truncate">
                  {sourceChanged
                    ? "The underlying record changed — resume to review, keep as new draft, or discard."
                    : task.description}
                </span>
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60 shrink-0">
                  <Clock className="w-2.5 h-2.5" />
                  {relativeTime(task.interruptedAt)}
                </span>
              </div>
              {sourceChanged && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    onClick={() => handleResume(task)}
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg kf-btn-primary !py-1 !px-2.5 !text-xs"
                  >
                    Review
                    <ArrowRight className="w-3 h-3" />
                  </button>
                  {hasDraft && (
                    <button
                      onClick={() => handleDuplicateDraft(task)}
                      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      Keep as new draft
                    </button>
                  )}
                  <button
                    onClick={() => handleDiscard(task)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Discard
                  </button>
                </div>
              )}
            </div>

            {!sourceChanged && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleResume(task)}
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg kf-btn-primary !py-1 !px-2.5 !text-xs"
                >
                  Resume
                  <ArrowRight className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleDiscard(task)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
                  title="Discard"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function useResumeTaskRegistry(module: string) {
  const [tasks, setTasks] = useState<InterruptedTask[]>([]);

  const refresh = useCallback(() => {
    setTasks(getTasksForModule(module));
  }, [module]);

  useEffect(() => {
    refresh();

    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);

    const unsubscribe = subscribeToBroadcast((event) => {
      if (event.type === "completed" || event.type === "discarded" || event.type === "source-changed") {
        refresh();
      }
    });

    return () => {
      window.removeEventListener("storage", onStorage);
      unsubscribe();
    };
  }, [refresh]);

  const complete = useCallback(
    (id: string) => {
      markTaskCompleted(id);
      refresh();
    },
    [refresh]
  );

  const discard = useCallback(
    (id: string) => {
      markTaskDiscarded(id);
      refresh();
    },
    [refresh]
  );

  return { tasks, complete, discard, refresh };
}
