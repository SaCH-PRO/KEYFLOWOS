"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Briefcase,
  Plus,
  Search,
  MapPin,
  DollarSign,
  Clock,
  Send,
  X,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import {
  listOpportunities,
  createOpportunity,
  applyToOpportunity,
  listMyOpportunities,
  listMyOpportunityApplications,
  closeOpportunity,
  deleteOpportunity,
  respondToOpportunityApplication,
  getOpportunity,
  type Opportunity,
  type OpportunityApplication,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const TYPES: { value: string; label: string }[] = [
  { value: "JOB", label: "Job" },
  { value: "PROJECT", label: "Project" },
  { value: "COLLABORATION", label: "Collaboration" },
  { value: "CONTRACT", label: "Contract" },
  { value: "GIG", label: "Gig" },
];

export default function OpportunitiesPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [tab, setTab] = useState<"browse" | "mine" | "applications">("browse");
  const [items, setItems] = useState<Opportunity[]>([]);
  const [mine, setMine] = useState<Opportunity[]>([]);
  const [apps, setApps] = useState<OpportunityApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<(Opportunity & { applications?: OpportunityApplication[] }) | null>(null);
  const [applyModal, setApplyModal] = useState<Opportunity | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    if (tab === "browse") {
      const r = await listOpportunities({ search: search || undefined, type: typeFilter || undefined, status: "OPEN" });
      setItems(r.data?.data ?? []);
    } else if (tab === "mine" && businessId) {
      const r = await listMyOpportunities(businessId);
      setMine(r.data ?? []);
    } else if (tab === "applications" && businessId) {
      const r = await listMyOpportunityApplications(businessId);
      setApps(r.data ?? []);
    }
    setLoading(false);
  }, [tab, businessId, search, typeFilter]);

  useEffect(() => { void load(); }, [load]);

  const openDetails = useCallback(async (id: string) => {
    const r = await getOpportunity(id);
    if (r.data) setSelected(r.data);
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={() => router.push("/app/community")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" />Back to Community
      </button>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10"><Briefcase className="w-5 h-5 text-[hsl(var(--kf-accent1))]" /></div>
          <div>
            <h1 className="text-xl font-bold">Opportunity Board</h1>
            <p className="text-xs text-muted-foreground">Find work, post projects, build partnerships</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-xs font-medium hover:opacity-90">
          <Plus className="w-3.5 h-3.5" />Post Opportunity
        </button>
      </div>

      <div className="flex gap-1 border-b border-border/30">
        {(["browse", "mine", "applications"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-xs font-medium capitalize ${tab === t ? "border-b-2 border-[hsl(var(--kf-accent1))] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "applications" ? "My Applications" : t === "mine" ? "My Posts" : "Browse"}
          </button>
        ))}
      </div>

      {tab === "browse" && (
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search opportunities..." className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm">
            <option value="">All Types</option>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 animate-pulse">{[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted/20 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {tab === "browse" && items.length === 0 && <EmptyState text="No open opportunities found" />}
          {tab === "browse" && items.map((o) => <OpportunityCard key={o.id} o={o} onOpen={() => openDetails(o.id)} onApply={() => setApplyModal(o)} />)}
          {tab === "mine" && mine.length === 0 && <EmptyState text="You haven't posted any opportunities yet" />}
          {tab === "mine" && mine.map((o) => (
            <OpportunityCard key={o.id} o={o} onOpen={() => openDetails(o.id)} actions={
              <div className="flex gap-2">
                {o.status === "OPEN" && (
                  <button onClick={async (e) => { e.stopPropagation(); await closeOpportunity(businessId!, o.id); void load(); }} className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-400">Close</button>
                )}
                <button onClick={async (e) => { e.stopPropagation(); if (confirm("Delete opportunity?")) { await deleteOpportunity(businessId!, o.id); void load(); } }} className="text-xs p-1 rounded hover:bg-red-500/10 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            } />
          ))}
          {tab === "applications" && apps.length === 0 && <EmptyState text="You haven't applied to any opportunities yet" />}
          {tab === "applications" && apps.map((a) => (
            <div key={a.id} className="kf-card rounded-xl p-4 border border-border/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{a.opportunity?.title}</h3>
                <StatusBadge status={a.status} />
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{a.message}</p>
              {a.proposedBudget && <p className="text-xs mt-2">Proposed: ${a.proposedBudget}</p>}
              <p className="text-[10px] text-muted-foreground/60 mt-2">Applied {new Date(a.createdAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}

      {showCreate && businessId && (
        <CreateOpportunityModal businessId={businessId} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />
      )}

      {applyModal && businessId && (
        <ApplyModal businessId={businessId} opportunity={applyModal} onClose={() => setApplyModal(null)} onApplied={() => { setApplyModal(null); setTab("applications"); void load(); }} />
      )}

      {selected && (
        <DetailsModal opp={selected} businessId={businessId} onClose={() => setSelected(null)} onRespond={async (appId, status) => {
          await respondToOpportunityApplication(businessId!, appId, { status });
          const r = await getOpportunity(selected.id);
          if (r.data) setSelected(r.data);
        }} />
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-center py-12 text-sm text-muted-foreground">{text}</div>;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    OPEN: "bg-emerald-500/10 text-emerald-400",
    CLOSED: "bg-muted/20 text-muted-foreground",
    AWARDED: "bg-blue-500/10 text-blue-400",
    SUBMITTED: "bg-amber-500/10 text-amber-400",
    SHORTLISTED: "bg-blue-500/10 text-blue-400",
    DECLINED: "bg-red-500/10 text-red-400",
    WITHDRAWN: "bg-muted/20 text-muted-foreground",
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full ${colors[status] ?? "bg-muted/20"}`}>{status}</span>;
}

function OpportunityCard({ o, onOpen, onApply, actions }: { o: Opportunity; onOpen: () => void; onApply?: () => void; actions?: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="kf-card rounded-xl p-4 border border-border/30 hover:bg-white/[0.03] cursor-pointer" onClick={onOpen}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">{o.type}</span>
            <StatusBadge status={o.status} />
          </div>
          <h3 className="text-sm font-semibold">{o.title}</h3>
          {o.poster && <p className="text-xs text-muted-foreground">by {o.poster.name}</p>}
        </div>
        {actions}
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{o.description}</p>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
        {(o.budgetMin || o.budgetMax) && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{o.budgetMin}{o.budgetMax ? `-${o.budgetMax}` : "+"} {o.currency}</span>}
        {o.timeline && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{o.timeline}</span>}
        {o.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{o.location}</span>}
        {o.remoteOk && <span className="text-emerald-400">Remote</span>}
        {o._count && <span className="ml-auto">{o._count.applications} applications</span>}
      </div>
      {onApply && o.status === "OPEN" && (
        <button onClick={(e) => { e.stopPropagation(); onApply(); }} className="mt-3 flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))] hover:underline">
          <Send className="w-3 h-3" />Apply
        </button>
      )}
    </motion.div>
  );
}

function CreateOpportunityModal({ businessId, onClose, onCreated }: { businessId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", type: "PROJECT", category: "", budgetMin: "", budgetMax: "", currency: "TTD", timeline: "", location: "", remoteOk: false, skillsRequired: "" });
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    await createOpportunity(businessId, {
      title: form.title,
      description: form.description,
      type: form.type as any,
      category: form.category || null,
      budgetMin: form.budgetMin ? Number(form.budgetMin) : null,
      budgetMax: form.budgetMax ? Number(form.budgetMax) : null,
      currency: form.currency,
      timeline: form.timeline || null,
      location: form.location || null,
      remoteOk: form.remoteOk,
      skillsRequired: form.skillsRequired.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setSubmitting(false);
    onCreated();
  };
  return (
    <Modal onClose={onClose} title="Post New Opportunity">
      <div className="space-y-3">
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" rows={4} className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm">
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input value={form.budgetMin} onChange={(e) => setForm({ ...form, budgetMin: e.target.value })} placeholder="Budget Min" type="number" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <input value={form.budgetMax} onChange={(e) => setForm({ ...form, budgetMax: e.target.value })} placeholder="Budget Max" type="number" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="Currency" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })} placeholder="Timeline (e.g. 2 weeks)" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Location" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
        </div>
        <input value={form.skillsRequired} onChange={(e) => setForm({ ...form, skillsRequired: e.target.value })} placeholder="Skills required (comma separated)" className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={form.remoteOk} onChange={(e) => setForm({ ...form, remoteOk: e.target.checked })} /> Remote OK
        </label>
        <button disabled={submitting || !form.title || !form.description} onClick={submit} className="w-full py-2 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium disabled:opacity-50">{submitting ? "Posting..." : "Post Opportunity"}</button>
      </div>
    </Modal>
  );
}

function ApplyModal({ businessId, opportunity, onClose, onApplied }: { businessId: string; opportunity: Opportunity; onClose: () => void; onApplied: () => void }) {
  const [message, setMessage] = useState("");
  const [proposedBudget, setProposedBudget] = useState("");
  const [proposedTimeline, setProposedTimeline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    await applyToOpportunity(businessId, opportunity.id, {
      message,
      proposedBudget: proposedBudget ? Number(proposedBudget) : undefined,
      proposedTimeline: proposedTimeline || undefined,
    });
    setSubmitting(false);
    onApplied();
  };
  return (
    <Modal onClose={onClose} title={`Apply: ${opportunity.title}`}>
      <div className="space-y-3">
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Why are you a good fit?" rows={4} className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input value={proposedBudget} onChange={(e) => setProposedBudget(e.target.value)} placeholder="Your budget" type="number" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <input value={proposedTimeline} onChange={(e) => setProposedTimeline(e.target.value)} placeholder="Your timeline" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
        </div>
        <button disabled={submitting || !message} onClick={submit} className="w-full py-2 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium disabled:opacity-50">{submitting ? "Sending..." : "Submit Application"}</button>
      </div>
    </Modal>
  );
}

function DetailsModal({ opp, businessId, onClose, onRespond }: { opp: Opportunity & { applications?: OpportunityApplication[] }; businessId: string | null; onClose: () => void; onRespond: (appId: string, status: "SHORTLISTED" | "AWARDED" | "DECLINED") => Promise<void> }) {
  const isOwner = businessId === opp.posterBusinessId;
  return (
    <Modal onClose={onClose} title={opp.title}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">{opp.type}</span>
          <StatusBadge status={opp.status} />
        </div>
        {opp.poster && <p className="text-xs text-muted-foreground">Posted by {opp.poster.name}</p>}
        <p className="whitespace-pre-wrap">{opp.description}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {opp.budgetMin && <div><span className="text-muted-foreground">Budget:</span> ${opp.budgetMin}{opp.budgetMax ? `-${opp.budgetMax}` : "+"} {opp.currency}</div>}
          {opp.timeline && <div><span className="text-muted-foreground">Timeline:</span> {opp.timeline}</div>}
          {opp.location && <div><span className="text-muted-foreground">Location:</span> {opp.location}</div>}
          {opp.remoteOk && <div className="text-emerald-400">Remote OK</div>}
        </div>
        {opp.skillsRequired.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {opp.skillsRequired.map((s) => <span key={s} className="text-[10px] px-2 py-0.5 rounded bg-muted/30">{s}</span>)}
          </div>
        )}
        {isOwner && opp.applications && opp.applications.length > 0 && (
          <div className="border-t border-border/30 pt-3 mt-3">
            <h4 className="text-xs font-semibold mb-2">Applications ({opp.applications.length})</h4>
            <div className="space-y-2">
              {opp.applications.map((a) => (
                <div key={a.id} className="p-3 rounded-lg bg-muted/10 border border-border/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{a.applicant?.name}</span>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{a.message}</p>
                  {a.status === "SUBMITTED" && (
                    <div className="flex gap-2">
                      <button onClick={() => onRespond(a.id, "SHORTLISTED")} className="text-[11px] px-2 py-1 rounded bg-blue-500/10 text-blue-400">Shortlist</button>
                      <button onClick={() => onRespond(a.id, "AWARDED")} className="text-[11px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">Award</button>
                      <button onClick={() => onRespond(a.id, "DECLINED")} className="text-[11px] px-2 py-1 rounded bg-red-500/10 text-red-400">Decline</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Modal({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="kf-card rounded-2xl border border-border/30 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted/30"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
