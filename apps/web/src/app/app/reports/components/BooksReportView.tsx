"use client";

import { useEffect, useState } from "react";
import { Loader2, Download, FileText } from "lucide-react";
import {
  fetchLedgerPnl, fetchLedgerCashflow, fetchLedgerBalanceSheet,
  fetchLedgerTaxSummary, fetchLedgerArAging, fetchLedgerApAging,
  ledgerReportExportUrl,
  type LedgerReportBasis,
  type LedgerPnlReport, type LedgerCashflowReport, type LedgerBalanceSheet,
  type LedgerTaxSummary, type LedgerArAging, type LedgerApAging,
} from "@/lib/client";
import { formatCurrency } from "./report-types";

export type BooksReportKind =
  | "books-pnl" | "books-cashflow" | "books-balance-sheet"
  | "books-ar-aging" | "books-ap-aging" | "books-tax";

interface Props {
  businessId: string | null;
  kind: BooksReportKind;
  startDate?: string;
  endDate?: string;
  asOf?: string;
}

const REPORT_KEY: Record<BooksReportKind, "pnl" | "cashflow" | "balance-sheet" | "ar-aging" | "ap-aging" | "tax-summary"> = {
  "books-pnl": "pnl",
  "books-cashflow": "cashflow",
  "books-balance-sheet": "balance-sheet",
  "books-ar-aging": "ar-aging",
  "books-ap-aging": "ap-aging",
  "books-tax": "tax-summary",
};

