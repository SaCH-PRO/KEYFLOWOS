"use client";

import { useEffect, useState, useCallback } from "react";
import { ClipboardList, Plus, Loader2, Trash2, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchStockCounts, createStockCount, adjustStockCount, deleteStockCount,
  type StockCount,
} from "@/lib/api/continental-ops";

export default function StockCountsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [countNumber, setCountNumber] = useState("");
  const [countDate, setCountDate] = useState("");
  const [countedBy, setCountedBy] = useState("");
  const [itemsJson, setItemsJson] = useState('[{"description":"","systemQty":0,"countedQty":0}]');
  const [notesInput, setNotesInput] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchStockCounts(businessId);
      if (res.data) setCounts(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stock counts");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!businessId || !countNumber.trim()) return;
    let items: StockCount['items'];
    try {
      items = JSON.parse(itemsJson);
      if (!Array.isArray(items)) throw new Error("Must be an array");
    } catch {
      toast.error("Items must be valid JSON array");
      return;
    }
    setSaving(true);
    try {
      const res = await createStockCount(businessId, {
        countNumber: countNumber.trim(),
        countDate: countDate || undefined,
        countedBy: countedBy.trim() || undefined,
        notes: notesInput.trim() || undefined,
        items,
      });
      if (res.data) {
        setCounts((prev) => [...prev, res.data!]);
        setShowAdd(false);
        setCountNumber("");
        setCountDate("");
        setCountedBy("");
        setItemsJson('[{"description":"","systemQty":0,"countedQty":0}]');
        setNotesInput("");
        toast.success("Stock count created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handleAdjust = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Apply adjustments? System stock will be updated to counted quantities.")) return;
    try {
      const res = await adjustStockCount(businessId, id);
      if (res.data) {
        setCounts((prev) => prev.map((c) => (c.id === id ? res.data! : c)));
        toast.success("Stock adjusted");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to adjust");
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      await deleteStockCount(businessId, id);
      setCounts((prev) => prev.filter((c) => c.id !== id));
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <UnifiedPageShell
      title="Stock Counts"
      subtitle="Physical stock counts with variance audit."
      icon={ClipboardList}
      maxWidth="5xl"
      headerActions={
        <button onClick={() => setShowAdd(!showAdd)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity">
          <Plus className="w-3 h-3" /> Add Count
        </button>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error} <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        )}
        {showAdd && (
          <div className="kf-card p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={countNumber} onChange={(e) => setCountNumber(e.target.value)} placeholder="Count Number" aria-label="Count Number" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} aria-label="Count date" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input value={countedBy} onChange={(e) => setCountedBy(e.target.value)} placeholder="Counted by" aria-label="Counted by" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <textarea value={itemsJson} onChange={(e) => setItemsJson(e.target.value)} placeholder='Items JSON' rows={3} aria-label="Items JSON" className="w-full px-3 py-2 rounded-lg border text-sm bg-background font-mono sm:col-span-2" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input value={notesInput} onChange={(e) => setNotesInput(e.target.value)} placeholder="Notes (optional)" aria-label="Notes" className="px-3 py-2 rounded-lg border text-sm bg-background sm:col-span-2" style={{ borderColor: "hsl(var(--kf-border))" }} />
            </div>
            <button onClick={handleCreate} disabled={saving || !countNumber.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create Count
            </button>
          </div>
        )}

        <DataTable
          data={counts as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "countNumber", header: "Count #", sortable: true, getValue: (r) => (r as unknown as StockCount).countNumber },
            { key: "status", header: "Status", sortable: true, render: (r) => {
              const s = (r as unknown as StockCount).status;
              const color = s === 'ADJUSTED' ? 'text-emerald-600' : s === 'COMPLETED' ? 'text-blue-500' : 'text-amber-500';
              return <span className={`text-xs font-medium ${color}`}>{s}</span>;
            }},
            { key: "items", header: "Variances", render: (r) => {
              const items = (r as unknown as StockCount).items;
              const variances = items?.filter((i) => i.variance !== 0).length ?? 0;
              return <span className={`text-xs ${variances > 0 ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>{variances} issue(s)</span>;
            }},
            { key: "countDate", header: "Date", render: (r) => <span className="text-xs text-muted-foreground">{new Date((r as unknown as StockCount).countDate).toLocaleDateString()}</span> },
            { key: "countedBy", header: "By", getValue: (r) => (r as unknown as StockCount).countedBy ?? "—" },
            { key: "actions", header: "", render: (r) => {
              const sc = r as unknown as StockCount;
              return (
                <div className="flex items-center gap-1">
                  {sc.status !== 'ADJUSTED' && (
                    <button onClick={() => handleAdjust(sc.id)} className="p-1 rounded hover:bg-emerald-500/10 transition-colors" title="Apply adjustments">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    </button>
                  )}
                  <button onClick={() => handleDelete(sc.id)} className="p-1 rounded hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
              );
            }},
          ]}
          emptyMessage="No stock counts yet."
        />
      </div>
    </UnifiedPageShell>
  );
}
