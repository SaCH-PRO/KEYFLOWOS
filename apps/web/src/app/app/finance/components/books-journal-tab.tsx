"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Save,
  BookOpen,
  Loader2,
  ArrowRightLeft,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { formatCurrency } from "@/lib/currency";
import {
  fetchJournalEntries,
  createJournalEntry,
  fetchFinanceCoa,
  fetchFinanceAccounts,
  fetchFinanceSettings,
  fetchExchangeRates,
  type JournalEntryRow,
  type ChartOfAccountRow,
  type FinancialAccountRow,
  type ExchangeRateItem,
} from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";

interface JournalFormLine {
  accountId: string;
  financialAccountId: string;
  debit: string;
  credit: string;
  memo: string;
}

export function hasConfiguredExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  rates: ExchangeRateItem[],
): boolean {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (!from || !to || from === to) return true;
  for (const r of rates) {
    const rFrom = String(r.fromCurrency ?? "").trim().toUpperCase();
    const rTo = String(r.toCurrency ?? "").trim().toUpperCase();
    const rateNum = Number(r.rate);
    if (!Number.isFinite(rateNum) || rateNum <= 0) continue;
    if ((rFrom === from && rTo === to) || (rFrom === to && rTo === from)) {
      return true;
    }
  }
  return false;
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
  const [financialAccounts, setFinancialAccounts] = useState<FinancialAccountRow[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateItem[]>([]);
  const [businessCurrency, setBusinessCurrency] = useState<string>("TTD");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [currency, setCurrency] = useState<string>("");
  const [lines, setLines] = useState<JournalFormLine[]>([
    { accountId: "", financialAccountId: "", debit: "", credit: "", memo: "" },
    { accountId: "", financialAccountId: "", debit: "", credit: "", memo: "" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    const [eRes, aRes, faRes, settingsRes, fxRes] = await Promise.all([
      fetchJournalEntries(businessId),
      fetchFinanceCoa(businessId),
      fetchFinanceAccounts(businessId).catch(() => ({ data: null, error: null })),
      fetchFinanceSettings(businessId).catch(() => ({ data: null, error: null })),
      fetchExchangeRates(businessId).catch(() => ({ data: null, error: null })),
    ]);
    if (Array.isArray(eRes.data?.items)) setEntries(eRes.data.items);
    if (Array.isArray(aRes.data?.items)) setAccounts(aRes.data.items);
    const faItems: FinancialAccountRow[] = Array.isArray(faRes.data?.items)
      ? faRes.data.items
      : [];
    setFinancialAccounts(faItems);

    const rawRates: ExchangeRateItem[] = Array.isArray(fxRes.data)
      ? fxRes.data
      : Array.isArray((fxRes.data as { items?: ExchangeRateItem[] } | null)?.items)
        ? (fxRes.data as { items: ExchangeRateItem[] }).items
        : [];
    setExchangeRates(rawRates);

    const resolvedBizCurrency =
      (typeof settingsRes.data?.currency === "string" && settingsRes.data.currency.trim()) ||
      faItems.find((fa: FinancialAccountRow) => fa.isActive !== false && fa.currency)?.currency ||
      (Array.isArray(eRes.data?.items) && eRes.data.items[0]?.currency) ||
      "TTD";
    const normalizedBizCurrency = resolvedBizCurrency.trim().toUpperCase();
    setBusinessCurrency(normalizedBizCurrency);
    setCurrency((prev) => prev || normalizedBizCurrency);
    setLoading(false);
  }, [businessId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const effectiveCurrency = (currency || businessCurrency || "TTD").trim().toUpperCase();

  const linkedFinancialAccountsByCoa = useMemo(() => {
    const map = new Map<string, FinancialAccountRow[]>();
    for (const fa of financialAccounts) {
      if (fa.isActive === false || !fa.chartOfAccountId) continue;
      const list = map.get(fa.chartOfAccountId) ?? [];
      list.push(fa);
      map.set(fa.chartOfAccountId, list);
    }
    return map;
  }, [financialAccounts]);

  const supportedCurrencies = useMemo(() => {
    const set = new Set<string>([businessCurrency]);
    for (const r of exchangeRates) {
      const from = String(r.fromCurrency ?? "").trim().toUpperCase();
      const to = String(r.toCurrency ?? "").trim().toUpperCase();
      if (from === businessCurrency && to) set.add(to);
      if (to === businessCurrency && from) set.add(from);
    }
    for (const fa of financialAccounts) {
      if (fa.isActive !== false && fa.currency) {
        const faCurr = fa.currency.trim().toUpperCase();
        if (hasConfiguredExchangeRate(faCurr, businessCurrency, exchangeRates)) {
          set.add(faCurr);
        }
      }
    }
    return Array.from(set);
  }, [businessCurrency, exchangeRates, financialAccounts]);

  const totalDebit = useMemo(
    () => lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0),
    [lines],
  );
  const totalCredit = useMemo(
    () => lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0),
    [lines],
  );
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001;

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { accountId: "", financialAccountId: "", debit: "", credit: "", memo: "" },
    ]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<JournalFormLine>) =>
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        if (patch.accountId !== undefined && patch.financialAccountId === undefined) {
          const linked = linkedFinancialAccountsByCoa.get(patch.accountId) ?? [];
          next.financialAccountId = linked.length === 1 ? linked[0].id : "";
        }
        return next;
      }),
    );

  const handleSave = async () => {
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!balanced) { toast.error("Debits must equal credits"); return; }
    const activeLines = lines.filter((l) => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    if (activeLines.length < 2) { toast.error("At least 2 lines required"); return; }

    if (!/^[A-Z]{3}$/.test(effectiveCurrency)) {
      toast.error(`Invalid currency code: ${effectiveCurrency}`);
      return;
    }
    if (
      effectiveCurrency !== businessCurrency &&
      !hasConfiguredExchangeRate(effectiveCurrency, businessCurrency, exchangeRates)
    ) {
      toast.error(
        `No configured exchange rate for ${effectiveCurrency} to ${businessCurrency}`,
      );
      return;
    }

    for (const l of activeLines) {
      const linked = linkedFinancialAccountsByCoa.get(l.accountId) ?? [];
      if (linked.length > 1 && !l.financialAccountId) {
        toast.error(
          "Select the specific financial account for shared cash/bank ledger accounts",
        );
        return;
      }
      if (l.financialAccountId && !linked.some((fa) => fa.id === l.financialAccountId)) {
        toast.error(
          "Selected financial account does not match the chosen chart of account",
        );
        return;
      }
    }

    setSaving(true);
    const res = await createJournalEntry(businessId, {
      date,
      description: description.trim(),
      reference: reference.trim() || undefined,
      currency: effectiveCurrency,
      entries: activeLines.map((l) => {
        const linked = linkedFinancialAccountsByCoa.get(l.accountId) ?? [];
        const resolvedFinancialAccountId =
          l.financialAccountId || (linked.length === 1 ? linked[0].id : undefined);
        return {
          accountId: l.accountId,
          ...(resolvedFinancialAccountId ? { financialAccountId: resolvedFinancialAccountId } : {}),
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          memo: l.memo.trim() || undefined,
        };
      }),
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
    setCurrency(businessCurrency);
    setLines([
      { accountId: "", financialAccountId: "", debit: "", credit: "", memo: "" },
      { accountId: "", financialAccountId: "", debit: "", credit: "", memo: "" },
    ]);
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
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80"
        >
          <Plus className="w-3.5 h-3.5" /> {showForm ? "Cancel" : "New Entry"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] font-medium uppercase text-muted-foreground">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] font-medium uppercase text-muted-foreground">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Adjust prepaid insurance" className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase text-muted-foreground">Currency</label>
              <select
                aria-label="Journal currency"
                value={effectiveCurrency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
              >
                {supportedCurrencies.map((curr) => (
                  <option key={curr} value={curr}>
                    {curr}{curr === businessCurrency ? " (Base)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase text-muted-foreground">Reference #</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional journal reference" className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" />
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_100px_100px_1fr_auto] gap-2 text-[10px] font-medium uppercase text-muted-foreground">
              <span>Account</span>
              <span>Debit</span>
              <span>Credit</span>
              <span>Memo</span>
              <span />
            </div>
            {lines.map((line, i) => {
              const linkedAccounts = line.accountId
                ? (linkedFinancialAccountsByCoa.get(line.accountId) ?? [])
                : [];
              return (
                <div key={i} className="space-y-1">
                  <div className="grid grid-cols-[1fr_100px_100px_1fr_auto] gap-2 items-center">
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
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.debit}
                      onChange={(e) => updateLine(i, { debit: e.target.value, credit: "" })}
                      placeholder="0.00"
                      className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm tabular-nums"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.credit}
                      onChange={(e) => updateLine(i, { credit: e.target.value, debit: "" })}
                      placeholder="0.00"
                      className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm tabular-nums"
                    />
                    <input
                      value={line.memo}
                      onChange={(e) => updateLine(i, { memo: e.target.value })}
                      placeholder="Memo"
                      className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
                    />
                    <button onClick={() => removeLine(i)} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {linkedAccounts.length > 1 && (
                    <div className="pl-2">
                      <select
                        aria-label={`Line ${i + 1} financial account`}
                        value={line.financialAccountId}
                        onChange={(e) => updateLine(i, { financialAccountId: e.target.value })}
                        className="w-full sm:w-80 rounded-lg border border-amber-500/50 bg-background px-2 py-1 text-xs"
                      >
                        <option value="">Select financial account (required)…</option>
                        {linkedAccounts.map((fa) => (
                          <option key={fa.id} value={fa.id}>
                            {fa.name} ({fa.currency})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {linkedAccounts.length === 1 && (
                    <div className="pl-2 text-[11px] text-muted-foreground">
                      Financial account: {linkedAccounts[0].name} ({linkedAccounts[0].currency})
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={addLine} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Plus className="w-3 h-3" /> Add line
            </button>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/30">
            <div className={`text-xs font-medium ${balanced ? "text-emerald-500" : "text-rose-500"}`}>
              <span className="tabular-nums">Debits: {formatCurrency(totalDebit, effectiveCurrency)}</span>
              <span className="mx-2">·</span>
              <span className="tabular-nums">Credits: {formatCurrency(totalCredit, effectiveCurrency)}</span>
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

      {entries.length === 0 ? (
        <EmptyState icon={BookOpen} title="No journal entries yet" description="Manual adjustments, accruals, and corrections appear here." />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const entryRowCurrency = (entry.currency || businessCurrency || "TTD").trim().toUpperCase();
            return (
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
                  {entry.entries.map((e) => {
                    const lineCurrency = (e.currency || entryRowCurrency).trim().toUpperCase();
                    return (
                      <div key={e.id} className="flex items-center justify-between rounded-lg bg-background/60 px-2 py-1.5">
                        <span className="truncate">{e.account.name}</span>
                        <span className="tabular-nums font-medium">
                          {e.debit > 0
                            ? `Dr ${formatCurrency(e.debit, lineCurrency)}`
                            : `Cr ${formatCurrency(e.credit, lineCurrency)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
