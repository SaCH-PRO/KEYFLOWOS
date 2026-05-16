"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Loader2, Search, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import {
  fetchAccounts,
  previewAccountMerge,
  applyAccountMerge,
  type AccountSummary,
  type AccountListFilters,
} from "@/lib/client";
import { getStoredBusinessId, ensureWorkspace } from "@/lib/workspace";

function fmtMoney(value: number | null | undefined, currency: string = "TTD") {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-TT", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const days = Math.round((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export default function AccountsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AccountListFilters>({ take: 100 });
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");

  // Merge modal state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [proposals, setProposals] = useState<Array<{ companyName: string; contactCount: number; existingAccountId: string | null; suggestedDomain: string | null; selected: boolean }>>([]);

  useEffect(() => {
    (async () => {
      const id = getStoredBusinessId() || (await ensureWorkspace());
      setBusinessId(id);
    })();
  }, []);

  const reload = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const r = await fetchAccounts(
        { ...filters, search: search || undefined, industry: industry || undefined },
        businessId,
      );
      if (r.data) {
        setAccounts(r.data.accounts);
        setTotal(r.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [businessId, filters, search, industry]);

  useEffect(() => { reload(); }, [reload]);

  const industries = useMemo(() => {
    const s = new Set<string>();
    for (const a of accounts) if (a.industry) s.add(a.industry);
    return Array.from(s).sort();
  }, [accounts]);

  const totals = useMemo(() => {
    return accounts.reduce(
      (acc, a) => {
        acc.openValue += a.openDealValue;
        acc.lifetime += a.lifetimeRevenue;
        acc.contacts += a.contactCount;
        acc.deals += a.dealCount;
        return acc;
      },
      { openValue: 0, lifetime: 0, contacts: 0, deals: 0 },
    );
  }, [accounts]);

  const openMerge = async () => {
    if (!businessId) return;
    setMergeOpen(true);
    setMergeBusy(true);
    try {
      const r = await previewAccountMerge(businessId);
      const items = (r.data?.proposals ?? []).map((p) => ({ ...p, selected: !p.existingAccountId }));
      setProposals(items);
    } finally {
      setMergeBusy(false);
    }
  };

  const runMerge = async () => {
    if (!businessId) return;
    const items = proposals.filter((p) => p.selected).map((p) => ({
      companyName: p.companyName,
      useExistingAccountId: p.existingAccountId ?? undefined,
      createWithDomain: p.suggestedDomain ?? undefined,
    }));
    if (items.length === 0) return;
    setMergeBusy(true);
    try {
      await applyAccountMerge(items, businessId);
      setMergeOpen(false);
      await reload();
    } finally {
      setMergeBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        icon={Building2}
        title="Accounts"
        subtitle={`${total} accounts · ${fmtMoney(totals.openValue)} open · ${fmtMoney(totals.lifetime)} lifetime`}
        rightSlot={
          <button
            onClick={openMerge}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-[hsl(var(--kf-accent2))] text-white hover:opacity-90"
          >
            <Wand2 className="w-3.5 h-3.5" /> Merge from contacts
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, domain, website…"
            className="w-full text-sm bg-background border border-border rounded-md pl-8 pr-2 py-1.5"
          />
        </div>
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="text-sm bg-background border border-border rounded-md px-2 py-1.5"
        >
          <option value="">All industries</option>
          {industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <input
          type="number"
          placeholder="Min total deal $"
          value={filters.minDealValue ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, minDealValue: e.target.value ? Number(e.target.value) : undefined }))}
          className="w-36 text-sm bg-background border border-border rounded-md px-2 py-1.5"
        />
        <select
          value={filters.lastActivityWithinDays ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, lastActivityWithinDays: e.target.value ? Number(e.target.value) : undefined }))}
          className="text-sm bg-background border border-border rounded-md px-2 py-1.5"
        >
          <option value="">Any activity</option>
          <option value="7">Active in 7d</option>
          <option value="30">Active in 30d</option>
          <option value="90">Active in 90d</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-lg">
          <Building2 className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No accounts yet.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Use &quot;Merge from contacts&quot; to convert your existing companyName values.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Account</th>
                <th className="p-2 text-left">Industry</th>
                <th className="p-2 text-right">Contacts</th>
                <th className="p-2 text-right">Deals</th>
                <th className="p-2 text-right">Open $</th>
                <th className="p-2 text-right">Lifetime $</th>
                <th className="p-2 text-left">Last activity</th>
                <th className="p-2 text-left">Next action</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-border hover:bg-muted/10">
                  <td className="p-2">
                    <Link href={`/app/crm/accounts/${a.id}`} className="font-medium text-[hsl(var(--kf-accent2))] hover:underline">
                      {a.name}
                    </Link>
                    {a.domain && <div className="text-xs text-muted-foreground">{a.domain}</div>}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{a.industry || "—"}</td>
                  <td className="p-2 text-right tabular-nums">{a.contactCount}</td>
                  <td className="p-2 text-right tabular-nums">{a.dealCount}</td>
                  <td className="p-2 text-right tabular-nums">{fmtMoney(a.openDealValue, a.currency)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtMoney(a.lifetimeRevenue, a.currency)}</td>
                  <td className="p-2 text-xs text-muted-foreground">{fmtRelative(a.lastActivityAt)}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {a.nextActionAt ? new Date(a.nextActionAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {mergeOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !mergeBusy && setMergeOpen(false)}>
          <div className="bg-background border border-border rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border">
              <h2 className="font-semibold">Merge contact companies into accounts</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Each row groups contacts by their <code>companyName</code>. Selected rows will create new
                Accounts (or reuse the existing one) and link contacts and their deals.
              </p>
            </div>
            <div className="flex-1 overflow-auto p-2">
              {mergeBusy && proposals.length === 0 ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : proposals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nothing left to merge — all contacts with a company name already have an account.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2 w-8"></th>
                      <th className="p-2 text-left">Company</th>
                      <th className="p-2 text-right">Contacts</th>
                      <th className="p-2 text-left">Domain</th>
                      <th className="p-2 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map((p, i) => (
                      <tr key={p.companyName} className="border-t border-border">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={p.selected}
                            onChange={(e) => setProposals((arr) => arr.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                          />
                        </td>
                        <td className="p-2 font-medium">{p.companyName}</td>
                        <td className="p-2 text-right tabular-nums">{p.contactCount}</td>
                        <td className="p-2 text-xs text-muted-foreground">{p.suggestedDomain ?? "—"}</td>
                        <td className="p-2 text-xs">
                          {p.existingAccountId
                            ? <span className="text-amber-500">Link to existing</span>
                            : <span className="text-emerald-500">Create new</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-3 border-t border-border flex items-center justify-end gap-2">
              <button onClick={() => setMergeOpen(false)} disabled={mergeBusy} className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/30">Cancel</button>
              <button
                onClick={runMerge}
                disabled={mergeBusy || proposals.every((p) => !p.selected)}
                className="text-sm px-3 py-1.5 rounded-md bg-[hsl(var(--kf-accent2))] text-white hover:opacity-90 disabled:opacity-50"
              >
                {mergeBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Merge ${proposals.filter((p) => p.selected).length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
