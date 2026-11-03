"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Play } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { runApprovedQueueItem, type ActionQueueItem } from "@/lib/client";

/*
 * D-70 (2026-11-03): an approved queued KEY action step is run from a Run action on that queue
 * item, executing exactly the stored step through the bound execute route (V1-31b), with no
 * re-planning. GET actions/businesses/:b/queue lists such a step as an 'approved_step' item
 * carrying its stored planId and planStepId, and only for a member who may run it. Run posts
 * exactly those ids (runApprovedQueueItem); it never plans the request again and never names a
 * tool or sends arguments. The server still decides: a refusal is shown, and a step the action
 * boundary holds for a confirmation is reported as waiting.
 */

function runnable(item: ActionQueueItem): boolean {
  return item.type === "approved_step" && !!item.planId && !!item.planStepId;
}

export function ApprovedActionsQueue({
  businessId,
  items,
  onRan,
}: {
  businessId: string;
  items: ActionQueueItem[];
  onRan?: (item: ActionQueueItem) => void;
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  const approved = useMemo(() => items.filter((i) => runnable(i) && !done.has(i.id)), [items, done]);

  const run = async (item: ActionQueueItem) => {
    setRunning(item.id);
    try {
      const res = await runApprovedQueueItem(businessId, item);
      if (!res.data) {
        toast.error(res.error ?? "The approved action could not be run");
        return;
      }
      if (res.data.success) {
        toast.success(`Ran: ${item.title}`);
        setDone((prev) => new Set(prev).add(item.id));
        window.dispatchEvent(new CustomEvent("kf:action.executed"));
        onRan?.(item);
        return;
      }
      if (res.data.requiresConfirmation || res.data.requiresApproval || res.data.blocked) {
        toast.info(res.data.reason ?? "This action is waiting before it can run");
        return;
      }
      toast.error(res.data.error ?? res.data.reason ?? "The approved action failed");
    } finally {
      setRunning(null);
    }
  };

  if (approved.length === 0) return null;

  return (
    <SectionCard title="Approved, ready to run" subtitle={`${approved.length} approved action${approved.length > 1 ? "s" : ""}`} icon={CheckCircle2}>
      <ul className="space-y-2">
        {approved.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--kf-border))] px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title}</p>
              {item.description ? <p className="truncate text-xs text-muted-foreground">{item.description}</p> : null}
            </div>
            <button
              type="button"
              aria-label={`Run ${item.title}`}
              disabled={running !== null}
              onClick={() => void run(item)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[hsl(var(--kf-accent1))] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
            >
              {running === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run
            </button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
