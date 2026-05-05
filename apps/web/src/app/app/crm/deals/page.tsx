"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Briefcase, Loader2, Search, TrendingUp, Trophy, XCircle, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import {
  fetchDeals,
  fetchDealStages,
  fetchDealForecast,
  fetchDealVelocity,
  fetchWonLostReasons,
  fetchDealsByAccountPivot,
  bulkMoveDealStage,
  winDeal,
  loseDeal,
  deleteDeal,
  moveDealStage,
  type Deal,
  type DealStage,
  type DealListFilters,
  type DealForecast,
  type DealVelocityReport,
  type WonLostReason,
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

function statusClass(status: string) {
  if (status === "WON") return "bg-emerald-500/15 text-emerald-500";
  if (status === "LOST") return "bg-red-500/15 text-red-500";
  return "bg-sky-500/15 text-sky-500";
}

function healthColor(score: number) {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  if (score >= 25) return "bg-orange-500";
  return "bg-red-500";
}

function HealthBar({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-[10px] text-muted-foreground/60">—</span>;
  return (
    <div className="flex items-center gap-1.5" title={`Health score: ${score}/100`}>
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${healthColor(score)}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{score}</span>
    </div>
  );
}

interface ReasonPickerProps {
  open: boolean;
  kind: "WON" | "LOST";
  reasons: WonLostReason[];
  onCancel: () => void;
  onSubmit: (payload: { reasonId: string | null; reasonNotes: string }) => Promise<void>;
}

function ReasonPickerModal({ open, kind, reasons, onCancel, onSubmit }: ReasonPickerProps) {
  const [reasonId, setReasonId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReasonId(""); setNotes(""); setBusy(false); } }, [open]);
  if (!open) return null;
  const filtered = reasons.filter((r) => r.kind === kind);
  const canSubmit = !busy && (reasonId !== "" || notes.trim().length > 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h2 className="text-sm font-semibold">
            {kind === "WON" ? "Mark deal as won" : "Mark deal as lost"}
          </h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Reason</label>
            <select
              value={reasonId}
              onChange={(e) => setReasonId(e.target.value)}
              className="w-full text-sm bg-background border border-border rounded-md px-2 py-1.5"
            >
              <option value="">— Select a reason —</option>
              {filtered.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={3}
              className="w-full text-sm bg-background border border-border rounded-md px-2 py-1.5"
              placeholder="Any extra context for win/loss analysis…"
            />
          </div>
          {!canSubmit && <p className="text-xs text-muted-foreground/80">Pick a reason or add notes to continue.</p>}
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t border-border">
          <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted">Cancel</button>
          <button
            disabled={!canSubmit}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit({ reasonId: reasonId || null, reasonNotes: notes.trim() });
              } finally {
                setBusy(false);
              }
            }}
            className={`text-sm px-3 py-1.5 rounded-md text-white ${kind === "WON" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"} disabled:opacity-50`}
          >
            {busy ? "Saving…" : kind === "WON" ? "Mark won" : "Mark lost"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DealsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [stages, setStages] = useState<DealStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [forecast, setForecast] = useState<DealForecast | null>(null);
  const [velocity, setVelocity] = useState<DealVelocityReport | null>(null);
  const [reasons, setReasons] = useState<WonLostReason[]>([]);
  const [reasonModal, setReasonModal] = useState<{ open: boolean; kind: "WON" | "LOST"; dealId: string | null }>({ open: false, kind: "WON", dealId: null });

  const [filters, setFilters] = useState<DealListFilters>({ status: "OPEN", take: 100 });
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [pivot, setPivot] = useState<"deals" | "account">("deals");
  const [accountBuckets, setAccountBuckets] = useState<Array<{ accountId: string | null; label: string; count: number; openValue: number; wonValue: number; currency: string }>>([]);

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
      const [s, d, f, v, r, pv] = await Promise.all([
        fetchDealStages(businessId),
        fetchDeals({
          ...filters,
          search: search || undefined,
          stageIds: stageFilter ? [stageFilter] : undefined,
        }, businessId),
        fetchDealForecast({ windowDays: 30 }, businessId),
        fetchDealVelocity(businessId),
        fetchWonLostReasons({}, businessId),
        pivot === "account" ? fetchDealsByAccountPivot(businessId) : Promise.resolve({ data: { buckets: [] } } as { data: { buckets: typeof accountBuckets } }),
      ]);
      if (s.data) setStages(s.data);
      if (d.data) {
        setDeals(d.data.deals);
        setTotal(d.data.total);
      }
      if (f.data) setForecast(f.data);
      if (v.data) setVelocity(v.data);
      if (r.data) setReasons(r.data);
      if (pv.data) setAccountBuckets(pv.data.buckets);
    } finally {
      setLoading(false);
    }
  }, [businessId, filters, search, stageFilter, pivot]);

  useEffect(() => { reload(); }, [reload]);

  const totalValue = useMemo(
    () => deals.filter((d) => d.status === "OPEN").reduce((acc, d) => acc + (d.value ?? 0), 0),
    [deals],
  );
  const bottleneckCount = useMemo(() => deals.filter((d) => d.bottleneckFlag).length, [deals]);

  const allChecked = deals.length > 0 && deals.every((d) => selected.has(d.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(deals.map((d) => d.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const onBulkMove = async (stageId: string) => {
    if (!businessId || selected.size === 0) return;
    setBulkBusy(true);
    try {
      await bulkMoveDealStage(Array.from(selected), stageId, businessId);
      setSelected(new Set());
      await reload();
    } finally { setBulkBusy(false); }
  };

  const onMove = async (id: string, stageId: string) => {
    if (!businessId) return;
    await moveDealStage(id, stageId, businessId);
    await reload();
  };

  const openReason = (id: string, kind: "WON" | "LOST") => setReasonModal({ open: true, kind, dealId: id });

  const submitReason = async ({ reasonId, reasonNotes }: { reasonId: string | null; reasonNotes: string }) => {
    if (!businessId || !reasonModal.dealId) return;
    if (reasonModal.kind === "WON") {
      await winDeal(reasonModal.dealId, { reasonId, reasonNotes }, businessId);
    } else {
      await loseDeal(reasonModal.dealId, { reasonId, reasonNotes }, businessId);
    }
    setReasonModal({ open: false, kind: "WON", dealId: null });
    await reload();
  };

  const onDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Delete this deal?")) return;
    await deleteDeal(id, businessId);
    await reload();
  };

  const slowestStage = velocity?.stages
    .filter((s) => s.category === "OPEN" && s.avgDaysInStage > 0)
    .slice()
    .sort((a, b) => b.avgDaysInStage - a.avgDaysInStage)[0];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        icon={Briefcase}
        title="Deals"
        subtitle={`${total} total · ${fmtMoney(totalValue, forecast?.currency ?? "TTD")} open pipeline`}
      />

      {/* Intelligence rollup */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="w-3.5 h-3.5" /> Weighted forecast</div>
          <div className="text-lg font-semibold tabular-nums mt-1">{fmtMoney(forecast?.totalWeightedValue, forecast?.currency)}</div>
          <div className="text-[10px] text-muted-foreground/80">of {fmtMoney(forecast?.totalOpenValue, forecast?.currency)} open</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="text-xs text-muted-foreground">Closing in {forecast?.windowDays ?? 30}d</div>
          <div className="text-lg font-semibold tabular-nums mt-1">{fmtMoney(forecast?.expectedCloseWeightedValue, forecast?.currency)}</div>
          <div className="text-[10px] text-muted-foreground/80">{fmtMoney(forecast?.expectedCloseValue, forecast?.currency)} unweighted</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="text-xs text-muted-foreground">Avg cycle (slowest)</div>
          <div className="text-lg font-semibold tabular-nums mt-1">{slowestStage ? `${slowestStage.avgDaysInStage}d` : "—"}</div>
          <div className="text-[10px] text-muted-foreground/80 truncate">{slowestStage?.stageName ?? "no data yet"}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle className="w-3.5 h-3.5" /> Bottlenecks</div>
          <div className="text-lg font-semibold tabular-nums mt-1">{bottleneckCount}</div>
          <div className="text-[10px] text-muted-foreground/80">{velocity?.outliers.length ?? 0} stage outliers</div>
        </div>
      </div>

      <div className="inline-flex rounded-md border border-border overflow-hidden mb-3 text-xs">
        <button onClick={() => setPivot("deals")} className={`px-3 py-1.5 ${pivot === "deals" ? "bg-[hsl(var(--kf-accent2))] text-white" : "bg-background text-muted-foreground"}`}>By deal</button>
        <button onClick={() => setPivot("account")} className={`px-3 py-1.5 ${pivot === "account" ? "bg-[hsl(var(--kf-accent2))] text-white" : "bg-background text-muted-foreground"}`}>By account</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, company, notes…"
            className="w-full text-sm bg-background border border-border rounded-md pl-8 pr-2 py-1.5"
          />
        </div>
        <select
          value={filters.status ?? "OPEN"}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as DealListFilters["status"] }))}
          className="text-sm bg-background border border-border rounded-md px-2 py-1.5"
        >
          <option value="ALL">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="text-sm bg-background border border-border rounded-md px-2 py-1.5"
        >
          <option value="">All stages</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          type="number"
          placeholder="Min value"
          value={filters.minValue ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, minValue: e.target.value ? Number(e.target.value) : undefined }))}
          className="w-28 text-sm bg-background border border-border rounded-md px-2 py-1.5"
        />
        <input
          type="number"
          placeholder="Max value"
          value={filters.maxValue ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, maxValue: e.target.value ? Number(e.target.value) : undefined }))}
          className="w-28 text-sm bg-background border border-border rounded-md px-2 py-1.5"
        />
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded-md border border-border bg-card/50">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <span className="text-xs text-muted-foreground">→ move to:</span>
          <select
            disabled={bulkBusy}
            onChange={(e) => { if (e.target.value) onBulkMove(e.target.value); e.currentTarget.value = ""; }}
            className="text-xs bg-background border border-border rounded px-2 py-1"
            defaultValue=""
          >
            <option value="" disabled>Choose stage…</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground ml-auto">Clear</button>
        </div>
      )}

      {pivot === "account" ? (
        loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : accountBuckets.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg">
            <p className="text-sm text-muted-foreground">No deals yet.</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Account</th>
                  <th className="p-2 text-right">Deals</th>
                  <th className="p-2 text-right">Open $</th>
                  <th className="p-2 text-right">Won $</th>
                </tr>
              </thead>
              <tbody>
                {accountBuckets.map((b, i) => (
                  <tr key={`${b.accountId ?? "u"}:${i}`} className="border-t border-border hover:bg-muted/10">
                    <td className="p-2">
                      {b.accountId
                        ? <Link href={`/app/crm/accounts/${b.accountId}`} className="text-[hsl(var(--kf-accent2))] hover:underline">{b.label}</Link>
                        : <span className="text-muted-foreground">{b.label}</span>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{b.count}</td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(b.openValue, b.currency)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(b.wonValue, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : deals.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-lg">
          <Briefcase className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No deals match your filters.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Create deals from a contact&apos;s Deals tab.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="p-2 w-8"><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
                <th className="p-2 text-left">Deal</th>
                <th className="p-2 text-left">Contact</th>
                <th className="p-2 text-left">Stage</th>
                <th className="p-2 text-left">Health</th>
                <th className="p-2 text-right">Value</th>
                <th className="p-2 text-left">Close</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} className={`border-t border-border hover:bg-muted/10 ${d.bottleneckFlag ? "bg-amber-500/5" : ""}`}>
                  <td className="p-2"><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleOne(d.id)} /></td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate max-w-[220px]">{d.title}</span>
                      {d.bottleneckFlag && (
                        <span title="Stuck in stage longer than typical" className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-semibold uppercase">
                          <AlertTriangle className="w-3 h-3" /> Stuck
                        </span>
                      )}
                    </div>
                    {d.companyName && <div className="text-xs text-muted-foreground truncate max-w-[260px]">{d.companyName}</div>}
                    {d.status !== "OPEN" && d.wonLostReason && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">Reason: {d.wonLostReason.label}</div>
                    )}
                  </td>
                  <td className="p-2">
                    {d.contact ? (
                      <Link
                        href={`/app/crm?contactId=${d.contactId}`}
                        className="text-xs text-[hsl(var(--kf-accent2))] hover:underline"
                      >
                        {d.contact.displayName || `${d.contact.firstName ?? ""} ${d.contact.lastName ?? ""}`.trim() || d.contact.email || "Contact"}
                      </Link>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2">
                    <select
                      value={d.stageId}
                      onChange={(e) => onMove(d.id, e.target.value)}
                      className="text-xs bg-background border border-border rounded px-1.5 py-0.5"
                    >
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td className="p-2"><HealthBar score={d.healthScore ?? null} /></td>
                  <td className="p-2 text-right tabular-nums">{fmtMoney(d.value, d.currency)}</td>
                  <td className="p-2 text-xs text-muted-foreground">{d.expectedCloseAt ? new Date(d.expectedCloseAt).toLocaleDateString() : "—"}</td>
                  <td className="p-2">
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-semibold ${statusClass(d.status)}`}>{d.status}</span>
                  </td>
                  <td className="p-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      {d.status === "OPEN" && (
                        <>
                          <button onClick={() => openReason(d.id, "WON")} title="Mark won" className="p-1 rounded hover:bg-emerald-500/10 text-emerald-500"><Trophy className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openReason(d.id, "LOST")} title="Mark lost" className="p-1 rounded hover:bg-red-500/10 text-red-400"><XCircle className="w-3.5 h-3.5" /></button>
                        </>
                      )}
                      <button onClick={() => onDelete(d.id)} title="Delete" className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReasonPickerModal
        open={reasonModal.open}
        kind={reasonModal.kind}
        reasons={reasons}
        onCancel={() => setReasonModal({ open: false, kind: "WON", dealId: null })}
        onSubmit={submitReason}
      />
    </div>
  );
}
