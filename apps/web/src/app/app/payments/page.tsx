"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CreditCard, Plus, RefreshCcw, ExternalLink, Trash2, AlertCircle, Search, Receipt, Copy, Plug, RotateCcw } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/currency";
import {
  fetchPaymentsGateways,
  fetchPaymentsTransactions,
  fetchPaymentsLinks,
  createPaymentsLink,
  revokePaymentsLink,
  refundPaymentsCharge,
  fetchBusinessPayments,
  listInvoicePayments,
  refundPayment,
  type BusinessPayment,
  type PaymentsGatewayId,
  type PaymentsGatewayStatus,
  type PaymentsTransaction,
  type PaymentsLink,
} from "@/lib/client";
import { isManualPayment, manualRefundableAmount, manualRefundQuestion, moneyOf, MANUAL_REFUND_CHECKING } from "@/lib/manual-refund";
import { getStoredBusinessId } from "@/lib/workspace";

type TabKey = "transactions" | "links" | "refunds";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "transactions", label: "Recent activity", icon: Receipt },
  { key: "links", label: "Payment links", icon: ExternalLink },
  { key: "refunds", label: "Refunds", icon: RefreshCcw },
];

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function providerBadge(p: string) {
  const colors: Record<string, string> = {
    stripe: "bg-violet-100 text-violet-800",
    paypal: "bg-blue-100 text-blue-800",
    wipay: "bg-emerald-100 text-emerald-800",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colors[p] ?? "bg-gray-100 text-gray-700"}`}>
      {p}
    </span>
  );
}

export default function PaymentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as TabKey | null;
  const txParam = searchParams.get("tx");
  const qParam = searchParams.get("q");
  const activeTab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "transactions";

  const [businessId, setBusinessId] = useState<string | null>(null);
  useEffect(() => { const bid = getStoredBusinessId(); if (bid) setBusinessId(bid); }, []);
  const [gateways, setGateways] = useState<PaymentsGatewayStatus[]>([]);
  const [transactions, setTransactions] = useState<PaymentsTransaction[]>([]);
  const [links, setLinks] = useState<PaymentsLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState(qParam ?? "");
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState<PaymentsTransaction | null>(null);
  // SWP-INV-REFUND-UI (BUG-049, D-169): the business's own payment rows (GET /commerce/businesses/:id/payments,
  // revenue read), for the payments recorded by hand; why they could not be read (no amount is shown then, D-100);
  // the one being refunded with the whole amount its confirm names; the refund in flight; the last refusal in the
  // server's words; and whether the server refused this member refunds (403).
  const [recorded, setRecorded] = useState<BusinessPayment[]>([]);
  const [recordedError, setRecordedError] = useState<string | null>(null);
  // amount null: the dialog is open and the invoice's latest figures are being read (its confirm waits for them).
  const [refundTarget, setRefundTarget] = useState<{ payment: BusinessPayment; amount: number | null } | null>(null);
  // Review MINOR-5: each Refund press takes a lookup number; only the latest press's read opens its amount.
  const refundLookupRef = useRef(0);
  const [refunding, setRefunding] = useState(false);
  const refundingRef = useRef(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundForbidden, setRefundForbidden] = useState(false);

  const setActiveTab = useCallback(
    (k: string) => router.replace(`/app/payments?tab=${k}`, { scroll: false }),
    [router],
  );

  const loadAll = useCallback(async () => {
    if (!businessId) return;
    setRefreshing(true);
    try {
      const [g, t, l] = await Promise.all([
        fetchPaymentsGateways(businessId),
        fetchPaymentsTransactions(businessId, { limit: 50, q: search || undefined }),
        fetchPaymentsLinks(businessId),
      ]);
      if (g.error) toast.error(`Gateways: ${g.error}`);
      if (t.error) toast.error(`Transactions: ${t.error}`);
      if (l.error) toast.error(`Payment links: ${l.error}`);
      setGateways(g.data ?? []);
      setTransactions(t.data ?? []);
      setLinks(l.data ?? []);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [businessId, search]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // SWP-INV-REFUND-UI review MINOR-5 (repair round 1): the payments recorded by hand are read on their own, not with
  // the gateway activity, so a search keystroke (which reads the activity again) does not read them again.
  const loadRecorded = useCallback(async () => {
    if (!businessId) return;
    const r = await fetchBusinessPayments(businessId);
    setRecorded(r.data ?? []);
    setRecordedError(r.data ? null : r.error ?? "The payments could not be read");
  }, [businessId]);

  useEffect(() => {
    void loadRecorded();
  }, [loadRecorded]);

  const refreshAll = useCallback(() => {
    void loadAll();
    void loadRecorded();
  }, [loadAll, loadRecorded]);

  useEffect(() => {
    if (txParam && transactions.length) {
      const found = transactions.find((t) => t.id === txParam);
      if (found) setSelectedTx(found);
    }
  }, [txParam, transactions]);

  // SWP-INV-REFUND-UI (BUG-049; refund ruling D-169: whole-payment refunds only). A payment recorded by hand is
  // refunded through POST /commerce/businesses/:id/payments/:paymentId/refund (revenue write; no provider is called).
  // Refund first reads that invoice's payments (the server's rows and net received now) and names the whole amount
  // the server will refund (manualRefundableAmount, its reading); nothing is sent until it is confirmed, and a second
  // press while it is in flight sends nothing. Only the server's answer is reported: its refund row's amount on
  // success, after which the payments are read again; a refusal in the server's words (a 403 also withdraws Refund).
  const openRefund = async (p: BusinessPayment) => {
    if (!businessId || refundingRef.current) return;
    const lookup = ++refundLookupRef.current;
    setRefundError(null);
    setRefundTarget({ payment: p, amount: null });
    const { data, error } = await listInvoicePayments(businessId, p.invoiceId);
    // Review MINOR-5: a press made after this one owns the dialog; Cancel drops this read too.
    if (lookup !== refundLookupRef.current) return;
    if (!data) {
      setRefundTarget(null);
      setRefundError(error ?? "The invoice's payments could not be read");
      return;
    }
    const current = data.payments.find((row) => row.id === p.id);
    const amount = current && isManualPayment(current) ? manualRefundableAmount(current, data.payments, data.paidAmount) : 0;
    if (!(amount > 0)) {
      setRefundTarget(null);
      setRefundError("Nothing is left to refund on this payment.");
      void loadRecorded();
      return;
    }
    setRefundTarget({ payment: p, amount });
  };

  const handleRefund = async () => {
    const target = refundTarget;
    if (!businessId || !target || target.amount === null || refundingRef.current) return;
    refundingRef.current = true;
    setRefunding(true);
    setRefundError(null);
    try {
      const { data, error, status } = await refundPayment(businessId, target.payment.id);
      setRefundTarget(null);
      if (!error && data) {
        toast.success(`Refunded ${formatCurrency(Math.abs(Number(data.amount)), data.currency || target.payment.currency)}`, {
          description: "Recorded in KeyFlow. Give the money back to the customer yourself: nothing was sent to them.",
        });
        await loadRecorded();
        return;
      }
      const message = error ?? "The refund was not recorded.";
      setRefundError(message);
      toast.error("Not refunded", { description: message });
      if (status === 403) setRefundForbidden(true);
      else await loadRecorded();
    } finally {
      refundingRef.current = false;
      setRefunding(false);
    }
  };

  const disconnectedGateways = useMemo(() => gateways.filter((g) => !g.connected), [gateways]);

  const refunds = useMemo(() => transactions.filter((t) => t.type === "refund"), [transactions]);

  const totalTtd = useMemo(
    () => transactions.filter((t) => t.type === "charge" && t.status === "succeeded" || t.status === "successful")
      .reduce((sum, t) => sum + (t.amountTtd ?? 0), 0),
    [transactions],
  );

  return (
    <WorkspaceShell
      icon={CreditCard}
      title="Payments"
      subtitle="Unified view of charges, links, and refunds across Stripe, PayPal, and WiPay"
      tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      actionLabel={activeTab === "links" ? "New payment link" : activeTab === "refunds" ? "Issue refund" : "Refresh"}
      actionIcon={activeTab === "links" ? Plus : activeTab === "refunds" ? RefreshCcw : RefreshCcw}
      onAction={() => {
        if (activeTab === "links") setShowLinkModal(true);
        else if (activeTab === "refunds") setShowRefundModal(true);
        else refreshAll();
      }}
      headerRight={
        <div className="flex items-center gap-2 text-xs">
          {gateways.map((g) =>
            g.connected ? (
              <span
                key={g.id}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-800"
                title="Connected"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {g.name}
              </span>
            ) : (
              <Link
                key={g.id}
                href="/app/key-connect"
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-800 hover:bg-amber-100"
                title={`Connect ${g.name}`}
              >
                <Plug className="h-3 w-3" /> Connect {g.name}
              </Link>
            ),
          )}
        </div>
      }
    >
      {disconnectedGateways.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertCircle className="h-4 w-4" />
          <span>
            {disconnectedGateways.map((g) => g.name).join(", ")} not connected — activity from {disconnectedGateways.length === 1 ? "this provider" : "these providers"} won&apos;t appear.
          </span>
          <Link href="/app/key-connect" className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-amber-800 hover:bg-amber-100">
            <Plug className="h-3 w-3" /> Open Connect
          </Link>
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-gray-500">Loading payments…</div>
      ) : activeTab === "transactions" ? (
        <div className="space-y-6">
          <TransactionsTab
            transactions={transactions}
            totalTtd={totalTtd}
            search={search}
            setSearch={setSearch}
            onRefresh={refreshAll}
            refreshing={refreshing}
            onSelect={setSelectedTx}
          />
          <RecordedPayments
            payments={recorded}
            readError={recordedError}
            refundError={refundError}
            onDismissError={() => setRefundError(null)}
            canRefund={!refundForbidden}
            refunding={refunding}
            onRefund={(p) => void openRefund(p)}
          />
        </div>
      ) : activeTab === "links" ? (
        <LinksTab
          links={links}
          gateways={gateways}
          onRevoke={async (link) => {
            if (!businessId) return;
            if (!confirm(`Revoke this payment link?`)) return;
            const res = await revokePaymentsLink(businessId, link.provider, link.id);
            if (res.error) toast.error(res.error);
            else {
              toast.success("Link revoked");
              loadAll();
            }
          }}
        />
      ) : (
        <RefundsTab refunds={refunds} onIssue={() => setShowRefundModal(true)} />
      )}

      {showLinkModal && (
        <PaymentLinkModal
          gateways={gateways.filter((g) => g.connected && g.supports.paymentLinks)}
          onClose={() => setShowLinkModal(false)}
          onCreate={async (body) => {
            if (!businessId) return false;
            const res = await createPaymentsLink(businessId, body);
            if (res.error) {
              toast.error(res.error);
              return false;
            }
            toast.success("Payment link created");
            setShowLinkModal(false);
            loadAll();
            return true;
          }}
        />
      )}

      {showRefundModal && (
        <RefundModal
          transactions={transactions.filter((t) => t.type === "charge")}
          gateways={gateways.filter((g) => g.connected && g.supports.refunds)}
          onClose={() => setShowRefundModal(false)}
          onSubmit={async (body) => {
            if (!businessId) return false;
            const res = await refundPaymentsCharge(businessId, body);
            if (res.error) {
              toast.error(res.error);
              return false;
            }
            toast.success("Refund issued");
            setShowRefundModal(false);
            loadAll();
            return true;
          }}
        />
      )}

      {selectedTx && <TransactionDrawer tx={selectedTx} onClose={() => setSelectedTx(null)} />}

      {/* SWP-INV-REFUND-UI (D-169): the whole payment, no amount field. */}
      <ConfirmDialog
        open={refundTarget !== null}
        title="Refund this payment?"
        message={refundTarget?.amount != null ? manualRefundQuestion({
          refund: formatCurrency(refundTarget.amount, refundTarget.payment.currency),
          paid: formatCurrency(moneyOf(refundTarget.payment.amount), refundTarget.payment.currency),
          whole: moneyOf(refundTarget.amount) === moneyOf(refundTarget.payment.amount),
          method: refundTarget.payment.method ?? refundTarget.payment.provider,
          on: `${new Date(refundTarget.payment.createdAt).toLocaleDateString()}${refundTarget.payment.invoice?.invoiceNumber ? ` for invoice ${refundTarget.payment.invoice.invoiceNumber}` : ""}`,
        }) : MANUAL_REFUND_CHECKING}
        confirmLabel={refundTarget?.amount != null ? `Refund ${formatCurrency(refundTarget.amount, refundTarget.payment.currency)}` : "Refund"}
        variant="danger"
        busy={refunding || refundTarget?.amount == null}
        onCancel={() => { if (!refundingRef.current) { refundLookupRef.current++; setRefundTarget(null); } }}
        onConfirm={() => void handleRefund()}
      />
    </WorkspaceShell>
  );
}

function TransactionsTab({
  transactions,
  totalTtd,
  search,
  setSearch,
  onRefresh,
  refreshing,
  onSelect,
}: {
  transactions: PaymentsTransaction[];
  totalTtd: number;
  search: string;
  setSearch: (v: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onSelect: (tx: PaymentsTransaction) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by id, customer, amount, invoice…"
            className="w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
          />
        </div>
        <div className="text-sm text-gray-600">
          Total received (TTD): <span className="font-semibold text-gray-900">{formatMoney(totalTtd, "TTD")}</span>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {transactions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No transactions yet"
          description="Connect a payment gateway in Connect to see activity here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
<table className="min-w-full w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">TTD</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((t) => (
                <tr key={`${t.provider}-${t.id}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">{providerBadge(t.provider)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{t.customerName ?? "—"}</div>
                    <div className="text-xs text-gray-500">{t.customerEmail ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {t.description ?? "—"}
                    {t.invoiceId && (
                      <Link href={`/app/commerce/invoices/${encodeURIComponent(t.invoiceId)}`} className="ml-2 text-xs text-violet-600 hover:underline">
                        Invoice
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    <span className={t.type === "refund" ? "text-rose-600" : "text-gray-900"}>
                      {formatMoney(t.amount, t.currency)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {t.amountTtd != null ? formatMoney(t.amountTtd, "TTD") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {t.externalUrl && (
                        <a
                          href={t.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-violet-700"
                          title={`Open in ${t.provider}`}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <button
                        onClick={() => onSelect(t)}
                        className="text-xs text-violet-600 hover:underline"
                      >
                        Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        </div>
      )}
    </div>
  );
}

/**
 * SWP-INV-REFUND-UI (BUG-049): the payments recorded by hand on the business's invoices (cash, bank transfer, a
 * mark-paid row; never a gateway charge, which the activity above and its gateway refund cover), newest first, each
 * with its invoice, its amount in its own currency and Refund while something of it is left; one with nothing left
 * says Refunded. When the payments cannot be read (D-100: no revenue read), it says so and shows no amount.
 */
function RecordedPayments({
  payments,
  readError,
  refundError,
  onDismissError,
  canRefund,
  refunding,
  onRefund,
}: {
  payments: BusinessPayment[];
  readError: string | null;
  refundError: string | null;
  onDismissError: () => void;
  canRefund: boolean;
  refunding: boolean;
  onRefund: (p: BusinessPayment) => void;
}) {
  const manual = payments.filter(isManualPayment);
  return (
    <section aria-labelledby="recorded-payments-heading" className="space-y-3">
      <div>
        <h2 id="recorded-payments-heading" className="text-sm font-semibold text-gray-900">Payments recorded by hand</h2>
        <p className="text-xs text-gray-500">Cash, bank transfer and other payments recorded on an invoice. A refund here is recorded in KeyFlow: you give the money back.</p>
      </div>
      {refundError && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span>Not refunded: {refundError}</span>
          <button onClick={onDismissError} className="shrink-0 text-xs font-medium underline">Dismiss</button>
        </div>
      )}
      {readError ? (
        <p className="text-sm text-gray-600">Payments recorded by hand could not be read: {readError}</p>
      ) : manual.length === 0 ? (
        <p className="text-sm text-gray-500">No payments recorded by hand yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {manual.map((p) => {
            const rows = payments.filter((row) => row.invoiceId === p.invoiceId);
            const refunded = manualRefundableAmount(p, rows, Infinity) <= 0;
            const contact = p.invoice?.contact;
            const customer = contact ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.email || null : null;
            return (
              <li key={p.id} data-testid="recorded-payment-row" data-payment-id={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900">{formatCurrency(Number(p.amount), p.currency)}</div>
                  <div className="text-xs text-gray-500">
                    {[p.method || p.provider, new Date(p.createdAt).toLocaleDateString(), customer].filter(Boolean).join(" · ")}
                    {p.invoice?.invoiceNumber ? ` · Invoice ${p.invoice.invoiceNumber}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {refunded ? (
                    <span className="text-xs font-medium text-gray-500">Refunded</span>
                  ) : canRefund ? (
                    <button
                      onClick={() => onRefund(p)}
                      disabled={refunding}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" /> Refund
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LinksTab({
  links,
  gateways,
  onRevoke,
}: {
  links: PaymentsLink[];
  gateways: PaymentsGatewayStatus[];
  onRevoke: (link: PaymentsLink) => void;
}) {
  const noSupportedGateway = gateways.length === 0;
  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not copy link");
    }
  };
  return (
    <div className="space-y-4">
      {noSupportedGateway && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <div>No connected gateway supports payment links. Connect Stripe or PayPal to enable this feature.</div>
          </div>
          <Link href="/app/key-connect" className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs text-amber-800 hover:bg-amber-100">
            <Plug className="h-3 w-3" /> Open Connect
          </Link>
        </div>
      )}
      {gateways.some((g) => g.connected && g.id === "paypal") && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          PayPal one-off links can be created here, but PayPal&apos;s API does not return a list of previously created order links — only links created in this session or those tracked elsewhere will appear above. Manage older links from the PayPal dashboard.
        </div>
      )}
      {links.length === 0 ? (
        <EmptyState
          icon={ExternalLink}
          title="No payment links"
          description="Create a payment link to accept one-off payments without an invoice."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
<table className="min-w-full w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {links.map((l) => (
                <tr key={`${l.provider}-${l.id}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">{new Date(l.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{providerBadge(l.provider)}</td>
                  <td className="px-4 py-3 text-gray-700">{l.description}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(l.amount, l.currency)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline">
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        onClick={() => copyLink(l.url)}
                        className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-violet-700"
                        title="Copy link"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${l.active ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>
                      {l.active ? "Active" : "Revoked"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.active && (
                      <button
                        onClick={() => onRevoke(l)}
                        className="inline-flex items-center gap-1 text-xs text-rose-600 hover:underline"
                      >
                        <Trash2 className="h-3 w-3" /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        </div>
      )}
    </div>
  );
}

function RefundsTab({ refunds, onIssue }: { refunds: PaymentsTransaction[]; onIssue: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={onIssue}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700"
        >
          <RefreshCcw className="h-4 w-4" /> Issue refund
        </button>
      </div>
      {refunds.length === 0 ? (
        <EmptyState
          icon={RefreshCcw}
          title="No refunds yet"
          description="Use 'Issue refund' to refund a successful charge."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
<table className="min-w-full w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Refund id</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {refunds.map((r) => (
                <tr key={`${r.provider}-${r.id}`}>
                  <td className="px-4 py-3 text-gray-700">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">{providerBadge(r.provider)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.id}</td>
                  <td className="px-4 py-3 text-right font-medium text-rose-600">{formatMoney(r.amount, r.currency)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        </div>
      )}
    </div>
  );
}

function PaymentLinkModal({
  gateways,
  onClose,
  onCreate,
}: {
  gateways: PaymentsGatewayStatus[];
  onClose: () => void;
  onCreate: (body: { gateway: PaymentsGatewayId; amount: number; currency: string; description: string; customerEmail?: string }) => Promise<boolean>;
}) {
  const [gateway, setGateway] = useState<PaymentsGatewayId>(gateways[0]?.id ?? "stripe");
  const [amount, setAmount] = useState("0.00");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <Modal title="New payment link" onClose={onClose}>
      {gateways.length === 0 ? (
        <p className="text-sm text-gray-600">No connected gateway supports payment links.</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitting(true);
            await onCreate({
              gateway,
              amount: parseFloat(amount),
              currency,
              description,
              customerEmail: customerEmail || undefined,
            });
            setSubmitting(false);
          }}
          className="space-y-3"
        >
          <Field label="Gateway">
            <select value={gateway} onChange={(e) => setGateway(e.target.value as PaymentsGatewayId)} className="input">
              {gateways.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount">
              <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" required />
            </Field>
            <Field label="Currency">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
                {["USD", "TTD", "EUR", "GBP", "CAD"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" required placeholder="What is this for?" />
          </Field>
          <Field label="Customer email (optional)">
            <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className="input" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={submitting} className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50">
              {submitting ? "Creating…" : "Create link"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RefundModal({
  transactions,
  gateways,
  onClose,
  onSubmit,
}: {
  transactions: PaymentsTransaction[];
  gateways: PaymentsGatewayStatus[];
  onClose: () => void;
  onSubmit: (body: { gateway: PaymentsGatewayId; chargeId: string; amount?: number; reason?: string }) => Promise<boolean>;
}) {
  const refundable = transactions.filter((t) => gateways.some((g) => g.id === t.provider));
  const [searchTerm, setSearchTerm] = useState("");
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const matches = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return refundable.slice(0, 25);
    return refundable.filter((t) => {
      if (t.id.toLowerCase().includes(q)) return true;
      if (t.customerEmail?.toLowerCase().includes(q)) return true;
      if (t.customerName?.toLowerCase().includes(q)) return true;
      if (String(t.amount).includes(q)) return true;
      if (t.invoiceId?.toLowerCase().includes(q)) return true;
      return false;
    }).slice(0, 25);
  }, [searchTerm, refundable]);

  const selected = refundable.find((t) => t.id === chargeId) ?? null;

  return (
    <Modal title="Issue refund" onClose={onClose}>
      {refundable.length === 0 ? (
        <p className="text-sm text-gray-600">No refundable charges available from connected gateways.</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selected) {
              toast.error("Select a charge to refund");
              return;
            }
            setSubmitting(true);
            await onSubmit({
              gateway: selected.provider,
              chargeId: selected.id,
              amount: amount ? parseFloat(amount) : undefined,
              reason: reason || undefined,
            });
            setSubmitting(false);
          }}
          className="space-y-3"
        >
          <Field label="Find a charge to refund (id, email, customer, or amount)">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setChargeId(null); }}
                placeholder="ch_…, jane@acme.com, 49.99…"
                className="input pl-9"
                autoFocus
              />
            </div>
          </Field>
          {!selected && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
              {matches.length === 0 ? (
                <div className="p-3 text-xs text-gray-500">No matching charges.</div>
              ) : matches.map((t) => (
                <button
                  type="button"
                  key={`${t.provider}-${t.id}`}
                  onClick={() => setChargeId(t.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-violet-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {providerBadge(t.provider)}
                      <span className="truncate font-medium text-gray-900">{t.customerName ?? t.customerEmail ?? t.id}</span>
                    </div>
                    <div className="truncate text-[11px] text-gray-500">{t.id} · {new Date(t.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="shrink-0 font-semibold">{formatMoney(t.amount, t.currency)}</div>
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{selected.customerName ?? selected.customerEmail ?? selected.id}</div>
                  <div className="text-[11px] text-gray-600">{selected.provider.toUpperCase()} · {selected.id}</div>
                </div>
                <button type="button" onClick={() => setChargeId(null)} className="text-violet-700 hover:underline">Change</button>
              </div>
            </div>
          )}
          <Field label={`Refund amount (leave blank for full ${selected ? formatMoney(selected.amount, selected.currency) : ""})`}>
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          </Field>
          <Field label="Reason (optional)">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="Customer request, duplicate, fraud…" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={submitting || !selected} className="rounded-lg bg-rose-600 px-3 py-2 text-sm text-white hover:bg-rose-700 disabled:opacity-50">
              {submitting ? "Refunding…" : "Issue refund"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function TransactionDrawer({ tx, onClose }: { tx: PaymentsTransaction; onClose: () => void }) {
  return (
    <Modal title="Transaction details" onClose={onClose}>
      <dl className="space-y-2 text-sm">
        <Row label="ID"><span className="font-mono text-xs">{tx.id}</span></Row>
        <Row label="Provider">{providerBadge(tx.provider)}</Row>
        <Row label="Type">{tx.type}</Row>
        <Row label="Status">{tx.status}</Row>
        <Row label="Amount">{formatMoney(tx.amount, tx.currency)} {tx.amountTtd != null && <span className="text-gray-500"> ({formatMoney(tx.amountTtd, "TTD")})</span>}</Row>
        <Row label="Customer">{tx.customerName ?? "—"} <span className="text-gray-500">{tx.customerEmail ?? ""}</span></Row>
        <Row label="Description">{tx.description ?? "—"}</Row>
        <Row label="Created">{new Date(tx.createdAt).toLocaleString()}</Row>
        {tx.invoiceId && (
          <Row label="Invoice">
            <Link href={`/app/commerce/invoices/${encodeURIComponent(tx.invoiceId)}`} className="text-violet-600 hover:underline">
              {tx.invoiceId}
            </Link>
          </Row>
        )}
        {tx.externalUrl && (
          <Row label="External">
            <a href={tx.externalUrl} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">Open in {tx.provider}</a>
          </Row>
        )}
      </dl>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
      {children}
      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e5e7eb;
          background: white;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        :global(.input:focus) {
          outline: none;
          border-color: #a78bfa;
        }
      `}</style>
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 py-1.5">
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-right text-gray-900">{children}</dd>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
