"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, GripVertical, Plus, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  bulkMoveDealStage,
  loseDeal,
  moveDealStage,
  updateDeal,
  winDeal,
  type Deal,
  type DealStage,
  type WonLostReason,
} from "@/lib/client";
import { ReasonPickerModal } from "./reason-picker-modal";
import { AddDealModal } from "./add-deal-modal";
import { fmtMoney, healthHexColor } from "./deals-shared";

interface Props {
  businessId: string;
  deals: Deal[];
  stages: DealStage[];
  reasons: WonLostReason[];
  onChanged: () => void | Promise<void>;
}

export function DealsBoardView({ businessId, deals, stages, reasons, onChanged }: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editingOwner, setEditingOwner] = useState<string | null>(null);
  const [reasonModal, setReasonModal] = useState<{ open: boolean; kind: "WON" | "LOST"; dealId: string | null }>({
    open: false, kind: "WON", dealId: null,
  });
  const [addModal, setAddModal] = useState<{ open: boolean; stageId: string | null; stageName?: string }>({
    open: false, stageId: null,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visibleStages = useMemo(() => stages.filter((s) => s.archivedAt == null), [stages]);

  const grouped = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const s of visibleStages) map.set(s.id, []);
    for (const d of deals) {
      if (d.status !== "OPEN") continue;
      const arr = map.get(d.stageId);
      if (arr) arr.push(d);
    }
    return map;
  }, [deals, visibleStages]);

  const onDragStart = useCallback((e: React.DragEvent, dealId: string) => {
    setDraggedId(dealId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dealId);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverStage !== stageId) setDragOverStage(stageId);
  }, [dragOverStage]);

  const onDrop = useCallback(async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(null);
    const id = e.dataTransfer.getData("text/plain") || draggedId;
    setDraggedId(null);
    if (!id) return;
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stageId === stageId) return;
    // bulk-move-stage endpoint also handles single moves; but use single endpoint for clarity
    if (selected.has(id) && selected.size > 1) {
      try {
        await bulkMoveDealStage(Array.from(selected), stageId, businessId);
        setSelected(new Set());
        toast.success(`Moved ${selected.size} deals`);
      } catch {
        toast.error("Bulk move failed");
      }
    } else {
      try {
        await moveDealStage(id, stageId, businessId);
      } catch {
        toast.error("Move failed");
      }
    }
    await onChanged();
  }, [deals, draggedId, businessId, onChanged, selected]);

  const onSaveValue = async (dealId: string, raw: string) => {
    setEditingValue(null);
    const trimmed = raw.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed != null && !Number.isFinite(parsed)) return;
    try {
      await updateDeal(dealId, { value: parsed }, businessId);
      await onChanged();
    } catch {
      toast.error("Failed to update value");
    }
  };

  const onSaveOwner = async (dealId: string, raw: string) => {
    setEditingOwner(null);
    const trimmed = raw.trim();
    try {
      await updateDeal(dealId, { ownerUserId: trimmed === "" ? null : trimmed }, businessId);
      await onChanged();
    } catch {
      toast.error("Failed to update owner");
    }
  };

  const openReason = (dealId: string, kind: "WON" | "LOST") =>
    setReasonModal({ open: true, kind, dealId });

  const submitReason = async ({ reasonId, reasonNotes }: { reasonId: string | null; reasonNotes: string }) => {
    if (!reasonModal.dealId) return;
    try {
      if (reasonModal.kind === "WON") {
        await winDeal(reasonModal.dealId, { reasonId, reasonNotes }, businessId);
      } else {
        await loseDeal(reasonModal.dealId, { reasonId, reasonNotes }, businessId);
      }
    } finally {
      setReasonModal({ open: false, kind: "WON", dealId: null });
      await onChanged();
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <div>
      {selected.size > 1 && (
        <div className="text-xs text-muted-foreground mb-2 px-2 py-1.5 rounded-md border border-dashed border-border bg-card/40">
          {selected.size} deals selected — drag any selected card to a column to bulk-move.
          <button onClick={() => setSelected(new Set())} className="ml-2 underline hover:text-foreground">Clear</button>
        </div>
      )}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {visibleStages.map((stage) => {
            const stageDeals = grouped.get(stage.id) ?? [];
            const stageTotal = stageDeals.reduce((acc, d) => acc + (d.value ?? 0), 0);
            const isDragOver = dragOverStage === stage.id;
            const accent = stage.color || (stage.category === "WON" ? "#10b981" : stage.category === "LOST" ? "#ef4444" : "#0ea5e9");
            return (
              <div
                key={stage.id}
                onDragOver={(e) => onDragOver(e, stage.id)}
                onDrop={(e) => onDrop(e, stage.id)}
                onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
                className={`w-72 flex-shrink-0 rounded-xl border bg-card/40 flex flex-col max-h-[calc(100vh-18rem)] transition-all ${
                  isDragOver ? "border-[hsl(var(--kf-accent1))] ring-2 ring-[hsl(var(--kf-accent1))]/20" : "border-border/60"
                }`}
              >
                <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
                  <h3 className="text-xs font-semibold truncate flex-1">{stage.name}</h3>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{stageDeals.length}</span>
                </div>
                <div className="px-3 py-1.5 border-b border-border/30 flex items-center justify-between">
                  <span className="text-[10px] tabular-nums text-muted-foreground">{fmtMoney(stageTotal)}</span>
                  <button
                    onClick={() => setAddModal({ open: true, stageId: stage.id, stageName: stage.name })}
                    className="text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    title="Add deal to this stage"
                  >
                    <Plus className="w-3 h-3" /> Add deal
                  </button>
                </div>
                <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                  {stageDeals.length === 0 && (
                    <div className="flex items-center justify-center h-20 text-[11px] text-muted-foreground/40">
                      Drop deals here
                    </div>
                  )}
                  {stageDeals.map((d) => {
                    const score = d.healthScore;
                    const healthColor = score == null ? "#737373" : healthHexColor(score);
                    const isSelected = selected.has(d.id);
                    return (
                      <div
                        key={d.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, d.id)}
                        className={`group rounded-lg border bg-background p-2.5 cursor-grab active:cursor-grabbing transition-all hover:border-border ${
                          isSelected ? "border-[hsl(var(--kf-accent1))] ring-1 ring-[hsl(var(--kf-accent1))]/30" : "border-border/60"
                        } ${d.bottleneckFlag ? "shadow-[0_0_0_1px_rgb(245_158_11_/_0.4)]" : ""}`}
                      >
                        <div className="flex items-start gap-1.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(d.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 opacity-40 group-hover:opacity-100"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-xs font-medium truncate">{d.title}</span>
                              <GripVertical className="w-3 h-3 text-muted-foreground/30 flex-shrink-0 opacity-0 group-hover:opacity-100" />
                            </div>
                            {d.companyName && (
                              <div className="text-[10px] text-muted-foreground truncate mt-0.5">{d.companyName}</div>
                            )}
                            {d.contact && (
                              <Link href={`/app/crm?contactId=${d.contactId}`}
                                className="text-[10px] text-[hsl(var(--kf-accent2))] hover:underline truncate block mt-0.5">
                                {d.contact.displayName || `${d.contact.firstName ?? ""} ${d.contact.lastName ?? ""}`.trim() || d.contact.email}
                              </Link>
                            )}

                            {/* Health bar */}
                            <div
                              className="mt-2 h-1 rounded-full overflow-hidden bg-muted"
                              title={score == null ? "No health score yet" : `Health ${score}/100`}
                            >
                              <div
                                className="h-full transition-all"
                                style={{ width: `${Math.max(4, Math.min(100, score ?? 0))}%`, background: healthColor }}
                              />
                            </div>

                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              {/* Inline value editor */}
                              {editingValue === d.id ? (
                                <input
                                  autoFocus
                                  defaultValue={d.value ?? ""}
                                  onBlur={(e) => onSaveValue(d.id, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                                    if (e.key === "Escape") setEditingValue(null);
                                  }}
                                  className="text-[10px] tabular-nums bg-background border border-border rounded px-1 py-0.5 w-20"
                                />
                              ) : (
                                <button
                                  onClick={() => setEditingValue(d.id)}
                                  className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                  title="Click to edit value"
                                >
                                  {fmtMoney(d.value, d.currency)}
                                </button>
                              )}

                              {/* Owner */}
                              {editingOwner === d.id ? (
                                <input
                                  autoFocus
                                  defaultValue={d.ownerUserId ?? ""}
                                  placeholder="user id"
                                  onBlur={(e) => onSaveOwner(d.id, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                                    if (e.key === "Escape") setEditingOwner(null);
                                  }}
                                  className="text-[10px] bg-background border border-border rounded px-1 py-0.5 w-24"
                                />
                              ) : (
                                <button
                                  onClick={() => setEditingOwner(d.id)}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80"
                                  title="Click to set owner"
                                >
                                  {d.ownerUserId ? `@${d.ownerUserId.slice(0, 6)}` : "+ owner"}
                                </button>
                              )}

                              {d.bottleneckFlag && (
                                <span title="Stuck in stage longer than typical"
                                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-semibold uppercase">
                                  <AlertTriangle className="w-2.5 h-2.5" /> Stuck
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between mt-2">
                              <span className="text-[10px] text-muted-foreground">
                                {d.expectedCloseAt ? `Close ${new Date(d.expectedCloseAt).toLocaleDateString()}` : ""}
                              </span>
                              <div className="inline-flex items-center gap-0.5">
                                <button onClick={(e) => { e.stopPropagation(); openReason(d.id, "WON"); }}
                                  title="Mark won" className="p-1 rounded hover:bg-emerald-500/10 text-emerald-500">
                                  <Trophy className="w-3 h-3" />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); openReason(d.id, "LOST"); }}
                                  title="Mark lost" className="p-1 rounded hover:bg-red-500/10 text-red-400">
                                  <XCircle className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ReasonPickerModal
        open={reasonModal.open}
        kind={reasonModal.kind}
        reasons={reasons}
        onCancel={() => setReasonModal({ open: false, kind: "WON", dealId: null })}
        onSubmit={submitReason}
      />

      <AddDealModal
        open={addModal.open}
        businessId={businessId}
        stageId={addModal.stageId}
        stageName={addModal.stageName}
        onCancel={() => setAddModal({ open: false, stageId: null })}
        onCreated={async () => {
          setAddModal({ open: false, stageId: null });
          await onChanged();
        }}
      />
    </div>
  );
}
