"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, Loader2, Search, Trophy, XCircle, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import {
  fetchDeals,
  fetchDealStages,
  bulkMoveDealStage,
  winDeal,
  loseDeal,
  deleteDeal,
  moveDealStage,
  type Deal,
  type DealStage,
  type DealListFilters,
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

export default function DealsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [stages, setStages] = useState<DealStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [filters, setFilters] = useState<DealListFilters>({ status: "OPEN", take: 100 });
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");

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
      const [s, d] = await Promise.all([
        fetchDealStages(businessId),
        fetchDeals({
          ...filters,
          search: search || undefined,
          stageIds: stageFilter ? [stageFilter] : undefined,
        }, businessId),
      ]);
      if (s.data) setStages(s.data);
      if (d.data) {
        setDeals(d.data.deals);
        setTotal(d.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [businessId, filters, search, stageFilter]);

  useEffect(() => { reload(); }, [reload]);

  const totalValue = useMemo(
    () => deals.filter((d) => d.status === "OPEN").reduce((acc, d) => acc + (d.value ?? 0), 0),
    [deals],
  );

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

  const onWin = async (id: string) => {
    if (!businessId) return;
    await winDeal(id, {}, businessId);
    await reload();
  };

  const onLose = async (id: string) => {
    if (!businessId) return;
    const reason = window.prompt("Loss reason (optional):") ?? undefined;
    await loseDeal(id, { lossReason: reason || undefined }, businessId);
    await reload();
  };

  const onDelete = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Delete this deal?")) return;
    await deleteDeal(id, businessId);
    await reload();
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        icon={Briefcase}
        title="Deals"
        subtitle={`${total} total · ${fmtMoney(totalValue, "TTD")} open pipeline`}
      />

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

      {loading ? (
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
                <th className="p-2 text-right">Value</th>
                <th className="p-2 text-left">Close</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} className="border-t border-border hover:bg-muted/10">
                  <td className="p-2"><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleOne(d.id)} /></td>
                  <td className="p-2">
                    <div className="font-medium truncate max-w-[260px]">{d.title}</div>
                    {d.companyName && <div className="text-xs text-muted-foreground truncate max-w-[260px]">{d.companyName}</div>}
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
                  <td className="p-2 text-right tabular-nums">{fmtMoney(d.value, d.currency)}</td>
                  <td className="p-2 text-xs text-muted-foreground">{d.expectedCloseAt ? new Date(d.expectedCloseAt).toLocaleDateString() : "—"}</td>
                  <td className="p-2">
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-semibold ${statusClass(d.status)}`}>{d.status}</span>
                  </td>
                  <td className="p-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      {d.status === "OPEN" && (
                        <>
                          <button onClick={() => onWin(d.id)} title="Mark won" className="p-1 rounded hover:bg-emerald-500/10 text-emerald-500"><Trophy className="w-3.5 h-3.5" /></button>
                          <button onClick={() => onLose(d.id)} title="Mark lost" className="p-1 rounded hover:bg-red-500/10 text-red-400"><XCircle className="w-3.5 h-3.5" /></button>
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
    </div>
  );
}
