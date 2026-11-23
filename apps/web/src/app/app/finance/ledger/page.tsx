"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { BookOpen, Loader2, ChevronLeft, ChevronRight, ArrowRightLeft } from "lucide-react";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { DataTable } from "@/components/ui/data-table";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchGeneralLedger, fetchChartOfAccounts, type ChartOfAccount, type GeneralLedgerRow } from "@/lib/api/finance";
import { formatCurrency } from "@/lib/currency";
import { formatDateSafe } from "@/lib/date-safe";

/** V1-66 (SWP-FIN-LEDGER): the lines a page holds, sent to the server as `pageSize` (the parameter it reads). */
const PAGE_SIZE = 25;

/**
 * V1-66: a ledger amount in the line's own currency, two decimals ("TTD 1,250.50"). A line from a server that
 * names no currency reads as the amount alone: no currency is guessed for it.
 */
function money(value: string | number | null | undefined, currency: string | null | undefined): string {
  const amount = Number(value || 0);
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (code) return formatCurrency(amount, code);
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** An account as the ledger's lines name it: "1000 — Cash", or the name alone when it has no code. */
const accountLabel = (a: { code: string | null; name: string }) => (a.code ? `${a.code} — ${a.name}` : a.name);

export default function GeneralLedgerPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [rows, setRows] = useState<GeneralLedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      // The dates go as picked (YYYY-MM-DD): the server reads a date-only end date as that whole day.
      const res = await fetchGeneralLedger(businessId, {
        accountId: accountId || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (res.error) {
        // A refused or failed read says so; it is not an empty ledger.
        setRows([]);
        setTotal(0);
        setError(res.error);
      } else {
        setRows(res.data?.rows ?? []);
        setTotal(res.data?.total ?? 0);
      }
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  }, [businessId, accountId, dateFrom, dateTo, page]);

  useEffect(() => {
    load();
  }, [load]);

  // The accounts to pick from, by name. A list that cannot be read leaves "All accounts" only.
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchChartOfAccounts(businessId)
      .then((res) => {
        if (!cancelled) setAccounts(res.data?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const accountOptions = useMemo(
    () => [...accounts].sort((a, b) => accountLabel(a).localeCompare(accountLabel(b))),
    [accounts],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <UnifiedPageShell
      title="General Ledger"
      subtitle="Detailed transaction history with running balances."
      icon={BookOpen}
      maxWidth="6xl"
      headerActions={
        <Link
          href="/app/finance/journal"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--kf-accent1))] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          Journal Entries
        </Link>
      }
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
          <select
            aria-label="Account"
            value={accountId}
            onChange={(e) => { setAccountId(e.target.value); setPage(1); }}
            className="px-3 py-1.5 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
            style={{ borderColor: "hsl(var(--kf-border))" }}
          >
            <option value="">All accounts</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>{accountLabel(a)}</option>
            ))}
          </select>
          <input
            type="date"
            aria-label="From"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="px-3 py-1.5 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
            style={{ borderColor: "hsl(var(--kf-border))" }}
          />
          <input
            type="date"
            aria-label="To"
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

        {/* A refused or failed read shows its error above, not "No ledger entries found." */}
        {!error && <DataTable
          data={rows as unknown as Record<string, unknown>[]}
          keyField="entryId"
          pageSize={PAGE_SIZE}
          columns={[
            { key: "date", header: "Date", sortable: true,
              // Sorted by the ISO instant and searchable by it or by the date as shown ("Mar 10, 2026").
              getValue: (r) => `${(r as unknown as GeneralLedgerRow).date} ${formatDateSafe((r as unknown as GeneralLedgerRow).date)}`,
              render: (r) => <span className="text-xs">{formatDateSafe((r as unknown as GeneralLedgerRow).date)}</span> },
            { key: "account", header: "Account", render: (r) => {
              const row = r as unknown as GeneralLedgerRow;
              return <span className="text-xs">{row.accountCode ? `${row.accountCode} — ` : ""}{row.accountName}</span>;
            }},
            { key: "reference", header: "Ref", getValue: (r) => (r as unknown as GeneralLedgerRow).reference ?? (r as unknown as GeneralLedgerRow).sourceType ?? "" },
            { key: "memo", header: "Memo", getValue: (r) => (r as unknown as GeneralLedgerRow).memo ?? (r as unknown as GeneralLedgerRow).description ?? "" },
            { key: "debit", header: "Debit", render: (r) => {
              const row = r as unknown as GeneralLedgerRow;
              const v = Number(row.debit);
              return v > 0 ? <span className="text-xs font-medium text-emerald-600">{money(v, row.currency)}</span> : <span className="text-xs">—</span>;
            }},
            { key: "credit", header: "Credit", render: (r) => {
              const row = r as unknown as GeneralLedgerRow;
              const v = Number(row.credit);
              return v > 0 ? <span className="text-xs font-medium text-red-500">{money(v, row.currency)}</span> : <span className="text-xs">—</span>;
            }},
            { key: "runningBalance", header: "Balance", render: (r) => {
              const row = r as unknown as GeneralLedgerRow;
              return <span className="text-xs font-semibold">{money(row.runningBalance, row.currency)}</span>;
            }},
          ]}
          emptyMessage="No ledger entries found."
        />}

        {/* Pagination */}
        {!error && <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {total} entries — Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>}
      </div>
    </UnifiedPageShell>
  );
}
