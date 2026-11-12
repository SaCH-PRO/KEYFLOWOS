"use client";

/**
 * The General Journal (owner PR #195 part 3, PR195-PORT): manual double-entry
 * adjustments, mounted at /app/finance/journal.
 *
 * Held to the head's rules (docs/reconstruction/BUILD-MAP-001.md):
 *   - one currency per business (D-13): amounts are in the business currency
 *     the settings name, and nothing else is offered; the posting door refuses
 *     a manual journal in any other currency (V1-37), so the PR's currency
 *     picker and exchange-rate check are not ported;
 *   - the ledger keeps cash per chart row (V1-34): the door takes no
 *     FinancialAccount, so the PR's per-line account picker is not ported;
 *   - a refused journal read (403: revenue read, D-57; 503) says so, rather
 *     than showing an empty journal, and offers no New Entry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Save,
  BookOpen,
  Loader2,
  ArrowRightLeft,
  ShieldAlert,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { formatCurrency } from "@/lib/currency";
import {
  fetchJournalEntries,
  createJournalEntry,
  fetchFinanceCoa,
  fetchFinanceSettings,
  type JournalEntryRow,
  type ChartOfAccountRow,
} from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";

interface JournalFormLine {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

const emptyLine = (): JournalFormLine => ({ accountId: "", debit: "", credit: "", memo: "" });

/** Why the journal could not be read, as the member should hear it; null when it was read. */
function journalRefusal(res: { error?: string | null; status?: number } | null | undefined): string | null {
  if (!res || !res.error) return null;
  if (res.status === 403) return `You don't have access to the journal in this business. ${res.error}`;
  if (res.status === 503) return `The journal is unavailable right now. ${res.error}`;
  return `The journal could not be loaded. ${res.error}`;
}

export function BooksJournalTab() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBusinessId(getStoredBusinessId()); }, []);
  if (!businessId) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  return <JournalBody businessId={businessId} />;
}

function JournalBody({ businessId }: { businessId: string }) {
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);
  const [currency, setCurrency] = useState<string>("TTD");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<JournalFormLine[]>([emptyLine(), emptyLine()]);

  const load = useCallback(async () => {
    setLoading(true);
    const [eRes, aRes, settingsRes] = await Promise.all([
      fetchJournalEntries(businessId),
      fetchFinanceCoa(businessId),
      fetchFinanceSettings(businessId).catch(() => ({ data: null, error: null })),
    ]);
    const refused = journalRefusal(eRes as { error?: string | null; status?: number });
    setRefusal(refused);
    setEntries(!refused && Array.isArray(eRes.data?.items) ? eRes.data.items : []);
    if (Array.isArray(aRes.data?.items)) setAccounts(aRes.data.items);
    const businessCurrency = typeof settingsRes.data?.currency === "string" ? settingsRes.data.currency.trim().toUpperCase() : "";
    if (businessCurrency) setCurrency(businessCurrency);
    setLoading(false);
  }, [businessId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const totalDebit = useMemo(() => lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0), [lines]);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001;

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<JournalFormLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const handleSave = async () => {
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!balanced) { toast.error("Debits must equal credits"); return; }
    const activeLines = lines.filter((l) => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    if (activeLines.length < 2) { toast.error("At least 2 lines required"); return; }

    setSaving(true);
    // No currency is sent: the posting door posts the business currency (D-13).
    const res = await createJournalEntry(businessId, {
      date,
      description: description.trim(),
      reference: reference.trim() || undefined,
      entries: activeLines.map((l) => ({
        accountId: l.accountId,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        memo: l.memo.trim() || undefined,
      })),
    });
    setSaving(false);

    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Journal entry posted");
    setShowForm(false);
    setDescription("");
    setReference("");
    setLines([emptyLine(), emptyLine()]);
    load();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-muted/40 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">General Journal</h2>
          <p className="text-xs text-muted-foreground">Manual double-entry adjustments</p>
        </div>
        {!refusal && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80"
          >
            <Plus className="w-3.5 h-3.5" /> {showForm ? "Cancel" : "New Entry"}
          </button>
        )}
      </div>

      {refusal && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{refusal}</span>
        </div>
      )}

      {!refusal && showForm && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label htmlFor="journal-date" className="text-[10px] font-medium uppercase text-muted-foreground">Date</label>
              <input id="journal-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="journal-description" className="text-[10px] font-medium uppercase text-muted-foreground">Description</label>
              <input id="journal-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Adjust prepaid insurance" className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label htmlFor="journal-reference" className="text-[10px] font-medium uppercase text-muted-foreground">Reference #</label>
            <input id="journal-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional journal reference" className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" />
          </div>
          <p className="text-[11px] text-muted-foreground">Amounts in {currency} (the business currency).</p>

          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_100px_100px_1fr_auto] gap-2 text-[10px] font-medium uppercase text-muted-foreground">
              <span>Account</span>
              <span>Debit</span>
              <span>Credit</span>
              <span>Memo</span>
              <span />
            </div>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px_100px_1fr_auto] gap-2 items-center">
                <select
                  aria-label={`Line ${i + 1} chart of account`}
                  value={line.accountId}
                  onChange={(e) => updateLine(i, { accountId: e.target.value })}
                  className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code ? `${a.code} — ` : ""}{a.name} ({a.type})</option>
                  ))}
                </select>
                <input
                  aria-label={`Line ${i + 1} debit`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.debit}
                  onChange={(e) => updateLine(i, { debit: e.target.value, credit: "" })}
                  placeholder="0.00"
                  className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm tabular-nums"
                />
                <input
                  aria-label={`Line ${i + 1} credit`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.credit}
                  onChange={(e) => updateLine(i, { credit: e.target.value, debit: "" })}
                  placeholder="0.00"
                  className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm tabular-nums"
                />
                <input
                  aria-label={`Line ${i + 1} memo`}
                  value={line.memo}
                  onChange={(e) => updateLine(i, { memo: e.target.value })}
                  placeholder="Memo"
                  className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
                />
                <button
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => removeLine(i)}
                  className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button onClick={addLine} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Plus className="w-3 h-3" /> Add line
            </button>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/30">
            <div className={`text-xs font-medium ${balanced ? "text-emerald-500" : "text-rose-500"}`}>
              <span className="tabular-nums">Debits: {formatCurrency(totalDebit, currency)}</span>
              <span className="mx-2">·</span>
              <span className="tabular-nums">Credits: {formatCurrency(totalCredit, currency)}</span>
              {!balanced && <span className="ml-2">(Unbalanced)</span>}
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !balanced || !description.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Post Entry
            </button>
          </div>
        </div>
      )}

      {refusal ? null : entries.length === 0 ? (
        <EmptyState icon={BookOpen} title="No journal entries yet" description="Manual adjustments, accruals, and corrections appear here." />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-border/40 bg-card/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">{entry.description}</span>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(entry.date).toLocaleDateString()}</span>
              </div>
              {entry.reference && <p className="text-xs text-muted-foreground">Ref: {entry.reference}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {entry.entries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-lg bg-background/60 px-2 py-1.5">
                    <span className="truncate">{e.account.name}</span>
                    <span className="tabular-nums font-medium">
                      {e.debit > 0 ? `Dr ${formatCurrency(e.debit, entry.currency || currency)}` : `Cr ${formatCurrency(e.credit, entry.currency || currency)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
