"use client";

import { useEffect, useState, useCallback } from "react";
import { CalendarDays, Plus, Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchAccountingPeriods, createAccountingPeriod, closeAccountingPeriod, reopenAccountingPeriod, type AccountingPeriod } from "@/lib/api/finance";

export default function AccountingPeriodsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [_loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [month, setMonth] = useState((new Date().getMonth() + 1).toString());

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAccountingPeriods(businessId);
      if (res.data) setPeriods(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load accounting periods");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!businessId || !year || !month) return;
    setSaving(true);
    try {
      const res = await createAccountingPeriod(businessId, {
        year: Number(year),
        month: Number(month),
      });
      if (res.data) {
        setPeriods((prev) => [...prev, res.data!]);
        setShowAdd(false);
        toast.success("Accounting period created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create period");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Close this period? Transactions within it will be locked.")) return;
    try {
      const res = await closeAccountingPeriod(businessId, id);
      if (res.data) {
        load();
        toast.success("Period closed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to close period");
    }
  };

  const handleReopen = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Reopen this period? Locked transactions will be unlocked.")) return;
    try {
      const res = await reopenAccountingPeriod(businessId, id);
      if (res.data) {
        load();
        toast.success("Period reopened");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reopen period");
    }
  };

  return (
    <UnifiedPageShell
      title="Accounting Periods"
      subtitle="Open and close monthly accounting periods."
      icon={CalendarDays}
      maxWidth="5xl"
      headerActions={
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3 h-3" />
          Add Period
        </button>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        )}
        {showAdd && (
          <div className="kf-card p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="Year"
                aria-label="Year"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2000, i, 1).toLocaleString("default", { month: "long" })}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Period
            </button>
          </div>
        )}

        <DataTable
          data={periods as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "year", header: "Year", sortable: true, getValue: (r) => String((r as unknown as AccountingPeriod).year) },
            { key: "month", header: "Month", sortable: true, render: (r) => {
              const m = (r as unknown as AccountingPeriod).month;
              return <span className="text-xs">{new Date(2000, m - 1, 1).toLocaleString("default", { month: "long" })}</span>;
            }},
            { key: "startDate", header: "Start", sortable: true, render: (r) => <span className="text-xs">{new Date((r as unknown as AccountingPeriod).startDate).toLocaleDateString()}</span> },
            { key: "endDate", header: "End", sortable: true, render: (r) => <span className="text-xs">{new Date((r as unknown as AccountingPeriod).endDate).toLocaleDateString()}</span> },
            { key: "status", header: "Status", sortable: true, render: (r) => {
              const s = (r as unknown as AccountingPeriod).status;
              return (
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${s === 'CLOSED' ? 'text-red-500' : 'text-emerald-600'}`}>
                  {s === 'CLOSED' ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {s}
                </span>
              );
            }},
            { key: "actions", header: "", render: (r) => {
              const p = r as unknown as AccountingPeriod;
              return (
                <div className="flex items-center gap-1">
                  {p.status === 'OPEN' ? (
                    <button onClick={() => handleClose(p.id)} className="p-1 rounded hover:bg-red-500/10 transition-colors" title="Close period">
                      <Lock className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  ) : (
                    <button onClick={() => handleReopen(p.id)} className="p-1 rounded hover:bg-emerald-500/10 transition-colors" title="Reopen period">
                      <Unlock className="w-3.5 h-3.5 text-emerald-500" />
                    </button>
                  )}
                </div>
              );
            }},
          ]}
          emptyMessage="No accounting periods yet."
        />
      </div>
    </UnifiedPageShell>
  );
}
