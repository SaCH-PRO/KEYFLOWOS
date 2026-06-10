"use client";

import { useEffect, useState, useCallback } from "react";
import { Scale, Loader2 } from "lucide-react";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchTrialBalance, type TrialBalanceRow } from "@/lib/api/finance";

export default function TrialBalancePage() {
  const businessId = getStoredBusinessId() ?? "";
  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [asOf, setAsOf] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchTrialBalance(businessId, asOf || undefined);
      if (res.data) setRows(res.data);
    } finally {
      setLoading(false);
    }
  }, [businessId, asOf]);

  useEffect(() => {
    load();
  }, [load]);

  const totalDebit = rows.reduce((s, r) => s + (r.debit || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (r.credit || 0), 0);

  return (
    <UnifiedPageShell
      title="Trial Balance"
      subtitle="Aggregated debits and credits by account."
      icon={Scale}
      maxWidth="5xl"
    >
      <div className="space-y-4">
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

        <div className="grid grid-cols-3 gap-3">
          <div className="kf-card p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Debits</p>
            <p className="text-sm font-semibold text-emerald-600">{totalDebit.toLocaleString()}</p>
          </div>
          <div className="kf-card p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Credits</p>
            <p className="text-sm font-semibold text-red-500">{totalCredit.toLocaleString()}</p>
          </div>
          <div className="kf-card p-3 text-center">
            <p className="text-xs text-muted-foreground">Difference</p>
            <p className={`text-sm font-semibold ${Math.abs(totalDebit - totalCredit) < 0.01 ? "text-emerald-600" : "text-red-500"}`}>
              {(totalDebit - totalCredit).toLocaleString()}
            </p>
          </div>
        </div>

        <DataTable
          data={rows as unknown as Record<string, unknown>[]}
          keyField="accountId"
          pageSize={50}
          columns={[
            { key: "accountCode", header: "Code", sortable: true, getValue: (r) => (r as unknown as TrialBalanceRow).accountCode ?? "—" },
            { key: "accountName", header: "Account", sortable: true, getValue: (r) => (r as unknown as TrialBalanceRow).accountName },
            { key: "accountType", header: "Type", sortable: true, getValue: (r) => (r as unknown as TrialBalanceRow).accountType },
            { key: "debit", header: "Debit", sortable: true, render: (r) => {
              const v = (r as unknown as TrialBalanceRow).debit;
              return v > 0 ? <span className="text-xs font-medium">{v.toLocaleString()}</span> : <span className="text-xs">—</span>;
            }},
            { key: "credit", header: "Credit", sortable: true, render: (r) => {
              const v = (r as unknown as TrialBalanceRow).credit;
              return v > 0 ? <span className="text-xs font-medium">{v.toLocaleString()}</span> : <span className="text-xs">—</span>;
            }},
            { key: "netBalance", header: "Net", sortable: true, render: (r) => {
              const v = (r as unknown as TrialBalanceRow).netBalance;
              return <span className={`text-xs font-semibold ${v >= 0 ? "text-emerald-600" : "text-red-500"}`}>{v.toLocaleString()}</span>;
            }},
          ]}
          emptyMessage="No trial balance data found."
        />
      </div>
    </UnifiedPageShell>
  );
}
