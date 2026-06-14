"use client";

import { useEffect, useState, useCallback } from "react";
import { FileMinus, Plus, Loader2, Trash2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchCreditNotes, createCreditNote, applyCreditNote, voidCreditNote, type CreditNote } from "@/lib/api/finance";

export default function CreditNotesPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [invoiceId, setInvoiceId] = useState("");
  const [creditNoteNumber, setCreditNoteNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCreditNotes(businessId);
      if (res.data) setNotes(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load credit notes");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!businessId || !invoiceId.trim() || !creditNoteNumber.trim() || !amount) return;
    setSaving(true);
    try {
      const res = await createCreditNote(businessId, {
        invoiceId: invoiceId.trim(),
        creditNoteNumber: creditNoteNumber.trim(),
        amount: Number(amount),
        reason: reason.trim() || undefined,
      });
      if (res.data) {
        setNotes((prev) => [...prev, res.data!]);
        setShowAdd(false);
        setInvoiceId("");
        setCreditNoteNumber("");
        setAmount("");
        setReason("");
        toast.success("Credit note created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create credit note");
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async (id: string) => {
    if (!businessId) return;
    try {
      const res = await applyCreditNote(businessId, id);
      if (res.data) {
        load();
        toast.success("Credit note applied");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to apply credit note");
    }
  };

  const handleVoid = async (id: string) => {
    if (!businessId) return;
    try {
      const res = await voidCreditNote(businessId, id);
      if (res.data) {
        load();
        toast.success("Credit note voided");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to void credit note");
    }
  };

  return (
    <UnifiedPageShell
      title="Credit Notes"
      subtitle="Issue credit memos against invoices."
      icon={FileMinus}
      maxWidth="5xl"
      headerActions={
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3 h-3" />
          Add Credit Note
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                placeholder="Invoice ID"
                aria-label="Invoice ID"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={creditNoteNumber}
                onChange={(e) => setCreditNoteNumber(e.target.value)}
                placeholder="Credit Note Number"
                aria-label="Credit note number"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                aria-label="Amount"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                aria-label="Reason"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !invoiceId.trim() || !creditNoteNumber.trim() || !amount}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Credit Note
            </button>
          </div>
        )}

        <DataTable
          data={notes as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "creditNoteNumber", header: "CN #", sortable: true, getValue: (r) => (r as unknown as CreditNote).creditNoteNumber },
            { key: "amount", header: "Amount", sortable: true, render: (r) => <span className="text-xs font-medium">{(r as unknown as CreditNote).amount.toLocaleString()}</span> },
            { key: "status", header: "Status", sortable: true, render: (r) => {
              const s = (r as unknown as CreditNote).status;
              const color = s === 'APPLIED' ? 'text-emerald-600' : s === 'VOID' ? 'text-red-500' : 'text-amber-500';
              return <span className={`text-xs font-medium ${color}`}>{s}</span>;
            }},
            { key: "reason", header: "Reason", getValue: (r) => (r as unknown as CreditNote).reason ?? "—" },
            { key: "actions", header: "", render: (r) => {
              const note = r as unknown as CreditNote;
              return (
                <div className="flex items-center gap-1">
                  {note.status === 'DRAFT' && (
                    <button onClick={() => handleApply(note.id)} className="p-1 rounded hover:bg-emerald-500/10 transition-colors" title="Apply">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    </button>
                  )}
                  {note.status === 'DRAFT' && (
                    <button onClick={() => handleVoid(note.id)} className="p-1 rounded hover:bg-red-500/10 transition-colors" title="Void">
                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  )}
                </div>
              );
            }},
          ]}
          emptyMessage="No credit notes yet."
        />
      </div>
    </UnifiedPageShell>
  );
}
