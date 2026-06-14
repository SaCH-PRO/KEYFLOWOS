"use client";

import { useEffect, useState, useCallback } from "react";
import { Receipt, Plus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchReceipts, createReceipt, deleteReceipt,
  type Receipt as ReceiptType,
} from "@/lib/api/continental-ops";

export default function ReceiptsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [receipts, setReceipts] = useState<ReceiptType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [receiptNumber, setReceiptNumber] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [receivedFrom, setReceivedFrom] = useState("");
  const [receivedBy, setReceivedBy] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchReceipts(businessId);
      if (res.data) setReceipts(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load receipts");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!businessId || !receiptNumber.trim() || !invoiceId.trim() || !amount) return;
    setSaving(true);
    try {
      const res = await createReceipt(businessId, {
        receiptNumber: receiptNumber.trim(),
        invoiceId: invoiceId.trim(),
        amount: Number(amount),
        paymentMethod,
        receivedFrom: receivedFrom.trim() || undefined,
        receivedBy: receivedBy.trim() || undefined,
      });
      if (res.data) {
        setReceipts((prev) => [...prev, res.data!]);
        setShowAdd(false);
        setReceiptNumber("");
        setInvoiceId("");
        setAmount("");
        setPaymentMethod("cash");
        setReceivedFrom("");
        setReceivedBy("");
        toast.success("Receipt created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      await deleteReceipt(businessId, id);
      setReceipts((prev) => prev.filter((r) => r.id !== id));
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <UnifiedPageShell
      title="Receipts"
      subtitle="Formal payment receipts linked to invoices."
      icon={Receipt}
      maxWidth="5xl"
      headerActions={
        <button onClick={() => setShowAdd(!showAdd)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity">
          <Plus className="w-3 h-3" /> Add Receipt
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
              <input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} placeholder="Receipt Number" aria-label="Receipt Number" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="Invoice ID" aria-label="Invoice ID" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" aria-label="Amount" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} aria-label="Payment method" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }}>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="credit_card">Credit Card</option>
              </select>
              <input value={receivedFrom} onChange={(e) => setReceivedFrom(e.target.value)} placeholder="Received from" aria-label="Received from" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
              <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Received by" aria-label="Received by" className="px-3 py-2 rounded-lg border text-sm bg-background" style={{ borderColor: "hsl(var(--kf-border))" }} />
            </div>
            <button onClick={handleCreate} disabled={saving || !receiptNumber.trim() || !invoiceId.trim() || !amount} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create Receipt
            </button>
          </div>
        )}

        <DataTable
          data={receipts as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "receiptNumber", header: "Receipt #", sortable: true, getValue: (r) => (r as unknown as ReceiptType).receiptNumber },
            { key: "invoice", header: "Invoice", sortable: true, getValue: (r) => (r as unknown as ReceiptType).invoice?.invoiceNumber ?? "—" },
            { key: "amount", header: "Amount", sortable: true, render: (r) => <span className="text-xs font-medium">{(r as unknown as ReceiptType).amount.toLocaleString()}</span> },
            { key: "paymentMethod", header: "Method", sortable: true, getValue: (r) => (r as unknown as ReceiptType).paymentMethod },
            { key: "receivedAt", header: "Date", render: (r) => <span className="text-xs text-muted-foreground">{new Date((r as unknown as ReceiptType).receivedAt).toLocaleDateString()}</span> },
            { key: "actions", header: "", render: (r) => (
              <button onClick={() => handleDelete((r as unknown as ReceiptType).id)} className="p-1 rounded hover:bg-red-500/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            )},
          ]}
          emptyMessage="No receipts yet."
        />
      </div>
    </UnifiedPageShell>
  );
}
