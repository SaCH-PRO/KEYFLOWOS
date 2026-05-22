"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, FileText, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { listChangeOrders, createChangeOrder, updateChangeOrder, deleteChangeOrder } from "@/lib/change-orders";
import { useControlTowerData } from "../control-tower/components/use-control-tower-data";

interface ChangeOrderItem {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  additionalAmount: number | null;
  additionalHours: number | null;
  status: string;
  approvedAt: string | null;
  createdAt: string;
}

export default function ChangeOrdersPage() {
  const { businessId } = useControlTowerData();
  const [items, setItems] = useState<ChangeOrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ projectId: "", title: "", description: "", additionalAmount: "", additionalHours: "" });

  useEffect(() => {
    if (!businessId) return;
    loadData();
  }, [businessId]);

  async function loadData() {
    if (!businessId) return;
    setLoading(true);
    const res = await listChangeOrders(businessId);
    if (res.data) setItems(res.data);
    setLoading(false);
  }

  async function handleCreate() {
    if (!businessId) return;
    const res = await createChangeOrder(businessId, {
      projectId: form.projectId,
      title: form.title,
      description: form.description,
      additionalAmount: form.additionalAmount ? Number(form.additionalAmount) : undefined,
      additionalHours: form.additionalHours ? Number(form.additionalHours) : undefined,
    });
    if (res.data) {
      setShowForm(false);
      setForm({ projectId: "", title: "", description: "", additionalAmount: "", additionalHours: "" });
      loadData();
    }
  }

  async function handleApprove(id: string) {
    if (!businessId) return;
    await updateChangeOrder(businessId, id, { status: "APPROVED", approvedAt: new Date().toISOString() });
    loadData();
  }

  async function handleDelete(id: string) {
    if (!businessId || !confirm("Delete this change order?")) return;
    await deleteChangeOrder(businessId, id);
    loadData();
  }

  function statusIcon(status: string) {
    switch (status) {
      case "APPROVED": return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case "PENDING_APPROVAL": return <Clock className="w-4 h-4 text-amber-400" />;
      case "REJECTED": return <AlertCircle className="w-4 h-4 text-red-400" />;
      default: return <FileText className="w-4 h-4 text-muted-foreground" />;
    }
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Change Orders</h1>
          <p className="text-sm text-muted-foreground">Manage scope changes and client approvals</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white hover:brightness-110 text-sm font-medium transition-all"
        >
          <Plus className="w-4 h-4" />
          New Change Order
        </button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">New Change Order</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Project ID" value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
            <input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
            <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
            <input placeholder="Additional amount" type="number" value={form.additionalAmount} onChange={e => setForm({ ...form, additionalAmount: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
            <input placeholder="Additional hours" type="number" value={form.additionalHours} onChange={e => setForm({ ...form, additionalHours: e.target.value })} className="px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
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
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No change orders yet</div>
        ) : (
          <div className="divide-y divide-border">
            {items.map(item => (
              <div key={item.id} className="px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  {statusIcon(item.status)}
                  <div>
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.additionalAmount && <span>+${item.additionalAmount}</span>}
                      {item.additionalHours && <span> · +{item.additionalHours}h</span>}
                      <span> · {item.status}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {item.status === "PENDING_APPROVAL" && (
                    <button onClick={() => handleApprove(item.id)} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-colors">
                      Approve
                    </button>
                  )}
                  <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
