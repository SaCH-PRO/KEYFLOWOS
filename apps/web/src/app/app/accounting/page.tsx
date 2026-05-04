"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, RefreshCw, Send, Users, BookOpen, Plug, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import {
  fetchAccountingSummary,
  fetchUnsyncedInvoices,
  pushInvoicesToAccounting,
  pushCustomersToAccounting,
  fetchChartOfAccounts,
  type AccountingSummary,
  type UnsyncedInvoiceRow,
  type ChartOfAccountsAccount,
  type AccountingProvider,
} from "@/lib/client";

const TABS = [
  { key: "invoices", label: "Invoices to push" },
  { key: "customers", label: "Customers" },
  { key: "accounts", label: "Chart of accounts" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const PROVIDER_LABEL: Record<AccountingProvider, string> = {
  quickbooks: "QuickBooks",
  xero: "Xero",
};

function contactName(c: UnsyncedInvoiceRow["contact"]) {
  if (!c) return "—";
  return (
    c.displayName ||
    [c.firstName, c.lastName].filter(Boolean).join(" ") ||
    c.companyName ||
    c.email ||
    "—"
  );
}

function formatMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

export default function AccountingPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("invoices");
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [invoices, setInvoices] = useState<UnsyncedInvoiceRow[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [accounts, setAccounts] = useState<ChartOfAccountsAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pushing, setPushing] = useState(false);
  const [pushingCustomers, setPushingCustomers] = useState(false);
  const [pushingRow, setPushingRow] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const fresh = await refreshWorkspace();
      const id = fresh ?? getStoredBusinessId();
      if (id) setBusinessId(id);
    })();
  }, []);

  const loadSummary = useCallback(async () => {
    if (!businessId) return;
    setSummaryLoading(true);
    const res = await fetchAccountingSummary(businessId);
    if (res.data) setSummary(res.data);
    setSummaryLoading(false);
  }, [businessId]);

  const loadInvoices = useCallback(async () => {
    if (!businessId) return;
    setInvoicesLoading(true);
    const res = await fetchUnsyncedInvoices(businessId, 100);
    setInvoices(res.data?.invoices ?? []);
    setSelected({});
    setInvoicesLoading(false);
  }, [businessId]);

  const loadAccounts = useCallback(async () => {
    if (!businessId) return;
    setAccountsLoading(true);
    setAccountsError(null);
    const res = await fetchChartOfAccounts(businessId);
    if (res.error) setAccountsError(res.error);
    else setAccounts(res.data?.accounts ?? []);
    setAccountsLoading(false);
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration of accounting summary
    void loadSummary();
  }, [businessId, loadSummary]);

  useEffect(() => {
    if (!businessId || !summary?.connected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration of tab data when active tab changes
    if (activeTab === "invoices") void loadInvoices();
    if (activeTab === "accounts") void loadAccounts();
  }, [businessId, activeTab, summary?.connected, loadInvoices, loadAccounts]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const allSelected = invoices.length > 0 && selectedIds.length === invoices.length;

  const toggleAll = () => {
    if (allSelected) setSelected({});
    else setSelected(Object.fromEntries(invoices.map((i) => [i.id, true])));
  };

  const handlePush = async () => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one invoice to push");
      return;
    }
    setPushing(true);
    const res = await pushInvoicesToAccounting(selectedIds, businessId ?? undefined);
    setPushing(false);
    if (res.error || !res.data) {
      toast.error(res.error || "Failed to push invoices");
      return;
    }
    const { succeeded, failed, provider } = res.data;
    if (failed === 0) toast.success(`Pushed ${succeeded} invoice(s) to ${PROVIDER_LABEL[provider]}`);
    else toast.warning(`${succeeded} pushed, ${failed} failed to ${PROVIDER_LABEL[provider]}`);
    void loadSummary();
    void loadInvoices();
  };

  const handlePushRow = async (id: string) => {
    setPushingRow(id);
    const res = await pushInvoicesToAccounting([id], businessId ?? undefined);
    setPushingRow(null);
    if (res.error || !res.data) {
      toast.error(res.error || "Failed to push invoice");
      return;
    }
    const { results, provider } = res.data;
    const r = results[0];
    if (r?.success) toast.success(`Pushed to ${PROVIDER_LABEL[provider]}`);
    else toast.error(r?.error || `Failed to push to ${PROVIDER_LABEL[provider]}`);
    void loadSummary();
    void loadInvoices();
  };

  const handlePushCustomers = async () => {
    setPushingCustomers(true);
    const res = await pushCustomersToAccounting(businessId ?? undefined);
    setPushingCustomers(false);
    if (res.error || !res.data) {
      toast.error(res.error || "Failed to push customers");
      return;
    }
    const { succeeded, failed, total, provider } = res.data;
    if (total === 0) toast.info("No customers to push");
    else if (failed === 0) toast.success(`Synced ${succeeded} customer(s) to ${PROVIDER_LABEL[provider]}`);
    else toast.warning(`${succeeded} synced, ${failed} failed to ${PROVIDER_LABEL[provider]}`);
    void loadSummary();
  };

  const connected = !!summary?.connected;
  const provider = summary?.provider ?? null;

  const statusHeader = (
    <div className="kf-card kf-radius-lg p-4 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 kf-radius-md flex items-center justify-center"
          style={{ background: connected ? "color-mix(in srgb, hsl(var(--kf-success)) 18%, transparent)" : "color-mix(in srgb, hsl(var(--kf-muted-foreground)) 14%, transparent)" }}
        >
          {connected ? (
            <CheckCircle2 className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
          ) : (
            <Plug className="w-5 h-5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
          )}
        </div>
        <div>
          <div className="text-sm font-medium kf-text-foreground">
            {connected && provider ? `Connected to ${PROVIDER_LABEL[provider]}` : "No accounting provider connected"}
          </div>
          <div className="text-xs kf-text-muted-foreground">
            {summary?.connectedAccount ? `Account: ${summary.connectedAccount}` : connected ? "Sync ready" : "Connect QuickBooks or Xero to push invoices and customers"}
            {summary?.lastSyncAt ? ` • Last sync ${new Date(summary.lastSyncAt).toLocaleString()}` : ""}
          </div>
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-6 text-xs kf-text-muted-foreground">
        <div>
          <div className="kf-text-foreground font-semibold text-sm">{summary?.invoicesSynced ?? 0}/{summary?.invoicesTotal ?? 0}</div>
          Invoices synced
        </div>
        <div>
          <div className="kf-text-foreground font-semibold text-sm">{summary?.customersSynced ?? 0}/{summary?.customersTotal ?? 0}</div>
          Customers synced
        </div>
        <button
          type="button"
          onClick={() => { void loadSummary(); if (activeTab === "invoices") void loadInvoices(); if (activeTab === "accounts") void loadAccounts(); }}
          className="kf-btn-secondary h-8 px-3 text-xs inline-flex items-center gap-1"
          disabled={summaryLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${summaryLoading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
    </div>
  );

  return (
    <WorkspaceShell
      icon={Calculator}
      title="Accounting sync"
      subtitle="Push invoices and customers to QuickBooks or Xero"
      tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
      activeTab={activeTab}
      onTabChange={(k) => setActiveTab(k as TabKey)}
      banners={statusHeader}
    >
      {!connected && !summaryLoading && (
        <SectionCard>
          <EmptyState
            icon={Plug}
            title="Connect an accounting provider"
            description="Link QuickBooks or Xero to push your invoices and customers, view your chart of accounts, and keep books in sync."
            actionLabel="Connect provider"
            onAction={() => { window.location.href = "/app/integrations?category=accounting"; }}
            tip="Available providers: QuickBooks, Xero"
          />
        </SectionCard>
      )}

      {connected && activeTab === "invoices" && (
        <SectionCard
          title="Invoices to push"
          subtitle={`${invoices.length} unsynced ${invoices.length === 1 ? "invoice" : "invoices"}`}
          icon={Send}
          headerRight={
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void loadInvoices()} className="kf-btn-secondary h-8 px-3 text-xs inline-flex items-center gap-1" disabled={invoicesLoading}>
                <RefreshCw className={`w-3.5 h-3.5 ${invoicesLoading ? "animate-spin" : ""}`} /> Refresh
              </button>
              <button
                type="button"
                onClick={handlePush}
                disabled={pushing || selectedIds.length === 0}
                className="kf-btn-primary h-8 px-3 text-xs inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {pushing ? "Pushing…" : `Push ${selectedIds.length || ""} to ${provider ? PROVIDER_LABEL[provider] : "provider"}`.trim()}
              </button>
            </div>
          }
          noPadding
        >
          {invoicesLoading ? (
            <div className="p-8 text-center text-sm kf-text-muted-foreground">Loading invoices…</div>
          ) : invoices.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={CheckCircle2}
                title="All invoices are in sync"
                description="There are no unsynced invoices. New invoices will appear here automatically."
                variant="compact"
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider kf-text-muted-foreground border-b" style={{ borderColor: "hsl(var(--kf-border))" }}>
                    <th className="px-4 py-2 text-left">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                    </th>
                    <th className="px-4 py-2 text-left">Invoice</th>
                    <th className="px-4 py-2 text-left">Customer</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Issue date</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b hover:bg-[color-mix(in_srgb,hsl(var(--kf-muted-foreground))_6%,transparent)]" style={{ borderColor: "hsl(var(--kf-border))" }}>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={!!selected[inv.id]}
                          onChange={(e) => setSelected((s) => ({ ...s, [inv.id]: e.target.checked }))}
                          aria-label={`Select ${inv.invoiceNumber}`}
                        />
                      </td>
                      <td className="px-4 py-2 font-medium kf-text-foreground">{inv.invoiceNumber}</td>
                      <td className="px-4 py-2 kf-text-muted-foreground">{contactName(inv.contact)}</td>
                      <td className="px-4 py-2 kf-text-muted-foreground">{inv.status}</td>
                      <td className="px-4 py-2 kf-text-muted-foreground">{formatDate(inv.issueDate)}</td>
                      <td className="px-4 py-2 text-right font-medium kf-text-foreground">{formatMoney(inv.total ?? 0, inv.currency || "USD")}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void handlePushRow(inv.id)}
                          disabled={pushingRow === inv.id || pushing}
                          className="kf-btn-secondary h-7 px-2 text-xs inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          {pushingRow === inv.id ? "Pushing…" : `Push to ${provider ? PROVIDER_LABEL[provider] : "provider"}`}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {connected && activeTab === "customers" && (
        <SectionCard
          title="Customers"
          subtitle={`${summary?.customersSynced ?? 0} of ${summary?.customersTotal ?? 0} synced to ${provider ? PROVIDER_LABEL[provider] : "provider"}`}
          icon={Users}
          headerRight={
            <button
              type="button"
              onClick={handlePushCustomers}
              disabled={pushingCustomers}
              className="kf-btn-primary h-8 px-3 text-xs inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {pushingCustomers ? "Pushing…" : "Push all customers"}
            </button>
          }
        >
          <div className="text-sm kf-text-muted-foreground space-y-2">
            <p>Push every contact who has at least one invoice to {provider ? PROVIDER_LABEL[provider] : "your provider"} as a customer record.</p>
            <p>Already-synced customers are updated in place using their stored external id.</p>
            <Link href="/app/contacts" className="kf-btn-secondary h-8 px-3 text-xs inline-flex items-center gap-1 w-fit">
              Manage contacts
            </Link>
          </div>
        </SectionCard>
      )}

      {connected && activeTab === "accounts" && (
        <SectionCard
          title="Chart of accounts"
          subtitle={provider ? `From ${PROVIDER_LABEL[provider]}` : undefined}
          icon={BookOpen}
          headerRight={
            <button type="button" onClick={() => void loadAccounts()} className="kf-btn-secondary h-8 px-3 text-xs inline-flex items-center gap-1" disabled={accountsLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${accountsLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
          }
          noPadding
        >
          {accountsLoading ? (
            <div className="p-8 text-center text-sm kf-text-muted-foreground">Loading accounts…</div>
          ) : accountsError ? (
            <div className="p-6 flex items-start gap-3 text-sm" style={{ color: "hsl(var(--kf-destructive))" }}>
              <AlertTriangle className="w-4 h-4 mt-0.5" /> {accountsError}
            </div>
          ) : accounts.length === 0 ? (
            <div className="p-8">
              <EmptyState icon={BookOpen} title="No accounts returned" description="Your provider returned no chart of accounts." variant="compact" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider kf-text-muted-foreground border-b" style={{ borderColor: "hsl(var(--kf-border))" }}>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left">Sub-type</th>
                    <th className="px-4 py-2 text-left">Classification</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="border-b" style={{ borderColor: "hsl(var(--kf-border))" }}>
                      <td className="px-4 py-2 kf-text-foreground font-medium">{a.name}</td>
                      <td className="px-4 py-2 kf-text-muted-foreground">{a.type || "—"}</td>
                      <td className="px-4 py-2 kf-text-muted-foreground">{a.subType || "—"}</td>
                      <td className="px-4 py-2 kf-text-muted-foreground">{a.classification || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </WorkspaceShell>
  );
}
