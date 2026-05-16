"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Briefcase, Loader2, Trash2, Trophy, XCircle } from "lucide-react";
import {
  bulkMoveDealStage,
  deleteDeal,
  loseDeal,
  moveDealStage,
  winDeal,
  type Deal,
  type DealStage,
  type WonLostReason,
} from "@/lib/client";
import { ReasonPickerModal } from "./reason-picker-modal";
import { fmtMoney, healthColor, statusClass } from "./deals-shared";

interface Props {
  businessId: string;
  loading: boolean;
  deals: Deal[];
  stages: DealStage[];
  reasons: WonLostReason[];
  onChanged: () => void | Promise<void>;
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

export function DealsListView({ businessId, loading, deals, stages, reasons, onChanged }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reasonModal, setReasonModal] = useState<{ open: boolean; kind: "WON" | "LOST"; dealId: string | null }>({
    open: false, kind: "WON", dealId: null,
  });

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
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      await bulkMoveDealStage(Array.from(selected), stageId, businessId);
      setSelected(new Set());
      await onChanged();
    } finally { setBulkBusy(false); }
  };

  const onMove = async (id: string, stageId: string) => {
    await moveDealStage(id, stageId, businessId);
    await onChanged();
  };

  const openReason = (id: string, kind: "WON" | "LOST") => setReasonModal({ open: true, kind, dealId: id });

  const submitReason = async ({ reasonId, reasonNotes }: { reasonId: string | null; reasonNotes: string }) => {
    if (!reasonModal.dealId) return;
    if (reasonModal.kind === "WON") {
      await winDeal(reasonModal.dealId, { reasonId, reasonNotes }, businessId);
    } else {
      await loseDeal(reasonModal.dealId, { reasonId, reasonNotes }, businessId);
    }
    setReasonModal({ open: false, kind: "WON", dealId: null });
    await onChanged();
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("Delete this deal?")) return;
    await deleteDeal(id, businessId);
    await onChanged();
  };

  const totalValue = useMemo(
    () => deals.filter((d) => d.status === "OPEN").reduce((acc, d) => acc + (d.value ?? 0), 0),
    [deals],
  );

  return (
    <div>
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
        <>
          <div className="text-xs text-muted-foreground mb-2">{deals.length} shown · {fmtMoney(totalValue)} open value</div>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full w-full text-sm">
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
                        <Link href={`/app/crm?contactId=${d.contactId}`} className="text-xs text-[hsl(var(--kf-accent2))] hover:underline">
                          {d.contact.displayName || `${d.contact.firstName ?? ""} ${d.contact.lastName ?? ""}`.trim() || d.contact.email || "Contact"}
                        </Link>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2">
                      <select value={d.stageId} onChange={(e) => onMove(d.id, e.target.value)}
                        className="text-xs bg-background border border-border rounded px-1.5 py-0.5">
                        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td className="p-2"><HealthBar score={d.healthScore ?? null} /></td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(d.value, d.currency)}</td>
                    <td className="p-2 text-xs text-muted-foreground">{d.expectedCloseAt ? new Date(d.expectedCloseAt).toLocaleDateString() : "—"}</td>
                    <td className="p-2"><span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-semibold ${statusClass(d.status)}`}>{d.status}</span></td>
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
          </div>
        </>
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
