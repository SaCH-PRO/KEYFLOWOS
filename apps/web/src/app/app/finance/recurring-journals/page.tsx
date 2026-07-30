"use client";

import { useEffect, useState, useCallback } from "react";
import { Repeat, Plus, Loader2, Trash2, Play, Power, Calendar } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { InlineLineItemBuilder, type LineItem } from "@/components/finance/inline-line-item-builder";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchRecurringJournals, createRecurringJournal, updateRecurringJournal, deleteRecurringJournal, runRecurringJournal, fetchChartOfAccounts, type RecurringJournalEntry, type ChartOfAccount } from "@/lib/api/finance";

export default function RecurringJournalsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [entries, setEntries] = useState<RecurringJournalEntry[]>([]);
  const [_loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [nextRunDate, setNextRunDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [lineItemErrors, setLineItemErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, accountsRes] = await Promise.all([
        fetchRecurringJournals(businessId),
        fetchChartOfAccounts(businessId),
      ]);
      setEntries(entriesRes.data?.items ?? []);
      setAccounts(accountsRes.data?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recurring journals");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!businessId || !name.trim() || !nextRunDate) return;

    const errors: Record<string, string> = {};
    const validItems = lineItems.filter((item) => item.accountId && (item.debit || item.credit));
    if (validItems.length < 2) {
      errors.items = "Add at least two line items with an account and a debit or credit amount.";
    }
    const totalDebit = validItems.reduce((sum, item) => sum + (Number(item.debit) || 0), 0);
    const totalCredit = validItems.reduce((sum, item) => sum + (Number(item.credit) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      errors.balance = `Journal is out of balance by ${Math.abs(totalDebit - totalCredit).toFixed(2)}.`;
    }
    if (Object.keys(errors).length > 0) {
      setLineItemErrors(errors);
      return;
    }
    setLineItemErrors({});

    const entries = validItems.map((item) => ({
      accountId: item.accountId!,
      debit: Number(item.debit) || undefined,
      credit: Number(item.credit) || undefined,
      memo: item.memo || undefined,
    }));

    setSaving(true);
    try {
      const res = await createRecurringJournal(businessId, {
        name: name.trim(),
        description: description.trim() || undefined,
        frequency,
        nextRunDate,
        endDate: endDate || null,
        entries,
      });
      const created = res.data;
      if (created) {
        setEntries((prev) => [...prev, created]);
        setShowAdd(false);
        setName("");
        setDescription("");
        setNextRunDate("");
        setEndDate("");
        setLineItems([]);
        toast.success("Recurring journal created");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create recurring journal");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (entry: RecurringJournalEntry) => {
    if (!businessId) return;
    try {
      const res = await updateRecurringJournal(businessId, entry.id, { isActive: !entry.isActive });
      const updated = res.data;
      if (updated) {
        setEntries((prev) => prev.map((e) => (e.id === entry.id ? updated : e)));
        toast.success(updated.isActive ? "Entry activated" : "Entry deactivated");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update entry");
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      await deleteRecurringJournal(businessId, id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast.success("Entry deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete entry");
    }
  };

  const handleRun = async (id: string) => {
    if (!businessId) return;
    setRunning(id);
    try {
      await runRecurringJournal(businessId, id);
      toast.success("Journal entry executed");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to run entry");
    } finally {
      setRunning(null);
    }
  };

  return (
    <UnifiedPageShell
      title="Recurring Journals"
      subtitle="Scheduled double-entry journal entries."
      icon={Repeat}
      maxWidth="5xl"
      headerActions={
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3 h-3" />
          Add Entry
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Entry name (e.g. Monthly Depreciation)"
                aria-label="Entry name"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                aria-label="Description"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Bi-weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
              </select>
              <input
                type="date"
                value={nextRunDate}
                onChange={(e) => setNextRunDate(e.target.value)}
                placeholder="Next run date"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="End date (optional)"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Journal lines</label>
              <InlineLineItemBuilder
                mode="journal"
                items={lineItems}
                onChange={setLineItems}
                accounts={accounts}
                currency="TTD"
                errors={lineItemErrors}
                disabled={saving}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !name.trim() || !nextRunDate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Entry
            </button>
          </div>
        )}

        <DataTable
          data={entries as unknown as Record<string, unknown>[]}
          keyField="id"
          pageSize={25}
          columns={[
            { key: "name", header: "Name", sortable: true, getValue: (r) => (r as unknown as RecurringJournalEntry).name },
            { key: "frequency", header: "Frequency", sortable: true, getValue: (r) => (r as unknown as RecurringJournalEntry).frequency },
            { key: "nextRunDate", header: "Next Run", sortable: true, render: (r) => {
              const d = (r as unknown as RecurringJournalEntry).nextRunDate;
              return <span className="text-xs flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(d).toLocaleDateString()}</span>;
            }},
            { key: "runCount", header: "Runs", sortable: true, getValue: (r) => String((r as unknown as RecurringJournalEntry).runCount) },
            { key: "isActive", header: "Active", render: (r) => {
              const active = (r as unknown as RecurringJournalEntry).isActive;
              return (
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${active ? "text-emerald-600" : "text-muted-foreground"}`}>
                  <Power className="w-3 h-3" />
                  {active ? "Yes" : "No"}
                </span>
              );
            }},
            { key: "actions", header: "", render: (r) => {
              const entry = r as unknown as RecurringJournalEntry;
              return (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRun(entry.id)}
                    disabled={running === entry.id}
                    className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50"
                    title="Run now"
                  >
                    {running === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 text-emerald-500" />}
                  </button>
                  <button
                    onClick={() => handleToggle(entry)}
                    className="p-1 rounded hover:bg-muted transition-colors"
                    title={entry.isActive ? "Deactivate" : "Activate"}
                  >
                    <Power className={`w-3.5 h-3.5 ${entry.isActive ? "text-emerald-500" : "text-muted-foreground"}`} />
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="p-1 rounded hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
              );
            }},
          ]}
          emptyMessage="No recurring journal entries yet."
        />
      </div>
    </UnifiedPageShell>
  );
}
