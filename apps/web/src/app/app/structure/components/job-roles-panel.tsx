"use client";

import { useEffect, useState } from "react";
import { Briefcase, Plus, Trash2, Edit3, Loader2, X, Check, Shield } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchJobRoles,
  createJobRole,
  updateJobRole,
  deleteJobRole,
  type JobRole,
} from "@/lib/client";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const PERMISSION_MODULES = [
  { key: "crm", label: "CRM" },
  { key: "revenue", label: "Revenue" },
  { key: "bookings", label: "Bookings" },
  { key: "projects", label: "Projects" },
  { key: "content", label: "Content" },
  { key: "expenses", label: "Expenses" },
  { key: "automations", label: "Automations" },
  { key: "storefront", label: "Storefront" },
  { key: "settings", label: "Settings" },
  { key: "ai", label: "AI" },
  { key: "team", label: "Team" },
];

const PERMISSION_LEVELS = ["none", "read", "write", "admin"] as const;

export function JobRolesPanel() {
  const businessId = getStoredBusinessId();
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    level: 0,
    defaultApprovalTier: 0,
    color: "#64748b",
    permissions: {} as Record<string, string>,
  });

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await fetchJobRoles(businessId);
    if (res.data) setRoles(res.data);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!businessId) return;
      const res = await fetchJobRoles(businessId);
      if (!cancelled && res.data) setRoles(res.data);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const resetForm = () => {
    setForm({ name: "", description: "", level: 0, defaultApprovalTier: 0, color: "#64748b", permissions: {} });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!businessId || !form.name.trim()) return;
    const payload = { ...form };
    if (editingId) {
      const res = await updateJobRole(businessId, editingId, payload);
      if (res.data) {
        toast.success("Role updated");
        resetForm();
        load();
      } else toast.error("Failed to update");
    } else {
      const res = await createJobRole(businessId, payload);
      if (res.data) {
        toast.success("Role created");
        resetForm();
        load();
      } else toast.error("Failed to create");
    }
  };

  const handleEdit = (r: JobRole) => {
    setForm({
      name: r.name,
      description: r.description ?? "",
      level: r.level,
      defaultApprovalTier: r.defaultApprovalTier,
      color: r.color ?? "#64748b",
      permissions: (r.permissions as Record<string, string>) ?? {},
    });
    setEditingId(r.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    const res = await deleteJobRole(businessId, id);
    if (res.data) {
      toast.success("Role deleted");
      load();
    } else toast.error("Failed to delete");
  };

  const setPermission = (module: string, level: string) => {
    setForm((f) => ({
      ...f,
      permissions: { ...f.permissions, [module]: level },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Job Roles</h3>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium"
          style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? "Cancel" : "Add Role"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
                placeholder="e.g. Branch Manager"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Level</label>
              <input
                type="number"
                min={0}
                max={10}
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: parseInt(e.target.value) || 0 }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Approval Tier</label>
              <input
                type="number"
                min={0}
                max={10}
                value={form.defaultApprovalTier}
                onChange={(e) => setForm((f) => ({ ...f, defaultApprovalTier: parseInt(e.target.value) || 0 }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              placeholder="Role description"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Permissions</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {PERMISSION_MODULES.map((m) => (
                <div key={m.key} className="flex items-center gap-2">
                  <span className="text-xs w-20 truncate">{m.label}</span>
                  <select
                    value={form.permissions[m.key] ?? "none"}
                    onChange={(e) => setPermission(m.key, e.target.value)}
                    className="h-7 px-1.5 rounded border border-border bg-background text-[11px]"
                  >
                    {PERMISSION_LEVELS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              ))}
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
        title="Delete role?"
        message="Assigned staff will lose this role mapping."
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {roles.length === 0 && (
            <div className="md:col-span-2 flex flex-col items-center justify-center py-12 text-muted-foreground rounded-xl border border-border/60 bg-card/40">
              <Briefcase className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-sm">No job roles yet</p>
              <p className="text-xs mt-1">Define roles like Technician, Manager, or Sales Rep</p>
            </div>
          )}
          {roles.map((r) => (
            <div key={r.id} className="rounded-xl border border-border/60 bg-card/40 p-4 group">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-md flex items-center justify-center"
                    style={{ background: `${r.color ?? "#64748b"}20`, color: r.color ?? "#64748b" }}
                  >
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      L{r.level} · Tier {r.defaultApprovalTier} approval
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleEdit(r)} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(r.id)}
                    className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {r.description && (
                <p className="text-xs text-muted-foreground mt-2">{r.description}</p>
              )}
              {r.permissions && Object.keys(r.permissions as Record<string, string>).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {Object.entries(r.permissions as Record<string, string>).map(([mod, perm]) => (
                    <span key={mod} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">
                      {mod}: {perm}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
