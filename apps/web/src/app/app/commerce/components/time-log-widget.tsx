"use client";

import { useEffect, useState } from "react";
import { Clock, Plus, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

type RefType = "INVOICE" | "QUOTE" | "BOOKING" | "PROJECT" | "ORDER";

interface TimeCostEntry {
  id: string;
  minutes: number;
  costRate: number | null;
  costAmount: number;
  currency: string;
  notes: string | null;
  occurredAt: string;
  staffId: string | null;
  contactId: string | null;
}

interface Props {
  businessId: string;
  refType: RefType;
  refId: string;
  accentColor?: string;
}

/**
 * Compact time-log widget for quote / invoice / booking / project / order
 * detail views. Lists entries, totals minutes + cost, and lets the operator
 * add or remove a row inline.
 */
export function TimeLogWidget({ businessId, refType, refId, accentColor = "#10b981" }: Props) {
  const [entries, setEntries] = useState<TimeCostEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [costRate, setCostRate] = useState("");
  const [notes, setNotes] = useState("");

  const reload = async () => {
    setLoading(true);
    const res = await apiGet<{ entries: TimeCostEntry[] } | TimeCostEntry[]>(
      `/commerce/businesses/${businessId}/time-cost/by-ref/${refType}/${refId}`,
    );
    const data = res.data;
    if (Array.isArray(data)) setEntries(data);
    else if (data && Array.isArray((data as { entries?: TimeCostEntry[] }).entries)) {
      setEntries((data as { entries: TimeCostEntry[] }).entries);
    } else setEntries([]);
    setLoading(false);
  };

  useEffect(() => {
    if (businessId && refId) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, refId, refType]);

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
  const totalCost = entries.reduce((s, e) => s + (Number(e.costAmount) || 0), 0);
  const currency = entries[0]?.currency ?? "TTD";

  const handleAdd = async () => {
    const m = parseInt(minutes, 10);
    if (!m || m <= 0) return;
    const res = await apiPost<TimeCostEntry>({
      path: `/commerce/businesses/${businessId}/time-cost`,
      body: {
        refType,
        refId,
        minutes: m,
        costRate: costRate ? parseFloat(costRate) : undefined,
        notes: notes || undefined,
      },
    });
    if (res.data) {
      setMinutes("");
      setCostRate("");
      setNotes("");
      setAdding(false);
      void reload();
    }
  };

  const handleRemove = async (id: string) => {
    await apiDelete(`/commerce/businesses/${businessId}/time-cost/${id}`);
    void reload();
  };

  const fmtDuration = (m: number) => {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return h > 0 ? `${h}h ${min}m` : `${min}m`;
  };

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-border/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4" style={{ color: accentColor, opacity: 0.85 }} />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Time logged
          </h4>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {entries.length > 0 && (
            <span>
              {fmtDuration(totalMinutes)} · {currency} {totalCost.toFixed(2)}
            </span>
          )}
          <button
            onClick={() => setAdding((a) => !a)}
            className="inline-flex items-center gap-1 text-xs font-medium hover:text-foreground transition-colors"
            style={{ color: accentColor }}
          >
            <Plus className="w-3 h-3" />
            {adding ? "Cancel" : "Add"}
          </button>
        </div>
      </div>

      {adding && (
        <div className="px-4 py-3 border-b border-border/30 grid grid-cols-2 gap-2">
          <input
            type="number"
            min={1}
            placeholder="Minutes"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="col-span-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-border/40 text-sm focus:outline-none focus:ring-1"
            style={{ borderColor: `${accentColor}33` }}
          />
          <input
            type="number"
            min={0}
            step={0.01}
            placeholder="Hourly rate (optional)"
            value={costRate}
            onChange={(e) => setCostRate(e.target.value)}
            className="col-span-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-border/40 text-sm focus:outline-none focus:ring-1"
            style={{ borderColor: `${accentColor}33` }}
          />
          <input
            type="text"
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="col-span-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-border/40 text-sm focus:outline-none focus:ring-1"
            style={{ borderColor: `${accentColor}33` }}
          />
          <button
            onClick={handleAdd}
            className="col-span-2 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: accentColor }}
          >
            Log time
          </button>
        </div>
      )}

      <div className="divide-y divide-border/20">
        {loading && entries.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            No time logged yet — track effort to see real margin per job.
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground/90">
                  {fmtDuration(e.minutes)}{" "}
                  <span className="text-xs text-muted-foreground">
                    · {e.currency} {Number(e.costAmount).toFixed(2)}
                  </span>
                </div>
                {e.notes && (
                  <div className="text-xs text-muted-foreground truncate">{e.notes}</div>
                )}
              </div>
              <button
                onClick={() => handleRemove(e.id)}
                className="text-muted-foreground hover:text-red-400 transition-colors"
                aria-label="Remove time entry"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
