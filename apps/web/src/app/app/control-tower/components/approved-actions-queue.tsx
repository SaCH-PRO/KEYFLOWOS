"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Play, RefreshCw, ShieldAlert } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { fetchActionQueue, runApprovedQueueItem, type ActionQueueItem } from "@/lib/client";

/*
 * D-70 (2026-11-03): an approved queued KEY action step is run from a Run action on that queue
 * item, executing exactly the stored step through the bound execute route (V1-31b), with no
 * re-planning. GET actions/businesses/:b/queue lists such a step as an 'approved_step' item
 * carrying its stored planId and planStepId, and only for a member who may run it. Run posts
 * exactly those ids (runApprovedQueueItem); it never plans the request again and never names a
 * tool or sends arguments. The server still decides: a refusal is shown, and a step the action
 * boundary holds for a confirmation is reported as waiting.
 *
 * D-72 (2026-11-03, KEY-R3c-APPROVED-QUEUE-MOUNT): the queue is mounted on the Command Center page
 * (ApprovedActionsPanel below reads GET .../queue for the current business). A run that succeeded
 * refreshes the queue; a 403 shows the access message and removes the action (the member may not
 * run it, so offering Run again would only repeat the refusal); any other failure keeps the item.
 * With nothing approved the card says so instead of disappearing.
 */

const TITLE = "Approved, ready to run";
const ACCESS_FALLBACK_TEXT = "You do not have access to run this approved action.";
const GENERIC_FORBIDDEN = new Set(["forbidden", "forbidden resource", "request failed"]);

/** The server's refusal, or a plain access message when it sent only a generic "Forbidden". */
function accessMessage(error: string | null): string {
  const message = error?.trim() ?? "";
  return !message || GENERIC_FORBIDDEN.has(message.toLowerCase()) ? ACCESS_FALLBACK_TEXT : message;
}

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
  const [denied, setDenied] = useState<{ title: string; message: string } | null>(null);

  const approved = useMemo(() => items.filter((i) => runnable(i) && !done.has(i.id)), [items, done]);

  const remove = (id: string) => setDone((prev) => new Set(prev).add(id));

  const run = async (item: ActionQueueItem) => {
    setRunning(item.id);
    setDenied(null);
    try {
      const res = await runApprovedQueueItem(businessId, item);
      if (!res.data) {
        if (res.status === 403) {
          const message = accessMessage(res.error);
          toast.error(message);
          setDenied({ title: item.title, message });
          remove(item.id);
          return;
        }
        toast.error(res.error ?? "The approved action could not be run");
        return;
      }
      if (res.data.success) {
        toast.success(`Ran: ${item.title}`);
        remove(item.id);
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

  return (
    <SectionCard
      title={TITLE}
      subtitle={approved.length > 0 ? `${approved.length} approved action${approved.length > 1 ? "s" : ""}` : "Nothing waiting"}
      icon={CheckCircle2}
    >
      {denied ? (
        <div
          role="alert"
          data-testid="approved-actions-denied"
          className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2"
        >
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Not run: {denied.title}</p>
            <p className="text-xs text-muted-foreground">{denied.message}</p>
          </div>
        </div>
      ) : null}
      {approved.length === 0 ? (
        <div data-testid="approved-actions-empty">
          <EmptyState
            icon={CheckCircle2}
            title="Nothing approved is waiting to run"
            description="When you approve a KEY action that was queued for your sign-off, it appears here with a Run action."
            variant="compact"
          />
        </div>
      ) : (
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
      )}
    </SectionCard>
  );
}

/**
 * D-72: the approved-action queue for one business, as the Command Center page mounts it. It reads
 * GET actions/businesses/:b/queue (the server lists an approved step only for a member who may run
 * it) and reads it again after a step ran. A queue that could not be read says so: it is never
 * shown as "nothing approved".
 */
export function ApprovedActionsPanel({ businessId }: { businessId: string }) {
  // Each answer is kept with the business it was read for, so another business never shows it.
  const [loaded, setLoaded] = useState<{ businessId: string; items: ActionQueueItem[] } | null>(null);
  const [failed, setFailed] = useState<{ businessId: string; message: string } | null>(null);
  const latest = useRef(0);
  const items = loaded?.businessId === businessId ? loaded.items : null;
  const loadError = failed?.businessId === businessId ? failed.message : null;

  // fetchActionQueue never throws: a network failure comes back as { data: null, error }.
  const load = useCallback(() => {
    const request = ++latest.current;
    return fetchActionQueue(businessId, undefined, 50).then((res) => {
      if (request !== latest.current) return;
      if (res.data) {
        setLoaded({ businessId, items: res.data.items ?? [] });
        setFailed(null);
        return;
      }
      setFailed({ businessId, message: res.error ?? "The approved actions could not be loaded" });
    });
  }, [businessId]);

  useEffect(() => {
    void load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  if (items === null) {
    return (
      <div data-testid="approved-actions-panel">
        <SectionCard title={TITLE} icon={CheckCircle2}>
          {loadError ? (
            <div data-testid="approved-actions-unavailable" role="alert" className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Approved actions could not be loaded</p>
                  <p className="truncate text-xs text-muted-foreground">{loadError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[hsl(var(--kf-border))] px-2.5 py-1 text-xs font-medium"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            </div>
          ) : (
            <div data-testid="approved-actions-loading" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading approved actions...
            </div>
          )}
        </SectionCard>
      </div>
    );
  }

  return (
    <div data-testid="approved-actions-panel">
      <ApprovedActionsQueue businessId={businessId} items={items} onRan={() => void load()} />
    </div>
  );
}
