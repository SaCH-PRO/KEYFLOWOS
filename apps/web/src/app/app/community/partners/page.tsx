"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, Link2, Plus, X, CheckCircle2, XCircle } from "lucide-react";
import {
  listPartnerPrograms,
  proposePartnerProgram,
  respondToPartnerProgram,
  terminatePartnerProgram,
  searchDirectory,
  type PartnerProgram,
  type PartnerProgramType,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const PROGRAM_TYPES: { value: PartnerProgramType; label: string }[] = [
  { value: "REFERRAL", label: "Referral" },
  { value: "AFFILIATE", label: "Affiliate" },
  { value: "RESELLER", label: "Reseller" },
  { value: "JOINT_VENTURE", label: "Joint Venture" },
  { value: "STRATEGIC", label: "Strategic" },
  { value: "INTEGRATION", label: "Integration" },
];

export default function PartnersPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "proposed" | "all">("active");
  const [items, setItems] = useState<PartnerProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPropose, setShowPropose] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (bid) setBusinessId(bid);
  }, []);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const status = tab === "active" ? "ACTIVE" : tab === "proposed" ? "PROPOSED" : undefined;
    const r = await listPartnerPrograms(businessId, status);
    setItems(r.data ?? []);
    setLoading(false);
  }, [businessId, tab]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { void load(); }, [load]);

  const handleRespond = async (id: string, status: "ACTIVE" | "DECLINED") => {
    if (!businessId) return;
    await respondToPartnerProgram(businessId, id, { status });
    void load();
  };

  const handleTerminate = async (id: string) => {
    if (!businessId) return;
    if (!confirm("Terminate this partnership?")) return;
    await terminatePartnerProgram(businessId, id);
    void load();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => router.push("/app/community")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" />Back to Community
      </button>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10"><Link2 className="w-5 h-5 text-[hsl(var(--kf-accent1))]" /></div>
          <div>
            <h1 className="text-xl font-bold">Partner Programs</h1>
            <p className="text-xs text-muted-foreground">Affiliates, referrals, joint offers, and bundles</p>
          </div>
        </div>
        <button onClick={() => setShowPropose(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-xs font-medium hover:opacity-90">
          <Plus className="w-3.5 h-3.5" />Propose Partnership
        </button>
      </div>

      <div className="flex gap-1 border-b border-border/30">
        {(["active", "proposed", "all"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-xs font-medium capitalize ${tab === t ? "border-b-2 border-[hsl(var(--kf-accent1))] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">{[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted/20 rounded-xl" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No partnerships {tab === "active" ? "active" : tab === "proposed" ? "pending" : "yet"}</div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => {
            const isInitiator = p.initiatorBusinessId === businessId;
            const counterparty = isInitiator ? p.partner : p.initiator;
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="kf-card rounded-xl p-4 border border-border/30">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">{p.programType}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-400" : p.status === "PROPOSED" ? "bg-amber-500/10 text-amber-400" : "bg-muted/20 text-muted-foreground"}`}>{p.status}</span>
                    </div>
                    <h3 className="text-sm font-semibold">{p.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {isInitiator ? "with" : "from"} <span className="cursor-pointer hover:underline" onClick={() => counterparty && router.push(`/app/community/profile/${counterparty.id}`)}>{counterparty?.name}</span>
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{p.description}</p>
                {p.commissionRate != null && (
                  <p className="text-xs"><span className="text-muted-foreground">Commission:</span> {p.commissionRate}%</p>
                )}
                {(() => {
                  const terms = p.terms as string | { notes?: string } | null | undefined;
                  if (typeof terms === "string" && terms) return <p className="text-xs text-muted-foreground mt-2 italic">{terms}</p>;
                  if (terms && typeof terms === "object" && terms.notes) return <p className="text-xs text-muted-foreground mt-2 italic">{terms.notes}</p>;
                  return null;
                })()}

                <div className="flex gap-2 mt-3">
                  {p.status === "PROPOSED" && !isInitiator && (
                    <>
                      <button onClick={() => handleRespond(p.id, "ACTIVE")} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />Accept
                      </button>
                      <button onClick={() => handleRespond(p.id, "DECLINED")} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-500/10 text-red-400">
                        <XCircle className="w-3 h-3" />Decline
                      </button>
                    </>
                  )}
                  {p.status === "ACTIVE" && (
                    <button onClick={() => handleTerminate(p.id)} className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400">Terminate</button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {showPropose && businessId && (
        <ProposeModal businessId={businessId} onClose={() => setShowPropose(false)} onProposed={() => { setShowPropose(false); setTab("proposed"); void load(); }} />
      )}
    </div>
  );
}

function ProposeModal({ businessId, onClose, onProposed }: { businessId: string; onClose: () => void; onProposed: () => void }) {
  const [form, setForm] = useState({
    partnerBusinessId: "",
    programType: "REFERRAL" as PartnerProgramType,
    name: "",
    description: "",
    commissionRate: "",
    terms: "",
  });
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; logoUrl?: string | null; industry?: string | null; headline?: string | null }>>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (search.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await searchDirectory({ search, limit: "5" });
      setResults(r.data?.data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const submit = async () => {
    setSubmitting(true);
    await proposePartnerProgram(businessId, {
      partnerBusinessId: form.partnerBusinessId,
      programType: form.programType,
      name: form.name,
      description: form.description,
      commissionRate: form.commissionRate ? Number(form.commissionRate) : null,
      terms: form.terms ? { notes: form.terms } : null,
    });
    setSubmitting(false);
    onProposed();
  };

  const selectedPartnerName = results.find((r) => r.id === form.partnerBusinessId)?.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="kf-card rounded-2xl border border-border/30 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <h2 className="text-sm font-semibold">Propose Partnership</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted/30"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search business by name..." className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
            {selectedPartnerName && <p className="text-xs text-emerald-400 mt-1">Selected: {selectedPartnerName}</p>}
            {results.length > 0 && !form.partnerBusinessId && (
              <div className="mt-1 border border-border/30 rounded-lg max-h-40 overflow-y-auto">
                {results.map((r) => (
                  <button key={r.id} onClick={() => { setForm({ ...form, partnerBusinessId: r.id }); setResults([r]); setSearch(r.name); }} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/20">
                    <p className="font-medium">{r.name}</p>
                    {r.headline && <p className="text-xs text-muted-foreground">{r.headline}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <select value={form.programType} onChange={(e) => setForm({ ...form, programType: e.target.value as PartnerProgramType })} className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm">
            {PROGRAM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Program name" className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the partnership" rows={3} className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <input value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} type="number" placeholder="Commission rate (%)" className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="Terms (optional)" rows={2} className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <button disabled={submitting || !form.partnerBusinessId || !form.name || !form.description} onClick={submit} className="w-full py-2 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium disabled:opacity-50">{submitting ? "Sending..." : "Send Proposal"}</button>
        </div>
      </div>
    </div>
  );
}
