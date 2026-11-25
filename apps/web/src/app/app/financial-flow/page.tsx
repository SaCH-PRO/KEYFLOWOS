"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Banknote, Wallet, Receipt, FileText, Landmark, ShieldCheck, ArrowRight, TrendingUp, PiggyBank, Plus, Trash2, Loader2, BookOpen, Scale, ListFilter, Repeat, FileMinus, CalendarDays, Package, Globe, Cable, PackageCheck, Truck, ClipboardList, Send, Bell, AlertCircle, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { FlowQuickLauncher } from "@/components/layout/flow-quick-launcher";
import type { ModuleLauncherSection } from "@/components/ui/module-launcher-sheet";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionCard } from "@/components/ui/section-card";
import { apiGet } from "@/lib/api";
import { fetchReserveBuckets, createReserveBucket, deleteReserveBucket, type ReserveBucket } from "@/lib/api/finance";
import { fetchRoleFlowQueue, resolveFlowSignal, type FlowSignal } from "@/lib/api/flow-signal";
import { apiPost } from "@/lib/api";
import { moduleReadRefusal, moduleWriteRefusal } from "@/lib/module-access";
import { discardRun, listRuns, type PayrollRunListItem } from "@/lib/api/payroll";
import { formatCurrency } from "@/lib/currency";
import { memberModuleLevelsOf, type ModuleLevels } from "@/lib/nav-config";

interface FinancialOverview {
  cashBalance: number;
  outstandingInvoices: number;
  overdueInvoices: number;
  billsDue: number;
  taxReserved: number;
  netProfitThisMonth: number;
  currency: string;
}

interface SafeToSpend {
  safeToSpend: number;
  cashBalance: number;
  taxReserved: number;
  billsDueNext30Days: number;
  payrollReserved?: number;
  debtPaymentsDue?: number;
  operatingBuffer: number;
  otherReserves?: number;
  currency: string;
  explanation?: string[];
}

/**
 * V1-65 (SWP-FIN-OVERVIEW-TRUTH; D-144): the runs safe-to-spend reserves are the DRAFT and APPROVED ones
 * (SafeToSpendService), never PAID or VOID. Read with operations read (GET payroll runs); a refusal is said as one.
 */
type ReservingRuns = { runs: PayrollRunListItem[] } | { refusal: string } | { error: string };

const RESERVING_STATUSES = ["DRAFT", "APPROVED"] as const;

async function readReservingRuns(businessId: string): Promise<ReservingRuns> {
  const answers = await Promise.all(RESERVING_STATUSES.map((status) => listRuns(businessId, { status, limit: 100 })));
  for (const res of answers) {
    const refusal = moduleReadRefusal(res, "operations", "the payroll runs");
    if (refusal) return { refusal };
    if (res.error) return { error: res.error };
  }
  const runs = answers
    .flatMap((res) => (Array.isArray(res.data) ? res.data : []))
    .filter((run) => (RESERVING_STATUSES as readonly string[]).includes(run.status))
    .sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart)));
  return { runs };
}

/** A currency code as the server compares it (posting.service normalizeCurrency): trimmed, upper case. */
const currencyCode = (code: string | null | undefined) => (typeof code === "string" ? code.trim().toUpperCase() : "");

/** A run's period as the server's discard record names it: the two ISO dates, never shifted by the viewer's zone. */
const runPeriod = (run: PayrollRunListItem) => `${String(run.periodStart).slice(0, 10)} to ${String(run.periodEnd).slice(0, 10)}`;

const runStatusLabel = (status: string) => (status === "DRAFT" ? "Draft" : status === "APPROVED" ? "Approved" : status);

