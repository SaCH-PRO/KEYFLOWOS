"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "@keyflow/ui";
import {
  completeContactNextAction,
  fetchContactNextActions,
  snoozeContactNextAction,
  type NextActionItem,
} from "@/lib/client";
import { getContactNextActionTypeLabel } from "@/lib/crm-constants";

type Props = {
  businessId?: string;
  windowDays?: number;
  limit?: number;
  className?: string;
};

const PRIORITY_TONE: Record<string, "info" | "success" | "warning" | "danger" | "default"> = {
  URGENT: "danger",
  HIGH: "warning",
  NORMAL: "info",
  LOW: "default",
};

function contactName(item: NextActionItem): string {
  if (item.displayName && item.displayName.trim()) return item.displayName.trim();
  const full = `${item.firstName ?? ""} ${item.lastName ?? ""}`.trim();
  if (full) return full;
  return item.email || item.phone || "Unnamed";
}

function relativeWhen(iso: string | null, overdue: boolean): string {
  if (!iso) return "";
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return "";
  const diffMs = target.getTime() - Date.now();
  const absMin = Math.abs(diffMs) / 60_000;
  let label: string;
  if (absMin < 60) label = `${Math.max(1, Math.round(absMin))}m`;
  else if (absMin < 60 * 24) label = `${Math.round(absMin / 60)}h`;
  else label = `${Math.round(absMin / (60 * 24))}d`;
  return overdue ? `${label} overdue` : `in ${label}`;
}

export function NextActionsWidget({ businessId, windowDays = 7, limit = 25, className }: Props) {
  const [items, setItems] = useState<NextActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchContactNextActions(businessId, windowDays, limit, { signal });
        if (signal?.aborted) return;
        setItems(res.data?.items ?? []);
        if (res.error) setError(res.error);
      } catch (err) {
        if (!signal?.aborted) setError((err as Error).message ?? "Failed to load");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [businessId, windowDays, limit],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const onComplete = async (id: string) => {
    setBusyId(id);
    try {
      const res = await completeContactNextAction(id, businessId);
      if (res.error || !res.data) {
        setError(res.error ?? "Failed to mark done");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      setError(null);
    } catch (err) {
      setError((err as Error).message ?? "Failed to mark done");
    } finally {
      setBusyId(null);
    }
  };

  const onSnooze = async (id: string, days: number) => {
    setBusyId(id);
    try {
      const res = await snoozeContactNextAction(id, { days }, businessId);
      if (res.error || !res.data) {
        setError(res.error ?? "Failed to snooze");
        return;
      }
      setError(null);
      await load();
    } catch (err) {
      setError((err as Error).message ?? "Failed to snooze");
    } finally {
      setBusyId(null);
    }
  };

  const overdueCount = useMemo(() => items.filter((i) => i.overdue).length, [items]);

  return (
    <Card
      className={`space-y-3 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow ${className ?? ""}`}
      padding="lg"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Next actions</p>
          <p className="text-[11px] text-slate-500">
            Upcoming reminders within {windowDays} days · {items.length} contact{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overdueCount > 0 && <Badge tone="danger">{overdueCount} overdue</Badge>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh next actions"
          >
            {loading ? "…" : "Refresh"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {error}
        </div>
      )}

      {!loading && items.length === 0 ? (
        <p className="text-xs text-slate-500">No upcoming next actions. You&apos;re all clear.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const overdue = item.overdue;
            const priority = (item.priority ?? "NORMAL").toUpperCase();
            const priorityTone = PRIORITY_TONE[priority] ?? "default";
            return (
              <div
                key={item.id}
                className={`flex flex-col gap-2 rounded-xl border p-3 text-sm shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between ${
                  overdue
                    ? "border-rose-300 bg-rose-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/crm/contacts/${encodeURIComponent(item.id)}`}
                      className="truncate font-semibold text-slate-900 hover:underline"
                    >
                      {contactName(item)}
                    </Link>
                    <Badge tone={priorityTone}>{priority}</Badge>
                    {overdue && <Badge tone="danger">Overdue</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                    <span>
                      {item.nextActionAt
                        ? new Date(item.nextActionAt).toLocaleString()
                        : "—"}
                    </span>
                    <span className={overdue ? "text-rose-700 font-medium" : "text-slate-500"}>
                      {relativeWhen(item.nextActionAt, overdue)}
                    </span>
                    {item.nextActionType && (
                      <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600">
                        {getContactNextActionTypeLabel(item.nextActionType)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-1">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => void onComplete(item.id)}
                    disabled={busyId === item.id}
                  >
                    Mark done
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onSnooze(item.id, 1)}
                    disabled={busyId === item.id}
                    aria-label="Snooze 1 day"
                  >
                    +1d
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onSnooze(item.id, 7)}
                    disabled={busyId === item.id}
                    aria-label="Snooze 7 days"
                  >
                    +7d
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default NextActionsWidget;
