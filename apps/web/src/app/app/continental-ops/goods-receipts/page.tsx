"use client";

import { useEffect, useState, useCallback } from "react";
import { PackageCheck, Plus, Loader2, Trash2, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchGoodsReceipts, createGoodsReceipt, postGoodsReceipt, deleteGoodsReceipt,
  type GoodsReceipt,
} from "@/lib/api/continental-ops";

export default function GoodsReceiptsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [grNumber, setGrNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [itemsJson, setItemsJson] = useState('[{"description":"","qtyOrdered":0,"qtyReceived":0,"qtyAccepted":0,"qtyRejected":0}]');
  const [notesInput, setNotesInput] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGoodsReceipts(businessId);
      if (res.data) setReceipts(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load goods receipts");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!businessId || !grNumber.trim()) return;
    let items: GoodsReceipt['items'];
    try {
      items = JSON.parse(itemsJson);
      if (!Array.isArray(items)) throw new Error("Must be an array");
    } catch {
      toast.error("Items must be valid JSON array");
      return;
    }
    setSaving(true);
    try {
      const res = await createGoodsReceipt(businessId, {
        grNumber: grNumber.trim(),
        supplierName: supplierName.trim() || undefined,
        receivedBy: receivedBy.trim() || undefined,
        notes: notesInput.trim() || undefined,
        items,
      });
      if (res.data) {
        setReceipts((prev) => [...prev, res.data!]);
        setShowAdd(false);
        setGrNumber("");
        setSupplierName("");
        setReceivedBy("");
        setItemsJson('[{"description":"","qtyOrdered":0,"qtyReceived":0,"qtyAccepted":0,"qtyRejected":0}]');
        setNotesInput("");
        toast.success("Goods receipt created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handlePost = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Post this receipt? Inventory stock will be increased.")) return;
    try {
      const res = await postGoodsReceipt(businessId, id);
      if (res.data) {
        setReceipts((prev) => prev.map((r) => (r.id === id ? res.data! : r)));
        toast.success("Goods receipt posted to inventory");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post");
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      await deleteGoodsReceipt(businessId, id);
      setReceipts((prev) => prev.filter((r) => r.id !== id));
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <UnifiedPageShell
      title="Goods Receipts"
      subtitle="Record physical receipt of inventory."
      icon={PackageCheck}
      maxWidth="5xl"
      headerActions={
        <button onClick={() => setShowAdd(!showAdd)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity">
          <Plus className="w-3 h-3" /> Add G/R
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
              <input value={grNumber} onChange={(e) => setGrNumber(e.target.value)} placeholder="G/R Number" aria-label="G/R Number" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier" aria-label="Supplier" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Received by" aria-label="Received by" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <textarea value={itemsJson} onChange={(e) => setItemsJson(e.target.value)} placeholder='Items JSON' rows={3} aria-label="Items JSON" className="w-full px-3 py-2 rounded-lg border text-sm bg-background font-mono sm:col-span-2" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input value={notesInput} onChange={(e) => setNotesInput(e.target.value)} placeholder="Notes (optional)" aria-label="Notes" className="px-3 py-2 rounded-lg border text-sm bg-background sm:col-span-2" style={{ borderColor: "hsl(var(--kf-border))" }} />
            </div>
            <button onClick={handleCreate} disabled={saving || !grNumber.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create G/R
            </button>
          </div>
        )}

        <DataTable
          data={receipts as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "grNumber", header: "G/R #", sortable: true, getValue: (r) => (r as unknown as GoodsReceipt).grNumber },
            { key: "supplier", header: "Supplier", sortable: true, getValue: (r) => (r as unknown as GoodsReceipt).supplierName ?? "—" },
            { key: "status", header: "Status", sortable: true, render: (r) => {
              const s = (r as unknown as GoodsReceipt).status;
              const color = s === 'POSTED' ? 'text-emerald-600' : s === 'DISCREPANCY' ? 'text-red-500' : 'text-amber-500';
              return <span className={`text-xs font-medium ${color}`}>{s}</span>;
            }},
            { key: "items", header: "Lines", render: (r) => {
              const items = (r as unknown as GoodsReceipt).items;
              return <span className="text-xs text-muted-foreground">{items?.length ?? 0}</span>;
            }},
            { key: "receivedAt", header: "Received", render: (r) => {
              const d = (r as unknown as GoodsReceipt).receivedAt;
              return <span className="text-xs text-muted-foreground">{d ? new Date(d).toLocaleDateString() : "—"}</span>;
            }},
            { key: "actions", header: "", render: (r) => {
              const gr = r as unknown as GoodsReceipt;
              return (
                <div className="flex items-center gap-1">
                  {gr.status !== 'POSTED' && (
                    <button onClick={() => handlePost(gr.id)} className="p-1 rounded hover:bg-emerald-500/10 transition-colors" title="Post to inventory">
                      <ClipboardCheck className="w-3.5 h-3.5 text-emerald-500" />
                    </button>
                  )}
                  <button onClick={() => handleDelete(gr.id)} className="p-1 rounded hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
              );
            }},
          ]}
          emptyMessage="No goods receipts yet."
        />
      </div>
    </UnifiedPageShell>
  );
}
