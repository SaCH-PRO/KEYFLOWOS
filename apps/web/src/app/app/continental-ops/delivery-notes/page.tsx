"use client";

import { useEffect, useState, useCallback } from "react";
import { Truck, Plus, Loader2, Trash2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchDeliveryNotes, createDeliveryNote, fulfillDeliveryNote, cancelDeliveryNote, deleteDeliveryNote,
  type DeliveryNote,
} from "@/lib/api/continental-ops";

export default function DeliveryNotesPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [dnNumber, setDnNumber] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [itemsJson, setItemsJson] = useState('[{"description":"","quantity":1}]');
  const [notesInput, setNotesInput] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDeliveryNotes(businessId);
      if (res.data) setNotes(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load delivery notes");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!businessId || !dnNumber.trim() || !invoiceId.trim()) return;
    let items: DeliveryNote['items'];
    try {
      items = JSON.parse(itemsJson);
      if (!Array.isArray(items)) throw new Error("Must be an array");
    } catch {
      toast.error("Items must be valid JSON array");
      return;
    }
    setSaving(true);
    try {
      const res = await createDeliveryNote(businessId, {
        dnNumber: dnNumber.trim(),
        invoiceId: invoiceId.trim(),
        items,
        notes: notesInput.trim() || undefined,
      });
      if (res.data) {
        setNotes((prev) => [...prev, res.data!]);
        setShowAdd(false);
        setDnNumber("");
        setInvoiceId("");
        setItemsJson('[{"description":"","quantity":1}]');
        setNotesInput("");
        toast.success("Delivery note created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handleFulfill = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Mark as delivered? Stock will be decremented.")) return;
    try {
      const res = await fulfillDeliveryNote(businessId, id, {});
      if (res.data) {
        setNotes((prev) => prev.map((n) => (n.id === id ? res.data! : n)));
        toast.success("Delivery note fulfilled");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to fulfill");
    }
  };

  const handleCancel = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Cancel this delivery note?")) return;
    try {
      const res = await cancelDeliveryNote(businessId, id);
      if (res.data) {
        setNotes((prev) => prev.map((n) => (n.id === id ? res.data! : n)));
        toast.success("Delivery note cancelled");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel");
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      await deleteDeliveryNote(businessId, id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <UnifiedPageShell
      title="Delivery Notes"
      subtitle="Authorize release of goods from inventory."
      icon={Truck}
      maxWidth="5xl"
      headerActions={
        <button onClick={() => setShowAdd(!showAdd)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity">
          <Plus className="w-3 h-3" /> Add D/N
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
              <input value={dnNumber} onChange={(e) => setDnNumber(e.target.value)} placeholder="D/N Number" aria-label="D/N Number" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="Invoice ID" aria-label="Invoice ID" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <textarea value={itemsJson} onChange={(e) => setItemsJson(e.target.value)} placeholder='Items JSON' rows={3} aria-label="Items JSON" className="w-full px-3 py-2 rounded-lg border text-sm bg-background font-mono sm:col-span-2" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input value={notesInput} onChange={(e) => setNotesInput(e.target.value)} placeholder="Notes (optional)" aria-label="Notes" className="px-3 py-2 rounded-lg border text-sm bg-background sm:col-span-2" style={{ borderColor: "hsl(var(--kf-border))" }} />
            </div>
            <button onClick={handleCreate} disabled={saving || !dnNumber.trim() || !invoiceId.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create D/N
            </button>
          </div>
        )}

        <DataTable
          data={notes as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "dnNumber", header: "D/N #", sortable: true, getValue: (r) => (r as unknown as DeliveryNote).dnNumber },
            { key: "invoice", header: "Invoice", sortable: true, getValue: (r) => (r as unknown as DeliveryNote).invoice?.invoiceNumber ?? "—" },
            { key: "status", header: "Status", sortable: true, render: (r) => {
              const s = (r as unknown as DeliveryNote).status;
              const color = s === 'DELIVERED' ? 'text-emerald-600' : s === 'CANCELLED' ? 'text-red-500' : s === 'ISSUED' ? 'text-blue-500' : 'text-amber-500';
              return <span className={`text-xs font-medium ${color}`}>{s}</span>;
            }},
            { key: "items", header: "Items", render: (r) => {
              const items = (r as unknown as DeliveryNote).items;
              return <span className="text-xs text-muted-foreground">{items?.length ?? 0} line(s)</span>;
            }},
            { key: "deliveredAt", header: "Delivered", render: (r) => {
              const d = (r as unknown as DeliveryNote).deliveredAt;
              return <span className="text-xs text-muted-foreground">{d ? new Date(d).toLocaleDateString() : "—"}</span>;
            }},
            { key: "actions", header: "", render: (r) => {
              const dn = r as unknown as DeliveryNote;
              return (
                <div className="flex items-center gap-1">
                  {dn.status === 'DRAFT' || dn.status === 'ISSUED' ? (
                    <button onClick={() => handleFulfill(dn.id)} className="p-1 rounded hover:bg-emerald-500/10 transition-colors" title="Mark delivered">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    </button>
                  ) : null}
                  {dn.status !== 'DELIVERED' && dn.status !== 'CANCELLED' ? (
                    <button onClick={() => handleCancel(dn.id)} className="p-1 rounded hover:bg-red-500/10 transition-colors" title="Cancel">
                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  ) : null}
                  <button onClick={() => handleDelete(dn.id)} className="p-1 rounded hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
              );
            }},
          ]}
          emptyMessage="No delivery notes yet."
        />
      </div>
    </UnifiedPageShell>
  );
}