export default function FinancialFlowPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [safe, setSafe] = useState<SafeToSpend | null>(null);
  const [forecast, setForecast] = useState<{ days: number; expected: number; conservative: number; optimistic: number; dangerDate: string | null; recommendations: string[] } | null>(null);
  const [buckets, setBuckets] = useState<ReserveBucket[]>([]);
  // PR195-KEY-GATES review repair (CRR-P195KG-1): GET reserves needs revenue read (D-146); a refusal is said in the
  // reserves card, never as "No reserve buckets yet".
  const [bucketsRefusal, setBucketsRefusal] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newCurrent, setNewCurrent] = useState("");
  const [saving, setSaving] = useState(false);
  // V1-65: what a refused bucket write said (the server kept what it had; so does the page).
  const [reserveError, setReserveError] = useState<string | null>(null);

  // V1-65 (D-144): the payroll runs safe-to-spend reserves, the member's module levels (Discard needs operations
  // write), and the Discard dialog.
  const [reservingRuns, setReservingRuns] = useState<ReservingRuns | null>(null);
  const [moduleLevels, setModuleLevels] = useState<ModuleLevels>(null);
  const [discardTarget, setDiscardTarget] = useState<PayrollRunListItem | null>(null);
  const [discardReason, setDiscardReason] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [discardNotice, setDiscardNotice] = useState<string | null>(null);
  // The latest read wins: an older answer landing after a newer one never overwrites it.
  const safeSeq = useRef(0);
  const runsSeq = useRef(0);

  // KEY FLOWS: AR Clerk proof-of-concept queue
  const [roleKey] = useState("ACCOUNTS_RECEIVABLE_CLERK");
  const [signals, setSignals] = useState<FlowSignal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  // SWP-CENSUS-HIDDEN review repair (COR-HID-1): what the queue says when the reminder or the clear is refused. The
  // api client answers a refusal as { data: null, error, status } and does not throw.
  const [queueError, setQueueError] = useState<string | null>(null);

  const loadSignals = useCallback(async () => {
    if (!businessId || !roleKey) return;
    setSignalsLoading(true);
    try {
      const res = await fetchRoleFlowQueue(businessId, roleKey);
      if (res.data) setSignals(res.data.items);
    } finally {
      setSignalsLoading(false);
    }
  }, [businessId, roleKey]);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  const handleSendReminder = async (signal: FlowSignal) => {
    if (!businessId) return;
    const invoiceId = signal.payload?.invoiceId as string | undefined;
    if (!invoiceId) return;
    setActingId(signal.id);
    setQueueError(null);
    try {
      const sent = await apiPost({ path: `/commerce/businesses/${businessId}/invoices/${invoiceId}/send-reminder`, body: {} });
      const notSent = moduleWriteRefusal(sent, "revenue", "send invoice reminders");
      if (notSent) {
        // Nothing went out: the item stays, and is not cleared.
        setQueueError(notSent);
        return;
      }
      const cleared = await resolveFlowSignal(businessId, signal.id);
      const notCleared = moduleWriteRefusal(cleared, "revenue", "clear items from this queue");
      // The reminder went out: say so, so it is not sent again from the item that stays.
      if (notCleared) setQueueError(`The reminder was sent, but this item could not be cleared. ${notCleared}`);
      await loadSignals();
    } finally {
      setActingId(null);
    }
  };

  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const loadReservingRuns = useCallback(async () => {
    if (!businessId) return;
    const seq = ++runsSeq.current;
    let next: ReservingRuns;
    try {
      next = await readReservingRuns(businessId);
    } catch {
      next = { error: "The payroll runs could not be read." };
    }
    if (seq === runsSeq.current) setReservingRuns(next);
  }, [businessId]);

  /**
   * V1-65: read safe-to-spend again after a change that moves it (a reserve bucket added or deleted, a payroll run
   * discarded), so the figure shown is the server's after the change. A failed read is said in the load banner and
   * no figure from before the change is kept as if current.
   */
  const refreshSafeToSpend = useCallback(async () => {
    if (!businessId) return;
    const seq = ++safeSeq.current;
    const res = await apiGet<SafeToSpend>(`/finance/businesses/${businessId}/safe-to-spend`);
    if (seq !== safeSeq.current) return;
    if (res.data) {
      setSafe(res.data);
      setLoadErrors((prev) => prev.filter((label) => label !== "Safe-to-spend"));
    } else {
      setSafe(null);
      setLoadErrors((prev) => (prev.includes("Safe-to-spend") ? prev : [...prev, "Safe-to-spend"]));
    }
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    let disposed = false;
    // NAV-A1's read of the member's own module levels (GET identity/businesses/:b/my-access). Unknown (a failed
    // read) offers no Discard: it is destructive, and only a member the server states holds operations write gets it.
    void apiGet(`/identity/businesses/${encodeURIComponent(businessId)}/my-access`)
      .then((res) => (res.error ? null : memberModuleLevelsOf(res.data)))
      .catch(() => null)
      .then((levels) => {
        if (!disposed) setModuleLevels(levels);
      });
    return () => {
      disposed = true;
    };
  }, [businessId]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadErrors([]);
    void loadReservingRuns();
    const safeLoad = ++safeSeq.current;
    // Each call races a 12s timeout and all settle independently — one slow or
    // failing endpoint must never hang the whole page (audit P0).
    const withTimeout = <T,>(p: Promise<{ data: T | null; error: string | null }>, label: string) =>
      Promise.race([
        p,
        new Promise<{ data: null; error: string }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: `${label} timed out` }), 12_000),
        ),
      ]).then((r) => ({ ...r, label }));
    try {
      const [ovRes, safeRes, fcRes, bucketRes] = await Promise.all([
        withTimeout(apiGet<FinancialOverview>(`/finance/businesses/${businessId}/overview`), 'Overview'),
        withTimeout(apiGet<SafeToSpend>(`/finance/businesses/${businessId}/safe-to-spend`), 'Safe-to-spend'),
        withTimeout(apiGet<NonNullable<typeof forecast>>(`/finance/businesses/${businessId}/cashflow-forecast?days=90`), 'Forecast'),
        withTimeout(
          // An error answer is an error, never an empty list (CRR-P195KG-1): the refusal reaches the reserves card.
          fetchReserveBuckets(businessId).then(
            (r) => ({ error: r.error, status: r.status, data: r.error ? null : (r.data?.items ?? []) }) as { error: string | null; status?: number; data: ReserveBucket[] | null },
          ),
          'Reserve buckets',
        ),
      ]);
      const failed: string[] = [];
      if (ovRes.data) setOverview(ovRes.data); else failed.push(ovRes.label);
      if (safeLoad === safeSeq.current) {
        if (safeRes.data) setSafe(safeRes.data); else failed.push(safeRes.label);
      }
      if (fcRes.data) setForecast(fcRes.data); else failed.push(fcRes.label);
      const refusal = moduleReadRefusal(bucketRes, "revenue", "the reserve buckets");
      setBucketsRefusal(refusal);
      if (bucketRes.data) setBuckets(bucketRes.data);
      else {
        setBuckets([]);
        if (!refusal) failed.push(bucketRes.label);
      }
      if (failed.length > 0) setLoadErrors(failed);
    } catch {
      setLoadErrors(['financial data']);
    } finally {
      setLoading(false);
    }
  }, [businessId, loadReservingRuns]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!businessId || !newName.trim()) return;
    setSaving(true);
    setReserveError(null);
    try {
      const res = await createReserveBucket(businessId, {
        name: newName.trim(),
        purpose: newPurpose.trim() || "General reserve",
        targetAmount: newTarget ? Number(newTarget) : undefined,
        currentAmount: newCurrent ? Number(newCurrent) : 0,
      });
      const notAdded = moduleWriteRefusal(res, "revenue", "add reserve buckets");
      if (notAdded) {
        setReserveError(`The bucket was not added. ${notAdded}`);
        return;
      }
      if (res.data) {
        setBuckets((prev) => [...prev, res.data!]);
        setNewName("");
        setNewPurpose("");
        setNewTarget("");
        setNewCurrent("");
        setShowAdd(false);
      }
      // V1-65: an active bucket is subtracted from Safe to Spend; read the figure again.
      await refreshSafeToSpend();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    setReserveError(null);
    const res = await deleteReserveBucket(businessId, id);
    const notDeleted = moduleWriteRefusal(res, "revenue", "delete reserve buckets");
    if (notDeleted) {
      // The server kept the bucket: so does the page, and its figure is unchanged.
      setReserveError(`The bucket was not deleted. ${notDeleted}`);
      return;
    }
    setBuckets((prev) => prev.filter((b) => b.id !== id));
    await refreshSafeToSpend();
  };

  const openDiscard = (run: PayrollRunListItem) => {
    setDiscardTarget(run);
    setDiscardReason("");
    setDiscardError(null);
    setDiscardNotice(null);
  };

  const closeDiscard = () => {
    if (discarding) return;
    setDiscardTarget(null);
    setDiscardError(null);
  };

  /**
   * V1-65 (TOF-PAYROLL-DISCARD, D-144): discard the run with the member's reason, after the confirm. The server is the
   * judge: its refusal (409 for a run paid, posted or approved in the business currency since this page read it; 403
   * without operations write) is said in its own words and nothing is claimed. After a discard, and after a 409 (the
   * run is not what this page last read), the runs and safe-to-spend are read again, so the page shows what the
   * server now holds.
   */
  const confirmDiscard = async () => {
    const run = discardTarget;
    const reason = discardReason.trim();
    if (!businessId || !run || !reason || discarding) return;
    setDiscarding(true);
    setDiscardError(null);
    try {
      const res = await discardRun(businessId, run.id, reason);
      const notDiscarded = moduleWriteRefusal(res, "operations", "discard payroll runs");
      if (notDiscarded) {
        setDiscardError(`The run was not discarded: ${notDiscarded}`);
        if (res.status === 409) await Promise.all([refreshSafeToSpend(), loadReservingRuns()]);
        return;
      }
      setDiscardTarget(null);
      setDiscardNotice(`The payroll run ${runPeriod(run)} was discarded: Safe to Spend no longer reserves it.`);
      await Promise.all([refreshSafeToSpend(), loadReservingRuns()]);
    } finally {
      setDiscarding(false);
    }
  };

  const currency = overview?.currency ?? "TTD";

  // V1-65 (D-144): the payroll reserve line. Money is shown only with the safe-to-spend read, which needs revenue
  // read (D-100): a member refused it sees no line and no run amount.
  const businessCurrency = currencyCode(safe?.currency) || currencyCode(currency);
  const payrollReserved = Number(safe?.payrollReserved ?? 0);
  const listedRuns = reservingRuns && "runs" in reservingRuns ? reservingRuns.runs : [];
  const showPayrollReserve = Boolean(safe) && (payrollReserved > 0 || listedRuns.length > 0);
  const operationsLevel = moduleLevels?.operations;
  const mayDiscard = operationsLevel === "write" || operationsLevel === "admin";
  const runCurrency = (run: PayrollRunListItem) => currencyCode(run.currency) || businessCurrency;
  // Where PayrollService.discardRun accepts a run: DRAFT, or APPROVED in a currency other than the business's. (A
  // posted run is refused 409, and said so; the list does not tell a posted run apart.)
  const serverWouldDiscard = (run: PayrollRunListItem) =>
    run.status === "DRAFT" || (run.status === "APPROVED" && runCurrency(run) !== businessCurrency);

  const launcherSections: ModuleLauncherSection[] = [
    {
      id: "money",
      label: "Money",
      items: [
        { id: "revenue", label: "Revenue", icon: Receipt, href: "/app/commerce", tone: "orange" },
        { id: "expenses", label: "Expenses", icon: Wallet, href: "/app/expenses", tone: "gold" },
        { id: "ledger", label: "Ledger", icon: BookOpen, href: "/app/finance/ledger", tone: "teal" },
        { id: "journal", label: "Journal", icon: BookOpen, href: "/app/finance/journal", tone: "sky" },
        { id: "reports", label: "Reports", icon: FileText, href: "/app/finance/reports", tone: "violet" },
      ],
    },
    {
      id: "operations",
      label: "Operations",
      items: [
        { id: "bank-rules", label: "Bank Rules", icon: ListFilter, href: "/app/finance/bank-rules", tone: "default" },
        { id: "recurring", label: "Recurring", icon: Repeat, href: "/app/finance/recurring-journals", tone: "mint" },
        { id: "assets", label: "Fixed Assets", icon: Package, href: "/app/finance/fixed-assets", tone: "sky" },
        { id: "connect", label: "Bank Connect", icon: Cable, href: "/app/key-connect?tab=banking", tone: "primary" },
      ],
    },
  ];

  const sections = [
    { label: "Money In", href: "/app/commerce", icon: Receipt, desc: "Invoices, quotes, payments" },
    { label: "Money Out", href: "/app/expenses", icon: Wallet, desc: "Expenses, bills, vendors" },
    { label: "Accounts", href: "/app/finance/settings#accounts", icon: Landmark, desc: "Bank, cash, reconciliation" },
    { label: "Reports", href: "/app/finance/reports", icon: FileText, desc: "P&L, balance sheet, tax" },
    { label: "General Ledger", href: "/app/finance/ledger", icon: BookOpen, desc: "Detailed transaction history" },
    { label: "Journal Entries", href: "/app/finance/journal", icon: BookOpen, desc: "Post manual double-entry journals" },
    { label: "Trial Balance", href: "/app/finance/trial-balance", icon: Scale, desc: "Account balances summary" },
    { label: "Bank Rules", href: "/app/finance/bank-rules", icon: ListFilter, desc: "Auto-categorize transactions" },
    { label: "Recurring Journals", href: "/app/finance/recurring-journals", icon: Repeat, desc: "Scheduled journal entries" },
    { label: "Credit Notes", href: "/app/finance/credit-notes", icon: FileMinus, desc: "Issue credit memos" },
    { label: "Accounting Periods", href: "/app/finance/accounting-periods", icon: CalendarDays, desc: "Close monthly books" },
    { label: "Fixed Assets", href: "/app/finance/fixed-assets", icon: Package, desc: "Asset register & depreciation" },
    { label: "Exchange Rates", href: "/app/finance/exchange-rates", icon: Globe, desc: "Multi-currency rates" },
    { label: "Bank Connections", href: "/app/key-connect?tab=banking", icon: Cable, desc: "Link bank feeds" },
    { label: "Goods Receipts", href: "/app/continental-ops/goods-receipts", icon: PackageCheck, desc: "Receive inventory" },
    { label: "Delivery Notes", href: "/app/continental-ops/delivery-notes", icon: Truck, desc: "Authorize goods release" },
    { label: "Receipts", href: "/app/continental-ops/receipts", icon: Receipt, desc: "Payment receipts" },
    { label: "Stock Counts", href: "/app/continental-ops/stock-counts", icon: ClipboardList, desc: "Physical inventory audit" },
  ];

  return (
    <UnifiedPageShell
      title="Financial Flow"
      subtitle="Cash, reserves, and forecasting."
      icon={Banknote}
      maxWidth="5xl"
      headerActions={
        <FlowQuickLauncher
          title="Financial Modules"
          subtitle="Money, operations, and reporting"
          sections={launcherSections}
        />
      }
    >
      {loadErrors.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span>Some data failed to load: {loadErrors.join(', ')}. Showing what we have.</span>
          <button type="button" onClick={() => load()} className="shrink-0 rounded-lg border border-amber-400/40 px-3 py-1 text-xs font-medium hover:bg-amber-500/20">
            Retry
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="kf-card-metric animate-pulse h-20" />)
        ) : (
          <>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}>
              <MetricCard label="Cash Balance" value={`${currency} ${(overview?.cashBalance ?? 0).toLocaleString()}`} icon={Wallet} />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, type: "spring", stiffness: 300, damping: 24 }}>
              <MetricCard label="Safe to Spend" value={`${currency} ${(safe?.safeToSpend ?? 0).toLocaleString()}`} icon={ShieldCheck} iconColor="#10b981" />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 24 }}>
              <MetricCard label="Overdue" value={`${currency} ${(overview?.overdueInvoices ?? 0).toLocaleString()}`} icon={Receipt} iconColor="#ef4444" />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 24 }}>
              <MetricCard label="Net Profit (MTD)" value={`${currency} ${(overview?.netProfitThisMonth ?? 0).toLocaleString()}`} icon={TrendingUp} />
            </motion.div>
          </>
        )}
      </div>

      {/* Safe-to-Spend Breakdown */}
      {safe && (
        <SectionCard title="Safe-to-Spend Breakdown" icon={ShieldCheck} compact>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-center">
            <div className="kf-card p-2.5">
              <p className="text-sm font-semibold">{currency} {(safe.cashBalance ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Cash Balance</p>
            </div>
            <div className="kf-card p-2.5">
              <p className="text-sm font-semibold text-amber-500">− {currency} {(safe.taxReserved ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Tax Reserved</p>
            </div>
            <div className="kf-card p-2.5">
              <p className="text-sm font-semibold text-amber-500">− {currency} {(safe.billsDueNext30Days ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Bills Due (30d)</p>
            </div>
            <div className="kf-card p-2.5">
              <p className="text-sm font-semibold text-amber-500">− {currency} {(safe.payrollReserved ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Committed Payroll</p>
            </div>
            <div className="kf-card p-2.5">
              <p className="text-sm font-semibold text-muted-foreground">− {currency} {(safe.operatingBuffer ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Operating Buffer</p>
            </div>
            <div className="kf-card p-2.5">
              <p className="text-sm font-semibold text-muted-foreground">− {currency} {(safe.otherReserves ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Other Reserves</p>
            </div>
            <div className="kf-card p-2.5 border-emerald-500/30">
              <p className="text-sm font-semibold text-emerald-500">{currency} {(safe.safeToSpend ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Safe to Spend</p>
            </div>
          </div>
          {showPayrollReserve && (
            <section aria-label="Payroll reserve" className="mx-4 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <p className="text-xs">
                <span className="font-medium">Payroll reserved:</span>{" "}
                <strong className="font-semibold">{formatCurrency(payrollReserved, businessCurrency)}</strong> is held back from
                Safe to Spend for payroll runs not yet paid (draft or approved).
              </p>
              {reservingRuns && "refusal" in reservingRuns && (
                <p className="text-xs text-amber-500" role="alert">{reservingRuns.refusal}</p>
              )}
              {reservingRuns && "error" in reservingRuns && (
                <p className="text-xs text-amber-500" role="alert">The runs could not be listed: {reservingRuns.error}</p>
              )}
              {listedRuns.length > 0 && (
                <ul className="space-y-1.5">
                  {listedRuns.map((run) => {
                    const code = runCurrency(run);
                    const label = runStatusLabel(run.status);
                    return (
                      <li key={run.id} className="flex flex-col gap-1.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                        <span className="min-w-0 break-words">
                          {label} run, {runPeriod(run)}: {formatCurrency(Number(run.totalGross ?? 0), code)}
                          {code !== businessCurrency && (
                            <span className="text-muted-foreground"> (in {code}: not counted in Safe to Spend, which is in {businessCurrency})</span>
                          )}
                        </span>
                        {mayDiscard && serverWouldDiscard(run) && (
                          <button
                            type="button"
                            onClick={() => openDiscard(run)}
                            aria-label={`Discard the ${label.toLowerCase()} payroll run ${runPeriod(run)}`}
                            className="inline-flex min-h-[36px] shrink-0 items-center gap-1 self-start rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 sm:self-auto"
                          >
                            <Trash2 className="h-3 w-3" />
                            Discard
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
          {discardNotice && (
            <p className="mx-4 mb-4 text-xs text-emerald-500" role="status">{discardNotice}</p>
          )}
        </SectionCard>
      )}

      {/* Cashflow Forecast */}
      {forecast && (
        <SectionCard title="90-Day Cash Forecast" icon={TrendingUp} compact>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              {forecast.dangerDate && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                  Danger: {new Date(forecast.dangerDate).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-lg font-semibold">{currency} {(forecast.expected ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">Expected</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold">{currency} {(forecast.conservative ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">Conservative</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold">{currency} {(forecast.optimistic ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">Optimistic</p>
              </div>
            </div>
            {forecast.recommendations && forecast.recommendations.length > 0 && (
              <div className="space-y-1">
                {forecast.recommendations.map((rec, i) => (
                  <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <TrendingUp className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                    {rec}
                  </p>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Cash Reserve Buckets */}
      <SectionCard
        title="Cash Reserve Buckets"
        icon={PiggyBank}
        compact
        headerRight={
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            <Plus className="w-3 h-3" />
            {showAdd ? "Cancel" : "Add bucket"}
          </button>
        }
      >
        <div className="p-3 space-y-2">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            <Plus className="w-3 h-3" />
            {showAdd ? "Cancel" : "Add bucket"}
          </button>
        </div>

        {showAdd && (
          <div className="kf-card p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Bucket name (e.g. Tax Reserve)"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={newPurpose}
                onChange={(e) => setNewPurpose(e.target.value)}
                placeholder="Purpose"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                placeholder="Target amount"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={newCurrent}
                onChange={(e) => setNewCurrent(e.target.value)}
                placeholder="Current amount"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create bucket
            </button>
          </div>
        )}

        {reserveError && (
          <p className="text-xs text-amber-500 py-2" role="alert">{reserveError}</p>
        )}

        {bucketsRefusal ? (
          <p className="text-xs text-amber-500 py-2" role="alert">{bucketsRefusal}</p>
        ) : buckets.length === 0 && !showAdd ? (
          <p className="text-xs text-muted-foreground py-2">No reserve buckets yet. Add one to track tax, payroll, or other cash allocations.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {buckets.map((bucket, i) => (
              <motion.div
                key={bucket.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="kf-card p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PiggyBank className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-sm font-medium">{bucket.name}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(bucket.id)}
                    aria-label={`Delete ${bucket.name}`}
                    className="text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">{bucket.purpose}</p>
                <div className="flex items-end justify-between">
                  <span className="text-sm font-semibold">{bucket.currency} {bucket.currentAmount.toLocaleString()}</span>
                  {bucket.targetAmount && (
                    <span className="text-[10px] text-muted-foreground">
                      of {bucket.currency} {bucket.targetAmount.toLocaleString()} target
                    </span>
                  )}
                </div>
                {bucket.targetAmount && bucket.targetAmount > 0 && (
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-emerald-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (bucket.currentAmount / bucket.targetAmount) * 100)}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {sections.map((s) => (
          <button
            key={s.label}
            onClick={() => router.push(s.href)}
            className="kf-card kf-radius-lg p-4 text-left hover:shadow-md transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 kf-radius-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                  <s.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{s.label}</h3>
                  <p className="kf-text-micro text-muted-foreground">{s.desc}</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </button>
        ))}
      </div>

      {/* KEY FLOWS — AR Clerk proof-of-concept queue */}
      <SectionCard title="AR Clerk Queue" icon={Bell} compact>
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Showing signals for role: <span className="font-medium text-foreground">{roleKey.replace(/_/g, " ")}</span>
            </p>
            <button
              onClick={() => loadSignals()}
              disabled={signalsLoading}
              className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50"
              style={{ color: "hsl(var(--kf-accent1))" }}
            >
              {signalsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
              Refresh
            </button>
          </div>

          {queueError && (
            <p className="text-xs text-amber-500" role="alert">
              {queueError}
            </p>
          )}

          {signalsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 kf-card animate-pulse" />
              ))}
            </div>
          ) : signals.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              No overdue invoices requiring AR clerk attention.
            </div>
          ) : (
            <div className="space-y-2">
              {signals.map((signal) => (
                <div
                  key={signal.id}
                  className="kf-card p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <AlertCircle
                        className={`w-4 h-4 ${signal.importance === "CRITICAL" ? "text-red-500" : "text-amber-500"}`}
                      />
                      <h4 className="text-sm font-medium truncate">{signal.title}</h4>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {signal.flows.join(" + ")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{signal.summary}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(signal.occurredAt).toLocaleDateString()} · {signal.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/app/commerce/invoices/${signal.payload?.invoiceId}`)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium border hover:bg-muted transition-colors"
                      style={{ borderColor: "hsl(var(--kf-border))" }}
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleSendReminder(signal)}
                      disabled={actingId === signal.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {actingId === signal.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      Remind
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      {discardTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payroll-discard-title"
          aria-describedby="payroll-discard-desc"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeDiscard} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border/60 bg-slate-900/95 p-5 shadow-2xl backdrop-blur-xl space-y-3">
            <h3 id="payroll-discard-title" className="text-base font-semibold">Discard payroll run?</h3>
            <p id="payroll-discard-desc" className="text-sm text-muted-foreground">
              The {runStatusLabel(discardTarget.status).toLowerCase()} run {runPeriod(discardTarget)} (
              {formatCurrency(Number(discardTarget.totalGross ?? 0), runCurrency(discardTarget))}) becomes VOID and is no
              longer reserved. This cannot be undone.
            </p>
            <label className="block space-y-1 text-xs">
              <span className="font-medium">Reason (required)</span>
              <textarea
                value={discardReason}
                onChange={(e) => setDiscardReason(e.target.value)}
                maxLength={500}
                rows={3}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
                placeholder="Why is this run being discarded?"
              />
            </label>
            {discardError && (
              <p className="text-xs text-amber-500" role="alert">{discardError}</p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDiscard}
                disabled={discarding}
                className="min-h-[40px] rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDiscard}
                disabled={discarding || !discardReason.trim()}
                aria-busy={discarding || undefined}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {discarding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Discard run
              </button>
            </div>
          </div>
        </div>
      )}
    </UnifiedPageShell>
  );
}
