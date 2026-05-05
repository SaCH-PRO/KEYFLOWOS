"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Plus, Trophy, XCircle, DollarSign, Calendar, Tag } from "lucide-react";
import {
  fetchContactDeals,
  fetchDealStages,
  createDeal,
  moveDealStage,
  winDeal,
  loseDeal,
  deleteDeal,
  type Deal,
  type DealStage,
} from "@/lib/client";
import type { ContactDetailData } from "./contact-detail";

interface Props {
  contact: ContactDetailData;
  businessId?: string | null;
}

function fmtMoney(value: number | null | undefined, currency: string = "TTD") {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-TT", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

export function DealsTabPanel({ contact, businessId }: Props) {
  const [stages, setStages] = useState<DealStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        fetchDealStages(businessId),
        fetchContactDeals(contact.id, { status: "ALL" }, businessId),
      ]);
      if (s.data) setStages(s.data);
      if (d.data) setDeals(d.data);
    } finally {
      setLoading(false);
    }
  }, [businessId, contact.id]);

  useEffect(() => { reload(); }, [reload]);

  const handleMove = async (dealId: string, stageId: string) => {
    if (!businessId) return;
    setBusyId(dealId);
    try {
      await moveDealStage(dealId, stageId, businessId);
      await reload();
    } finally { setBusyId(null); }
  };

  const handleWin = async (dealId: string) => {
    if (!businessId) return;
    setBusyId(dealId);
    try { await winDeal(dealId, {}, businessId); await reload(); } finally { setBusyId(null); }
  };

  const handleLose = async (dealId: string) => {
    if (!businessId) return;
    const reason = window.prompt("Loss reason (optional):") ?? undefined;
    setBusyId(dealId);
    try { await loseDeal(dealId, { lossReason: reason || undefined }, businessId); await reload(); } finally { setBusyId(null); }
  };

  const handleDelete = async (dealId: string) => {
    if (!businessId) return;
    if (!window.confirm("Delete this deal?")) return;
    setBusyId(dealId);
    try { await deleteDeal(dealId, businessId); await reload(); } finally { setBusyId(null); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  const open = deals.filter((d) => d.status === "OPEN");
  const closed = deals.filter((d) => d.status !== "OPEN");

  return (
    <div className="space-y-4 px-1">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {deals.length} deal{deals.length === 1 ? "" : "s"} · {open.length} open
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> New deal
        </button>
      </div>

      {showCreate && (
        <CreateDealInline
          contactId={contact.id}
          businessId={businessId!}
          stages={stages}
          onCancel={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await reload(); }}
        />
      )}

      {deals.length === 0 && !showCreate && (
        <div className="text-center py-10 text-sm text-muted-foreground border border-dashed rounded-lg">
          No deals yet. Create the first one.
        </div>
      )}

      <div className="space-y-2">
        {open.map((d) => (
          <DealRow
            key={d.id}
            deal={d}
            stages={stages}
            busy={busyId === d.id}
            onMove={(s) => handleMove(d.id, s)}
            onWin={() => handleWin(d.id)}
            onLose={() => handleLose(d.id)}
            onDelete={() => handleDelete(d.id)}
          />
        ))}
        {closed.length > 0 && (
          <div className="pt-3 mt-3 border-t border-border">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-2">Closed</div>
            {closed.map((d) => (
              <DealRow
                key={d.id}
                deal={d}
                stages={stages}
                busy={busyId === d.id}
                onMove={(s) => handleMove(d.id, s)}
                onWin={() => handleWin(d.id)}
                onLose={() => handleLose(d.id)}
                onDelete={() => handleDelete(d.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DealRow({
  deal, stages, busy, onMove, onWin, onLose, onDelete,
}: {
  deal: Deal;
  stages: DealStage[];
  busy: boolean;
  onMove: (stageId: string) => void;
  onWin: () => void;
  onLose: () => void;
  onDelete: () => void;
}) {
  const statusBadge = deal.status === "WON"
    ? "bg-emerald-500/15 text-emerald-500"
    : deal.status === "LOST"
    ? "bg-red-500/15 text-red-500"
    : "bg-sky-500/15 text-sky-500";

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-medium text-sm truncate">{deal.title}</div>
            <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-semibold ${statusBadge}`}>{deal.status}</span>
          </div>
          {deal.description && <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{deal.description}</div>}
        </div>
        <button onClick={onDelete} disabled={busy} className="text-[10px] text-muted-foreground hover:text-red-400">Delete</button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{fmtMoney(deal.value, deal.currency)}</span>
        {deal.expectedCloseAt && (
          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(deal.expectedCloseAt).toLocaleDateString()}</span>
        )}
        {deal.tags.length > 0 && (
          <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{deal.tags.join(", ")}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={deal.stageId}
          disabled={busy}
          onChange={(e) => onMove(e.target.value)}
          className="text-xs bg-background border border-border rounded px-2 py-1"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {deal.status === "OPEN" && (
          <>
            <button onClick={onWin} disabled={busy} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500">
              <Trophy className="w-3 h-3" /> Won
            </button>
            <button onClick={onLose} disabled={busy} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400">
              <XCircle className="w-3 h-3" /> Lost
            </button>
          </>
        )}
        {deal.status === "LOST" && deal.lossReason && (
          <span className="text-[11px] text-red-400/80">Reason: {deal.lossReason}</span>
        )}
      </div>
    </div>
  );
}

function CreateDealInline({
  contactId, businessId, stages, onCancel, onCreated,
}: {
  contactId: string; businessId: string; stages: DealStage[]; onCancel: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [stageId, setStageId] = useState<string>(stages.find((s) => s.category === "OPEN")?.id ?? stages[0]?.id ?? "");
  const [expectedCloseAt, setExpectedCloseAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await createDeal({
        contactId,
        title: title.trim(),
        value: value ? Number(value) : undefined,
        stageId: stageId || undefined,
        expectedCloseAt: expectedCloseAt || undefined,
      }, businessId);
      onCreated();
    } finally { setSubmitting(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
      <input
        className="w-full text-sm bg-background border border-border rounded px-2 py-1.5"
        placeholder="Deal title (e.g. Spring catering contract)"
        value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
      />
      <div className="flex flex-wrap gap-2">
        <input
          className="flex-1 min-w-[120px] text-sm bg-background border border-border rounded px-2 py-1.5"
          placeholder="Value (TTD)" type="number" value={value} onChange={(e) => setValue(e.target.value)}
        />
        <select
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
          value={stageId} onChange={(e) => setStageId(e.target.value)}
        >
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
          type="date" value={expectedCloseAt} onChange={(e) => setExpectedCloseAt(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded text-muted-foreground hover:text-foreground">Cancel</button>
        <button
          onClick={submit} disabled={submitting || !title.trim()}
          className="text-xs px-3 py-1.5 rounded bg-[hsl(var(--kf-accent1))] text-white font-medium disabled:opacity-50"
        >{submitting ? "Creating…" : "Create deal"}</button>
      </div>
    </div>
  );
}