export function BooksReportView({ businessId, kind, startDate, endDate, asOf }: Props) {
  const [basis, setBasis] = useState<LedgerReportBasis>("accrual");
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (!businessId) return;
        let res;
        switch (kind) {
          case "books-pnl":
            res = await fetchLedgerPnl(businessId, startDate, endDate, basis); break;
          case "books-cashflow":
            res = await fetchLedgerCashflow(businessId, startDate, endDate, basis); break;
          case "books-balance-sheet":
            res = await fetchLedgerBalanceSheet(businessId, asOf ?? endDate); break;
          case "books-ar-aging":
            res = await fetchLedgerArAging(businessId, asOf ?? endDate); break;
          case "books-ap-aging":
            res = await fetchLedgerApAging(businessId, asOf ?? endDate); break;
          case "books-tax":
            res = await fetchLedgerTaxSummary(businessId, startDate, endDate); break;
        }
        if (cancelled) return;
        if (res && "data" in res && res.data) setData(res.data);
        else if (res && "error" in res) setError((res as { error?: string }).error || "Failed to load report");
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [businessId, kind, startDate, endDate, asOf, basis]);

  const supportsBasis = kind === "books-pnl" || kind === "books-cashflow";
  const exportUrl = (format: "csv" | "pdf") => businessId
    ? ledgerReportExportUrl(businessId, REPORT_KEY[kind], format, {
        startDate, endDate, asOf: asOf ?? endDate, basis: supportsBasis ? basis : undefined,
      })
    : "#";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {supportsBasis && (
            <div className="inline-flex rounded-lg border overflow-hidden text-xs" style={{ borderColor: "hsl(var(--border))" }}>
              {(["accrual", "cash"] as LedgerReportBasis[]).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBasis(b)}
                  className={`px-3 py-1.5 capitalize ${basis === b ? "font-semibold" : ""}`}
                  style={basis === b
                    ? { background: "hsl(var(--kf-accent1) / 0.15)", color: "hsl(var(--kf-accent1))" }
                    : { background: "transparent", color: "hsl(var(--muted-foreground))" }}
                >
                  {b} basis
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a href={exportUrl("csv")} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:bg-muted/50" style={{ borderColor: "hsl(var(--border))" }}>
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
          <a href={exportUrl("pdf")} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:bg-muted/50" style={{ borderColor: "hsl(var(--border))" }}>
            <FileText className="w-3.5 h-3.5" /> PDF
          </a>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading ledger data…
        </div>
      )}
      {error && (
        <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "hsl(var(--kf-error) / 0.3)", background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
          {error}
        </div>
      )}

      {!loading && !error && data ? (
        <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
          {kind === "books-pnl" && <PnlBlock r={data as LedgerPnlReport} />}
          {kind === "books-cashflow" && <CashflowBlock r={data as LedgerCashflowReport} />}
          {kind === "books-balance-sheet" && <BalanceSheetBlock r={data as LedgerBalanceSheet} />}
          {kind === "books-ar-aging" && <ArAgingBlock r={data as LedgerArAging} />}
          {kind === "books-ap-aging" && <ApAgingBlock r={data as LedgerApAging} />}
          {kind === "books-tax" && <TaxBlock r={data as LedgerTaxSummary} />}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, amount, currency, bold }: { label: string; amount: number; currency: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${bold ? "font-semibold border-t pt-2 mt-2" : ""}`}>
      <span>{label}</span>
      <span>{formatCurrency(amount, currency)}</span>
    </div>
  );
}

function PnlBlock({ r }: { r: LedgerPnlReport }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="text-xs text-muted-foreground mb-2">{r.basis.toUpperCase()} basis · {new Date(r.period.from).toLocaleDateString()} – {new Date(r.period.to).toLocaleDateString()}</div>
      <Row label="Revenue" amount={r.revenue.total} currency={r.currency} />
      {r.discounts.total !== 0 && <Row label="Less: Discounts" amount={-r.discounts.total} currency={r.currency} />}
      <Row label="Cost of Goods Sold" amount={-r.cogs.total} currency={r.currency} />
      <Row label="Gross Profit" amount={r.grossProfit} currency={r.currency} bold />
      <Row label="Operating Expenses" amount={-r.operatingExpenses.total} currency={r.currency} />
      <Row label="Net Profit" amount={r.netProfit} currency={r.currency} bold />
    </div>
  );
}

function CashflowBlock({ r }: { r: LedgerCashflowReport }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="text-xs text-muted-foreground mb-2">{r.basis.toUpperCase()} basis · {new Date(r.period.from).toLocaleDateString()} – {new Date(r.period.to).toLocaleDateString()}</div>
      <Row label="Cash In" amount={r.cashIn} currency={r.currency} />
      <Row label="Cash Out" amount={-r.cashOut} currency={r.currency} />
      <Row label="Net Movement" amount={r.netMovement} currency={r.currency} bold />
      {r.basis === "accrual" && (
        <div className="mt-3 rounded-lg border p-2 text-xs space-y-1" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="font-semibold text-foreground">Indirect-method bridge</div>
          <Row label="Net income" amount={r.accrualAdjustments.netIncome} currency={r.currency} />
          <Row label="− Δ Accounts receivable" amount={-r.accrualAdjustments.arChange} currency={r.currency} />
          <Row label="+ Δ Accounts payable" amount={r.accrualAdjustments.apChange} currency={r.currency} />
          <Row label="+ Δ Tax payable" amount={r.accrualAdjustments.taxPayableChange} currency={r.currency} />
          <Row label="Cash from operations" amount={r.accrualAdjustments.cashFromOperations} currency={r.currency} bold />
        </div>
      )}
      <div className="mt-3 text-xs text-muted-foreground">By account</div>
      {r.byAccount.map((a) => (
        <div key={a.accountId} className="flex items-center justify-between py-1 text-xs">
          <span>{a.name}</span>
          <span>{formatCurrency(a.net, r.currency)}</span>
        </div>
      ))}
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border p-2" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="text-muted-foreground">Upcoming receivables</div>
          <div className="font-semibold">{formatCurrency(r.upcomingReceivables.total, r.currency)} <span className="text-muted-foreground font-normal">({r.upcomingReceivables.count})</span></div>
        </div>
        <div className="rounded-lg border p-2" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="text-muted-foreground">Upcoming payables</div>
          <div className="font-semibold">{formatCurrency(r.upcomingPayables.total, r.currency)} <span className="text-muted-foreground font-normal">({r.upcomingPayables.count})</span></div>
        </div>
      </div>
    </div>
  );
}

function BalanceSheetBlock({ r }: { r: LedgerBalanceSheet }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs text-muted-foreground mb-2">As of {new Date(r.asOf).toLocaleDateString()}</div>
      <div>
        <div className="font-semibold">Assets</div>
        {r.assets.lines.map((l) => <Row key={l.accountId} label={l.name} amount={l.amount} currency={r.currency} />)}
        <Row label="Total Assets" amount={r.assets.total} currency={r.currency} bold />
      </div>
      <div>
        <div className="font-semibold mt-3">Liabilities</div>
        {r.liabilities.lines.map((l) => <Row key={l.accountId} label={l.name} amount={l.amount} currency={r.currency} />)}
        <Row label="Total Liabilities" amount={r.liabilities.total} currency={r.currency} bold />
      </div>
      <div>
        <div className="font-semibold mt-3">Equity</div>
        {r.equity.lines.map((l) => <Row key={l.accountId} label={l.name} amount={l.amount} currency={r.currency} />)}
        <Row label="Period Net Income" amount={r.netEquityFromIncome} currency={r.currency} />
        <Row label="Total Equity (with retained)" amount={r.equity.total + r.netEquityFromIncome} currency={r.currency} bold />
      </div>
      <div className="mt-3 rounded-lg border p-2 text-xs" style={{ borderColor: r.identityHolds ? "hsl(var(--kf-success) / 0.4)" : "hsl(var(--kf-error) / 0.4)", background: r.identityHolds ? "hsl(var(--kf-success) / 0.08)" : "hsl(var(--kf-error) / 0.08)" }}>
        Accounting identity {r.identityHolds ? "holds" : `out of balance by ${formatCurrency(r.identityDelta, r.currency)}`}.
      </div>
    </div>
  );
}

function AgingTable({ headers, rows, currency }: { headers: string[]; rows: Array<Record<string, string | number>>; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr>{headers.map((h) => <th key={h} className="text-left py-1.5 px-2 font-medium text-muted-foreground">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
              {headers.map((h, j) => (
                <td key={h} className="py-1.5 px-2">{j === 0 ? row[h] : formatCurrency(Number(row[h] ?? 0), currency)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArAgingBlock({ r }: { r: LedgerArAging }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-muted-foreground">As of {new Date(r.asOf).toLocaleDateString()} · Total outstanding {formatCurrency(r.totalOutstanding, r.currency)} · Overdue {formatCurrency(r.totalOverdue, r.currency)}</div>
      <AgingTable
        headers={["Customer", "Current", "1-30", "31-60", "61-90", "90+", "Total"]}
        rows={r.customers.map((c) => ({
          Customer: c.contactName ?? "Unknown",
          Current: c.current, "1-30": c.d1to30, "31-60": c.d31to60, "61-90": c.d61to90, "90+": c.d90plus, Total: c.total,
        }))}
        currency={r.currency}
      />
    </div>
  );
}

function ApAgingBlock({ r }: { r: LedgerApAging }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-muted-foreground">As of {new Date(r.asOf).toLocaleDateString()} · Total payable {formatCurrency(r.total, r.currency)} ({r.count} bills)</div>
      <AgingTable
        headers={["Vendor", "Current", "1-30", "31-60", "61-90", "90+", "Total"]}
        rows={r.vendors.map((v) => ({
          Vendor: v.label,
          Current: v.current, "1-30": v.d1to30, "31-60": v.d31to60, "61-90": v.d61to90, "90+": v.d90plus, Total: v.total,
        }))}
        currency={r.currency}
      />
    </div>
  );
}

function TaxBlock({ r }: { r: LedgerTaxSummary }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs text-muted-foreground mb-2">{new Date(r.period.from).toLocaleDateString()} – {new Date(r.period.to).toLocaleDateString()}</div>
      <Row label="Taxable sales" amount={r.taxableSales} currency={r.currency} />
      <Row label="Tax collected on sales" amount={r.taxCollected} currency={r.currency} />
      <Row label="Tax paid on purchases" amount={r.taxPaidOnPurchases} currency={r.currency} />
      <Row label="Estimated tax due" amount={r.estimatedDue} currency={r.currency} bold />
      <div className="text-xs text-muted-foreground mt-2">
        Invoice-side tax: {formatCurrency(r.invoiceTaxes.taxAmount, r.currency)} on subtotal {formatCurrency(r.invoiceTaxes.subtotal, r.currency)}
        {Math.abs(r.invoiceTaxes.ledgerToInvoiceDelta) > 0.01 && (
          <span> · ledger vs invoices Δ {formatCurrency(r.invoiceTaxes.ledgerToInvoiceDelta, r.currency)}</span>
        )}
      </div>
      {r.liabilities.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground mt-3">Recorded tax liabilities</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {["Period", "Type", "Sales", "Collected", "Paid", "Due", "Status"].map((h) => (
                    <th key={h} className="text-left py-1.5 px-2 font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.liabilities.map((l) => (
                  <tr key={l.id} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                    <td className="py-1.5 px-2">{new Date(l.periodStart).toLocaleDateString()} – {new Date(l.periodEnd).toLocaleDateString()}</td>
                    <td className="py-1.5 px-2">{l.type}</td>
                    <td className="py-1.5 px-2">{formatCurrency(l.taxableSales, r.currency)}</td>
                    <td className="py-1.5 px-2">{formatCurrency(l.taxCollected, r.currency)}</td>
                    <td className="py-1.5 px-2">{formatCurrency(l.taxPaid, r.currency)}</td>
                    <td className="py-1.5 px-2">{formatCurrency(l.amountDue, r.currency)}</td>
                    <td className="py-1.5 px-2">{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
