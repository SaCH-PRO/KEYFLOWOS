"use client";

import { useEffect, useState, useCallback } from "react";
import { BookOpen, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchGeneralLedger, type GeneralLedgerRow } from "@/lib/api/finance";

export default function GeneralLedgerPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [rows, setRows] = useState<GeneralLedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGeneralLedger(businessId, {
        accountId: accountId || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        page,
        limit,
      });
      if (res.data) {
        setRows(res.data.rows);
        setTotal(res.data.total);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  }, [businessId, accountId, dateFrom, dateTo, page, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <UnifiedPageShell
      title="General Ledger"
      subtitle="Detailed transaction history with running balances."
      icon={BookOpen}
      maxWidth="6xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        )}
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={accountId}
            onChange={(e) => { setAccountId(e.target.value); setPage(1); }}
            placeholder="Account ID"
            className="px-3 py-1.5 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
            style={{ borderColor: "hsl(var(--kf-border))" }}
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="px-3 py-1.5 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
            style={{ borderColor: "hsl(var(--kf-border))" }}
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
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

        <DataTable
          data={rows as unknown as Record<string, unknown>[]}
          keyField="entryId"
          pageSize={limit}
          columns={[
            { key: "date", header: "Date", sortable: true, getValue: (r) => new Date((r as unknown as GeneralLedgerRow).date).toLocaleDateString() },
            { key: "account", header: "Account", render: (r) => {
              const row = r as unknown as GeneralLedgerRow;
              return <span className="text-xs">{row.accountCode ? `${row.accountCode} — ` : ""}{row.accountName}</span>;
            }},
            { key: "reference", header: "Ref", getValue: (r) => (r as unknown as GeneralLedgerRow).reference ?? (r as unknown as GeneralLedgerRow).sourceType ?? "" },
            { key: "memo", header: "Memo", getValue: (r) => (r as unknown as GeneralLedgerRow).memo ?? (r as unknown as GeneralLedgerRow).description ?? "" },
            { key: "debit", header: "Debit", render: (r) => {
              const v = Number((r as unknown as GeneralLedgerRow).debit);
              return v > 0 ? <span className="text-xs font-medium text-emerald-600">{v.toLocaleString()}</span> : <span className="text-xs">—</span>;
            }},
            { key: "credit", header: "Credit", render: (r) => {
              const v = Number((r as unknown as GeneralLedgerRow).credit);
              return v > 0 ? <span className="text-xs font-medium text-red-500">{v.toLocaleString()}</span> : <span className="text-xs">—</span>;
            }},
            { key: "runningBalance", header: "Balance", render: (r) => {
              const v = Number((r as unknown as GeneralLedgerRow).runningBalance);
              return <span className="text-xs font-semibold">{v.toLocaleString()}</span>;
            }},
          ]}
          emptyMessage="No ledger entries found."
        />

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {total} entries — Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </UnifiedPageShell>
  );
}
