"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Calendar, DollarSign, Clock, RefreshCw } from "lucide-react";
import { listRetainers, getRetainerSummary, createRetainer, deleteRetainer } from "@/lib/retainers";
import { useControlTowerData } from "../control-tower/components/use-control-tower-data";

interface Retainer {
  id: string;
  name: string;
  monthlyAmount: number;
  startDate: string;
  endDate: string | null;
  includedHours: number | null;
  rolloverHours: boolean;
  status: string;
  periods: { hoursUsed: number; amountBilled: number; status: string }[];
}

export default function RetainersPage() {
  const { businessId } = useControlTowerData();
  const [retainers, setRetainers] = useState<Retainer[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, totalRevenue: 0 });
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    contactId: "",
    name: "",
    monthlyAmount: "",
    startDate: "",
    endDate: "",
    includedHours: "",
    rolloverHours: false,
  });

  async function loadData() {
    if (!businessId) return;
    setLoading(true);
    const [rRes, sRes] = await Promise.all([
      listRetainers(businessId),
      getRetainerSummary(businessId),
    ]);
    if (rRes.data) setRetainers(rRes.data);
    if (sRes.data) setSummary(sRes.data);
    setLoading(false);
  }

  useEffect(() => {
    if (!businessId) return;
    queueMicrotask(loadData);
  }, [businessId]);

  async function handleCreate() {
    if (!businessId) return;
    const res = await createRetainer(businessId, {
      contactId: form.contactId || "dev-contact",
      name: form.name,
      monthlyAmount: Number(form.monthlyAmount),
      startDate: form.startDate || new Date().toISOString(),
      endDate: form.endDate || undefined,
      includedHours: form.includedHours ? Number(form.includedHours) : undefined,
      rolloverHours: form.rolloverHours,
    });
    if (res.data) {
      setShowForm(false);
      setForm({ contactId: "", name: "", monthlyAmount: "", startDate: "", endDate: "", includedHours: "", rolloverHours: false });
      loadData();
    }
  }

  async function handleDelete(id: string) {
    if (!businessId || !confirm("Delete this retainer agreement?")) return;
    await deleteRetainer(businessId, id);
    loadData();
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Retainer Agreements</h1>
          <p className="text-sm text-muted-foreground">Manage recurring client contracts</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white hover:brightness-110 text-sm font-medium transition-all"
        >
          <Plus className="w-4 h-4" />
          New Retainer
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<RefreshCw className="w-4 h-4 text-blue-400" />} label="Total" value={String(summary.total)} />
        <StatCard icon={<Calendar className="w-4 h-4 text-emerald-400" />} label="Active" value={String(summary.active)} />
        <StatCard icon={<DollarSign className="w-4 h-4 text-amber-400" />} label="Revenue" value={`$${summary.totalRevenue.toFixed(0)}`} />
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">New Retainer Agreement</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Client name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
            <input placeholder="Monthly amount" type="number" value={form.monthlyAmount} onChange={e => setForm({ ...form, monthlyAmount: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
            <input placeholder="Start date" type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
            <input placeholder="End date (optional)" type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
            <input placeholder="Included hours" type="number" value={form.includedHours} onChange={e => setForm({ ...form, includedHours: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.rolloverHours} onChange={e => setForm({ ...form, rolloverHours: e.target.checked })} />
              Rollover hours
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white text-sm font-medium">Create</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-muted text-sm">Cancel</button>
          </div>
        </motion.div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : retainers.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No retainer agreements yet</div>
        ) : (
          <div className="divide-y divide-border">
            {retainers.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{r.status}</span>
                    <span>${r.monthlyAmount}/mo</span>
                    {r.includedHours && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{r.includedHours}h included</span>}
                  </div>
                </div>
                <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
