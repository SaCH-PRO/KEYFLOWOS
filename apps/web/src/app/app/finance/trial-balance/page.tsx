"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Scale, Loader2 } from "lucide-react";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchTrialBalance, type TrialBalanceRow } from "@/lib/api/finance";

/**
 * V1-37b (V1-37 review ST-V37-3 / RV37-01): the server answers one row per
 * (account, currency), each carrying its currency. A row is keyed by both, so
 * an account that saw TTD and USD is two rows, and the totals are per
 * currency, each balancing on its own: debits and credits of two currencies
 * are never added into one figure.
 */
type CurrencyRow = TrialBalanceRow & { currency?: string; rowKey: string };

interface CurrencyTotals {
  currency: string;
  debitCents: number;
  creditCents: number;
}

/** A ledger amount (a decimal string) in integer cents, so totals carry no float residue. */
const toCents = (value: string | number | null | undefined) => Math.round(Number(value || 0) * 100);
const fromCents = (cents: number) => cents / 100;

export default function TrialBalancePage() {
  const businessId = getStoredBusinessId() ?? "";
  const [items, setItems] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTrialBalance(businessId, asOf || undefined);
      setItems(res.data?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trial balance");
    } finally {
      setLoading(false);
    }
  }, [businessId, asOf]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo<CurrencyRow[]>(
    () => items.map((r) => {
      const currency = (r as TrialBalanceRow & { currency?: string }).currency ?? "";
      return { ...r, currency, rowKey: `${r.accountId}:${currency}` };
    }),
    [items],
  );

  const totals = useMemo<CurrencyTotals[]>(() => {
    const byCurrency = new Map<string, CurrencyTotals>();
    for (const r of rows) {
      const currency = r.currency ?? "";
      const t = byCurrency.get(currency) ?? { currency, debitCents: 0, creditCents: 0 };
      t.debitCents += toCents(r.debit);
      t.creditCents += toCents(r.credit);
      byCurrency.set(currency, t);
    }
    return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }, [rows]);

  return (
    <UnifiedPageShell
      title="Trial Balance"
      subtitle="Aggregated debits and credits by account and currency."
      icon={Scale}
      maxWidth="5xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
            style={{ borderColor: "hsl(var(--kf-border))" }}
          />
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refresh"}
          </button>
        </div>

        {totals.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Each currency is totalled on its own and must balance on its own; amounts in different currencies are never added together.
          </p>
        )}
        {totals.map((t) => {
          const differenceCents = t.debitCents - t.creditCents;
          const balanced = differenceCents === 0;
          return (
            <div key={t.currency} data-testid={`trial-balance-totals-${t.currency}`} className="grid grid-cols-3 gap-3">
              <div className="kf-card p-3 text-center">
                <p className="text-xs text-muted-foreground">Total Debits{t.currency ? ` (${t.currency})` : ""}</p>
                <p data-testid="total-debits" className="text-sm font-semibold text-emerald-600">{fromCents(t.debitCents).toLocaleString()}</p>
              </div>
              <div className="kf-card p-3 text-center">
                <p className="text-xs text-muted-foreground">Total Credits{t.currency ? ` (${t.currency})` : ""}</p>
                <p data-testid="total-credits" className="text-sm font-semibold text-red-500">{fromCents(t.creditCents).toLocaleString()}</p>
              </div>
              <div className="kf-card p-3 text-center">
                <p className="text-xs text-muted-foreground">Difference</p>
                <p
                  data-testid="difference"
                  data-balanced={balanced ? "true" : "false"}
                  className={`text-sm font-semibold ${balanced ? "text-emerald-600" : "text-red-500"}`}
                >
                  {`${t.currency ? `${t.currency} ` : ""}${fromCents(differenceCents).toLocaleString()}`}
                </p>
              </div>
            </div>
          );
        })}

        <DataTable
          data={rows as unknown as Record<string, unknown>[]}
          keyField="rowKey"
          pageSize={50}
          columns={[
            { key: "systemKey", header: "Code", sortable: true, getValue: (r) => (r as unknown as CurrencyRow).systemKey ?? "—" },
            { key: "name", header: "Account", sortable: true, getValue: (r) => (r as unknown as CurrencyRow).name },
            { key: "type", header: "Type", sortable: true, getValue: (r) => (r as unknown as CurrencyRow).type },
            { key: "currency", header: "Currency", sortable: true, render: (r) => <span className="text-xs">{(r as unknown as CurrencyRow).currency || "—"}</span> },
            { key: "debit", header: "Debit", sortable: true, render: (r) => {
              const v = Number((r as unknown as CurrencyRow).debit);
              return v > 0 ? <span className="text-xs font-medium">{v.toLocaleString()}</span> : <span className="text-xs">—</span>;
            }},
            { key: "credit", header: "Credit", sortable: true, render: (r) => {
              const v = Number((r as unknown as CurrencyRow).credit);
              return v > 0 ? <span className="text-xs font-medium">{v.toLocaleString()}</span> : <span className="text-xs">—</span>;
            }},
            { key: "net", header: "Net", sortable: true, render: (r) => {
              const v = Number((r as unknown as CurrencyRow).net);
              return <span className={`text-xs font-semibold ${v >= 0 ? "text-emerald-600" : "text-red-500"}`}>{v.toLocaleString()}</span>;
            }},
          ]}
          emptyMessage="No trial balance data found."
        />
      </div>
    </UnifiedPageShell>
  );
}
