"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2, Wallet, Calculator, BookOpen, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchFinanceSettings, updateFinanceSettings,
  fetchFinanceAccounts, createFinanceAccount, updateFinanceAccount, archiveFinanceAccount,
  fetchFinanceCoa, createFinanceCoa, updateFinanceCoa, archiveFinanceCoa,
  fetchTaxRates, createTaxRate, updateTaxRate, deleteTaxRate,
  type FinanceSettings, type FinancialAccountRow, type ChartOfAccountRow, type TaxRateRow,
} from "@/lib/client";
import { formatCurrency } from "@/lib/currency";

const SECTIONS = [
  { key: "general", label: "General", icon: SettingsIcon },
  { key: "accounts", label: "Accounts", icon: Wallet },
  { key: "coa", label: "Chart of Accounts", icon: BookOpen },
  { key: "tax", label: "Tax Rates", icon: Calculator },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function FinanceSettingsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [section, setSection] = useState<string>("general");

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBusinessId(getStoredBusinessId()); }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hash && SECTIONS.some((s) => s.key === hash)) setSection(hash);
  }, []);

  return (
    <WorkspaceShell
      icon={SettingsIcon}
      title="Finance settings"
      subtitle={
        <Link href="/app/financial-flow" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="w-3 h-3" /> Back to Financial Flow
        </Link>
      }
      tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label, icon: s.icon }))}
      activeTab={section}
      onTabChange={setSection}
      tabLayoutId="finance-settings-tabs"
    >
      {!businessId && <p className="text-sm text-muted-foreground">Loading workspace…</p>}
      {businessId && section === "general" && <GeneralSection businessId={businessId} />}
      {businessId && section === "accounts" && <AccountsSection businessId={businessId} />}
      {businessId && section === "coa" && <CoaSection businessId={businessId} />}
      {businessId && section === "tax" && <TaxRatesSection businessId={businessId} />}
    </WorkspaceShell>
  );
}

// ---------- General (basis, fiscal year, default tax, default accounts) ----------

