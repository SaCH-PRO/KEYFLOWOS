"use client";

/**
 * What the business owes, and by when.
 *
 * The distinction this panel exists to hold: the Command Queue above it answers
 * "what should I look at" and sorts by priority. This answers "what do I owe",
 * and sorts by DATE — oldest first — because a question about time deserves an
 * answer ordered by time. They read from the same table and are not the same
 * list: the queue shows SUGGESTIONs (things KEY thinks would be a good idea),
 * this shows OBLIGATIONs (things owed to someone by a date).
 *
 * Overdue rows lead, and they are counted separately in the header. A due list
 * that quietly folds last week into this week is the one people stop reading.
 */

import { useEffect, useState, useCallback } from "react";
import { CalendarClock, Check, Loader2, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { fetchDueObligations, type DueObligation } from "@/lib/api/command";

interface Props {
  businessId: string;
  /** Discharge is the parent's job — it owns the reload of every other panel. */
  onDischarge: (id: string) => Promise<void>;
}

/** "3 days overdue" / "due today" / "in 4 days" — never a bare ISO string. */
function whenLabel(o: DueObligation): string {
  if (o.daysUntilDue === null) return "no date";
  const d = o.daysUntilDue;
  if (d < -1) return `${Math.abs(d)} days overdue`;
  if (d === -1) return "1 day overdue";
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `in ${d} days`;
}

export function DueObligationsPanel({ businessId, onDischarge }: Props) {
  const [items, setItems] = useState<DueObligation[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error: err } = await fetchDueObligations(businessId, { windowDays: 7 });
    // An error must not render as "nothing is due". Those look identical on a
    // dashboard and mean opposite things.
    setError(err);
    setItems(data?.items ?? []);
    setOverdueCount(data?.overdueCount ?? 0);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const discharge = async (id: string) => {
    setBusyId(id);
    try {
      await onDischarge(id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Checking what is due…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-center">
        <p className="text-sm text-destructive">Could not load what is due: {error}</p>
        <button
          onClick={() => void load()}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" /> Try again
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Nothing due in the next 7 days"
        description="Obligations appear here when something is owed — a client to rebook, a return to file, an invoice to chase."
      />
    );
  }

  return (
    <div className="space-y-2">
      {overdueCount > 0 && (
        <p className="text-xs font-medium text-destructive">
          {overdueCount} already overdue
        </p>
      )}

      {items.map((o) => (
        <div
          key={o.id}
          className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${
            o.overdue ? "border-destructive/30 bg-destructive/5" : "border-border/40 bg-card/40"
          }`}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{o.title}</p>
            <p className="text-xs text-muted-foreground">
              <span className={o.overdue ? "text-destructive font-medium" : ""}>
                {whenLabel(o)}
              </span>
              {/* Snapshot taken when the obligation was raised, so a later
                  rename does not rewrite what this row was about. */}
              {o.owedToLabel ? <> · {o.owedToLabel}</> : null}
            </p>
          </div>

          <button
            onClick={() => void discharge(o.id)}
            disabled={busyId === o.id}
            title="Record that this was done"
            className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border/50 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            {busyId === o.id ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Done
          </button>
        </div>
      ))}
    </div>
  );
}
