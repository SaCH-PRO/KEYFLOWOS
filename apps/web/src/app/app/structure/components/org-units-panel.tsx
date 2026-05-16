"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Plus, Trash2, Edit3, ChevronRight, ChevronDown, Loader2, X, Check } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchOrgUnits,
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  type OrgUnit,
} from "@/lib/client";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const UNIT_TYPES = ["BRANCH", "DEPARTMENT", "DIVISION", "TEAM", "WAREHOUSE"];

function typeLabel(type: string) {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

function typeColor(type: string) {
  switch (type) {
    case "BRANCH": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "DEPARTMENT": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "DIVISION": return "bg-violet-500/10 text-violet-400 border-violet-500/20";
    case "TEAM": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "WAREHOUSE": return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    default: return "bg-muted text-muted-foreground";
  }
}

export function OrgUnitsPanel() {
  const businessId = getStoredBusinessId();
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    type: "DEPARTMENT",
    address: "",
    city: "",
    country: "",
    phone: "",
    email: "",
    parentId: "",
  });

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await fetchOrgUnits(businessId);
    if (res.data) setUnits(res.data);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!businessId) return;
      const res = await fetchOrgUnits(businessId);
      if (!cancelled && res.data) setUnits(res.data);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const unitsByParent = useMemo(() => {
    const map: Record<string, OrgUnit[]> = {};
    for (const u of units) {
      const pid = u.parentId ?? "root";
      if (!map[pid]) map[pid] = [];
      map[pid].push(u);
    }
    return map;
  }, [units]);

  const resetForm = () => {
    setForm({ name: "", type: "DEPARTMENT", address: "", city: "", country: "", phone: "", email: "", parentId: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!businessId || !form.name.trim()) return;
    const payload: Omit<OrgUnit, "id" | "businessId" | "createdAt" | "updatedAt" | "children"> = {
      name: form.name.trim(),
      type: form.type,
      address: form.address || undefined,
      city: form.city || undefined,
      country: form.country || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      parentId: form.parentId || undefined,
      managerId: undefined,
    };
    if (editingId) {
      const res = await updateOrgUnit(businessId, editingId, payload);
      if (res.data) {
        toast.success("Org unit updated");
        resetForm();
        load();
      } else toast.error("Failed to update");
    } else {
      const res = await createOrgUnit(businessId, payload);
      if (res.data) {
        toast.success("Org unit created");
        resetForm();
        load();
      } else toast.error("Failed to create");
    }
  };

  const handleEdit = (u: OrgUnit) => {
    setForm({
      name: u.name,
      type: u.type,
      address: u.address ?? "",
      city: u.city ?? "",
      country: u.country ?? "",
      phone: u.phone ?? "",
      email: u.email ?? "",
      parentId: u.parentId ?? "",
    });
    setEditingId(u.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    const res = await deleteOrgUnit(businessId, id);
    if (res.data) {
      toast.success("Org unit deleted");
      load();
    } else toast.error("Failed to delete");
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderTree = (parentId: string | null, depth = 0) => {
    const list = unitsByParent[parentId ?? "root"] ?? [];
    return list.map((u) => {
      const hasChildren = (unitsByParent[u.id]?.length ?? 0) > 0;
      const isExpanded = expanded.has(u.id);
      return (
        <div key={u.id}>
          <div
            className="flex items-center gap-2 py-2 border-b border-border/30 hover:bg-muted/30 transition-colors"
            style={{ paddingLeft: `${depth * 24 + 8}px` }}
          >
            <button
              onClick={() => hasChildren && toggleExpand(u.id)}
              className="w-5 h-5 flex items-center justify-center text-muted-foreground"
            >
              {hasChildren ? (
                isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <span className="w-3.5" />
              )}
            </button>
            <div className={`text-[10px] px-1.5 py-0.5 rounded border ${typeColor(u.type)}`}>
              {typeLabel(u.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{u.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {[u.city, u.country].filter(Boolean).join(", ") || "No location"}
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => handleEdit(u)} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setConfirmDeleteId(u.id)}
                className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {isExpanded && hasChildren && renderTree(u.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Organizational Units</h3>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium"
          style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? "Cancel" : "Add Unit"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
                placeholder="e.g. Main Branch"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              >
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>{typeLabel(t)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Parent Unit</label>
              <select
                value={form.parentId}
                onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              >
                <option value="">None (root)</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">City</label>
              <input
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
                placeholder="City"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Country</label>
              <input
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
                placeholder="Country"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
                placeholder="Phone"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Email</label>
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
                placeholder="Email"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
                placeholder="Address"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="h-8 px-3 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1.5"
              style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
            >
              <Check className="w-3.5 h-3.5" />
              {editingId ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete org unit?"
        message="This cannot be undone. Child units will be orphaned."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (confirmDeleteId) handleDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
          {units.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Building2 className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-sm">No org units yet</p>
              <p className="text-xs mt-1">Add branches, departments, or teams to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">{renderTree(null)}</div>
          )}
        </div>
      )}
    </div>
  );
}