function GeneralSection({ businessId }: { businessId: string }) {
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccountRow[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      fetchFinanceSettings(businessId),
      fetchFinanceAccounts(businessId),
    ]);
    if (s.data) setSettings(s.data);
    if (a.data) setAccounts(a.data.items);
  }, [businessId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (!settings) return <p className="text-sm text-muted-foreground">Loading settings…</p>;

  const save = async () => {
    setSaving(true);
    const r = await updateFinanceSettings(businessId, settings);
    setSaving(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success("Settings saved");
    if (r.data) setSettings(r.data);
  };

  const update = (patch: Partial<FinanceSettings>) => setSettings({ ...settings, ...patch });

  const accountOptions = accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, label: `${a.name} (${a.type})` }));

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-4">
        <h2 className="text-sm font-semibold">Accounting basis</h2>
        <div className="flex gap-2">
          {(["CASH", "ACCRUAL"] as const).map((b) => (
            <button
              key={b}
              onClick={() => update({ accountingBasis: b })}
              className={`px-3 py-1.5 text-sm rounded-lg border ${settings.accountingBasis === b ? "border-primary bg-primary/10" : "border-border/40 hover:bg-card/80"}`}
            >
              {b === "CASH" ? "Cash basis" : "Accrual basis"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Cash recognises revenue when payment is collected. Accrual recognises it when the invoice is issued.
        </p>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Fiscal year</h2>
        <label className="flex items-center gap-3 text-sm">
          Year starts in
          <select
            className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
            value={settings.fiscalYearStartMonth}
            onChange={(e) => update({ fiscalYearStartMonth: parseInt(e.target.value, 10) })}
          >
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Default tax rate</h2>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            className="w-24 rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
            value={settings.defaultTaxRate}
            onChange={(e) => update({ defaultTaxRate: parseFloat(e.target.value) || 0 })}
          />
          <span>% applied to new invoices when no rate is selected</span>
        </label>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Accountant</h2>
        <p className="text-xs text-muted-foreground">
          Default recipient for the &ldquo;Send to accountant&rdquo; action on Reports and Tax.
          When set, the export package can be emailed in one click without re-typing the address.
        </p>
        <label className="flex items-center gap-3 text-sm">
          <span className="min-w-[160px]">Accountant email</span>
          <input
            type="email"
            value={settings.accountantEmail ?? ""}
            onChange={(e) => update({ accountantEmail: e.target.value || null })}
            placeholder="accountant@firm.com"
            className="flex-1 rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Default accounts</h2>
        <p className="text-xs text-muted-foreground">Used when posting to the ledger if no account is specified.</p>
        <DefaultAccountSelect label="Cash / Bank" value={settings.defaultCashAccountId} options={accountOptions} onChange={(v) => update({ defaultCashAccountId: v })} />
        <DefaultAccountSelect label="Accounts Receivable" value={settings.defaultArAccountId} options={accountOptions} onChange={(v) => update({ defaultArAccountId: v })} />
        <DefaultAccountSelect label="Accounts Payable" value={settings.defaultApAccountId} options={accountOptions} onChange={(v) => update({ defaultApAccountId: v })} />
        <DefaultAccountSelect label="Tax Payable" value={settings.defaultTaxAccountId} options={accountOptions} onChange={(v) => update({ defaultTaxAccountId: v })} />
      </div>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

function DefaultAccountSelect({ label, value, onChange, options }: { label: string; value: string | null; onChange: (v: string | null) => void; options: { id: string; label: string }[] }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-[160px]">{label}</span>
      <select
        className="flex-1 rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">— None —</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

// ---------- Accounts CRUD ----------

const ACCOUNT_TYPES = ["CASH", "BANK", "PAYMENT_PROCESSOR", "CREDIT_CARD", "LOAN", "EQUITY", "TAX", "OTHER"];

function AccountsSection({ businessId }: { businessId: string }) {
  const [items, setItems] = useState<FinancialAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", type: "BANK", openingBalance: 0, institution: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchFinanceAccounts(businessId);
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

  const archive = async (id: string) => {
    const r = await archiveFinanceAccount(businessId, id);
    if (r.error) { toast.error(r.error); return; }
    toast.success("Archived");
    load();
  };

  const toggleDefault = async (a: FinancialAccountRow) => {
    const r = await updateFinanceAccount(businessId, a.id, { isDefault: !a.isDefault });
    if (r.error) { toast.error(r.error); return; }
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Financial accounts</h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80"
        >
          <Plus className="w-3.5 h-3.5" /> {adding ? "Cancel" : "Add account"}
        </button>
      </div>

      {adding && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 grid sm:grid-cols-5 gap-2">
          <input className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm sm:col-span-2" placeholder="Account name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="number" className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" placeholder="Opening" value={draft.openingBalance} onChange={(e) => setDraft({ ...draft, openingBalance: parseFloat(e.target.value) || 0 })} />
          <button onClick={add} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90">Save</button>
        </div>
      )}

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? (
        <EmptyState icon={Wallet} title="No accounts yet" description="Add a bank or cash account to get started." variant="compact" />
      ) : (
        <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full w-full text-sm">
            <thead className="bg-background/60 text-xs text-muted-foreground">
              <tr><th className="text-left px-3 py-2 font-medium">Name</th><th className="text-left px-3 py-2 font-medium">Type</th><th className="text-right px-3 py-2 font-medium">Balance</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className={`border-t border-border/30 ${!a.isActive ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.name} {a.isDefault && <span className="text-[10px] uppercase text-primary ml-1">Default</span>}</div>
                    {a.institution && <div className="text-xs text-muted-foreground">{a.institution}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.type}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(Number(a.currentBalance), a.currency)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => toggleDefault(a)} className="text-xs text-muted-foreground hover:text-foreground mr-2">{a.isDefault ? "Unset default" : "Set default"}</button>
                    {a.isActive && <button onClick={() => archive(a.id)} className="text-xs text-rose-500 hover:underline inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Archive</button>}
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

// ---------- Chart of Accounts CRUD ----------

const COA_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "COGS", "EXPENSE"];

function CoaSection({ businessId }: { businessId: string }) {
  const [items, setItems] = useState<ChartOfAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", type: "EXPENSE", code: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchFinanceCoa(businessId);
    if (r.data) setItems(r.data.items);
    setLoading(false);
  }, [businessId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.name.trim()) { toast.error("Name required"); return; }
    const r = await createFinanceCoa(businessId, { name: draft.name.trim(), type: draft.type, code: draft.code || null });
    if (r.error) { toast.error(r.error); return; }
    toast.success("Account added");
    setAdding(false);
    setDraft({ name: "", type: "EXPENSE", code: "" });
    load();
  };
  const archive = async (id: string) => {
    const r = await archiveFinanceCoa(businessId, id);
    if (r.error) { toast.error(r.error); return; }
    load();
  };
  const rename = async (row: ChartOfAccountRow, name: string) => {
    if (!name.trim() || name === row.name) return;
    const r = await updateFinanceCoa(businessId, row.id, { name: name.trim() });
    if (r.error) { toast.error(r.error); return; }
    load();
  };

  const grouped = items.reduce<Record<string, ChartOfAccountRow[]>>((acc, r) => {
    (acc[r.type] = acc[r.type] ?? []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Chart of accounts</h2>
        <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80">
          <Plus className="w-3.5 h-3.5" /> {adding ? "Cancel" : "Add account"}
        </button>
      </div>

      {adding && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 grid sm:grid-cols-4 gap-2">
          <input className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm sm:col-span-2" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            {COA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" placeholder="Code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          <button onClick={add} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 sm:col-span-4">Save</button>
        </div>
      )}

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-3">
          {COA_TYPES.map((type) => {
            const rows = grouped[type] ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={type} className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
                <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground bg-background/40">{type}</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full w-full text-sm">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={`border-t border-border/20 ${!r.isActive ? "opacity-50" : ""}`}>
                        <td className="px-3 py-1.5 w-16 text-xs text-muted-foreground font-mono">{r.code ?? ""}</td>
                        <td className="px-3 py-1.5">
                          {r.isSystem ? (
                            <span className="text-sm">
                              {r.name}
                              <span className="text-[10px] uppercase text-muted-foreground ml-2">System · read-only</span>
                            </span>
                          ) : (
                            <input
                              defaultValue={r.name}
                              onBlur={(e) => rename(r, e.target.value)}
                              className="bg-transparent w-full text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 rounded px-1"
                            />
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {!r.isSystem && r.isActive && (
                            <button onClick={() => archive(r.id)} className="text-xs text-rose-500 hover:underline inline-flex items-center gap-1">
                              <Trash2 className="w-3 h-3" /> Archive
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Tax Rates CRUD ----------

function TaxRatesSection({ businessId }: { businessId: string }) {
  const [items, setItems] = useState<TaxRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", rate: 0, type: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchTaxRates(businessId);
    if (r.data) setItems(r.data.items);
    setLoading(false);
  }, [businessId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.name.trim()) { toast.error("Name required"); return; }
    const r = await createTaxRate(businessId, { name: draft.name.trim(), rate: draft.rate, type: draft.type || null });
    if (r.error) { toast.error(r.error); return; }
    toast.success("Tax rate added");
    setAdding(false);
    setDraft({ name: "", rate: 0, type: "" });
    load();
  };
  const remove = async (id: string) => {
    const r = await deleteTaxRate(businessId, id);
    if (r.error) { toast.error(r.error); return; }
    load();
  };
  const setDefault = async (row: TaxRateRow) => {
    const r = await updateTaxRate(businessId, row.id, { isDefault: !row.isDefault });
    if (r.error) { toast.error(r.error); return; }
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tax rates</h2>
        <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80">
          <Plus className="w-3.5 h-3.5" /> {adding ? "Cancel" : "Add tax rate"}
        </button>
      </div>

      {adding && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 grid sm:grid-cols-4 gap-2">
          <input className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm sm:col-span-2" placeholder="Name (e.g. VAT)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input type="number" step={0.01} className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" placeholder="Rate %" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: parseFloat(e.target.value) || 0 })} />
          <input className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" placeholder="Type (optional)" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} />
          <button onClick={add} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 sm:col-span-4">Save</button>
        </div>
      )}

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? (
        <EmptyState icon={Calculator} title="No tax rates yet" description="Add VAT, GST or any other rate you apply to invoices." variant="compact" />
      ) : (
        <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full w-full text-sm">
            <thead className="bg-background/60 text-xs text-muted-foreground">
              <tr><th className="text-left px-3 py-2 font-medium">Name</th><th className="text-left px-3 py-2 font-medium">Type</th><th className="text-right px-3 py-2 font-medium">Rate</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-border/30">
                  <td className="px-3 py-2 font-medium">{r.name} {r.isDefault && <span className="text-[10px] uppercase text-primary ml-1">Default</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.type ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(r.rate).toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setDefault(r)} className="text-xs text-muted-foreground hover:text-foreground mr-2">{r.isDefault ? "Unset default" : "Set default"}</button>
                    <button onClick={() => remove(r.id)} className="text-xs text-rose-500 hover:underline inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>
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
