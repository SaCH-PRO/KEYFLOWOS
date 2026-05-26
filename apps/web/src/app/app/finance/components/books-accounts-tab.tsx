"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { getStoredBusinessId } from "@/lib/workspace";
import { formatCurrency } from "@/lib/currency";
import { fetchFinanceAccounts, createFinanceAccount, type FinancialAccountRow } from "@/lib/client";
import { SkeletonGrid } from "../_overview-client";

const ACCOUNT_TYPES = ["CASH", "BANK", "PAYMENT_PROCESSOR", "CREDIT_CARD", "LOAN", "EQUITY", "TAX", "OTHER"];

export function BooksAccountsTab() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBusinessId(getStoredBusinessId()); }, []);
  if (!businessId) return <SkeletonGrid />;
  return <AccountsBody businessId={businessId} />;
}

function AccountsBody({ businessId }: { businessId: string }) {
  const [items, setItems] = useState<FinancialAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", type: "BANK", openingBalance: 0, institution: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchFinanceAccounts(businessId);
    if (r.error) setError(r.error);
    if (r.data) setItems(r.data.items);
    setLoading(false);
  }, [businessId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.name.trim()) { toast.error("Name required"); return; }
    const r = await createFinanceAccount(businessId, {
      name: draft.name.trim(),
      type: draft.type,
      openingBalance: draft.openingBalance,
      institution: draft.institution || null,
    });
    if (r.error) { toast.error(r.error); return; }
    toast.success("Account added");
    setAdding(false);
    setDraft({ name: "", type: "BANK", openingBalance: 0, institution: "" });
    load();
  };

  if (loading) return <SkeletonGrid />;
  if (error) return <p className="text-sm text-rose-500">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Financial accounts</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80"
          >
            <Plus className="w-3.5 h-3.5" /> {adding ? "Cancel" : "Add account"}
          </button>
        </div>
      </div>

      {adding && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 grid sm:grid-cols-5 gap-2">
          <input className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm sm:col-span-2" placeholder="Account name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="number" className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" placeholder="Opening balance" value={draft.openingBalance} onChange={(e) => setDraft({ ...draft, openingBalance: parseFloat(e.target.value) || 0 })} />
          <button onClick={add} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90">Save</button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={Wallet} title="No accounts yet" description="Add a Cash, Bank or processor account to get started." variant="compact" />
      ) : (
        <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full w-full text-sm">
            <thead className="bg-background/60 text-xs text-muted-foreground">
              <tr><th className="text-left px-3 py-2 font-medium">Name</th><th className="text-left px-3 py-2 font-medium">Type</th><th className="text-right px-3 py-2 font-medium">Balance</th><th className="text-left px-3 py-2 font-medium">Currency</th></tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-border/30">
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.name}</div>
                    {a.institution && <div className="text-xs text-muted-foreground">{a.institution}{a.accountLast4 ? ` ••${a.accountLast4}` : ""}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.type}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(Number(a.currentBalance), a.currency)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.currency}</td>
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
