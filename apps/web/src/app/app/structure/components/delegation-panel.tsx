"use client";

import { useEffect, useState } from "react";
import { GitBranch, Plus, Trash2, Loader2, X, Check, Clock } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchDelegationRules,
  createDelegationRule,
  updateDelegationRule,
  deleteDelegationRule,
  fetchAssignments,
  type DelegationRule,
  type OrgAssignment,
} from "@/lib/client";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const SCOPES = ["ALL", "revenue", "expenses", "procurement", "bookings", "projects", "finance", "settings"];

export function DelegationPanel() {
  const businessId = getStoredBusinessId();
  const [rules, setRules] = useState<DelegationRule[]>([]);
  const [assignments, setAssignments] = useState<OrgAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    delegatorId: "",
    delegateId: "",
    scope: "ALL",
    maxTier: 1,
    activeUntil: "",
    reason: "",
  });

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const [rRes, aRes] = await Promise.all([
      fetchDelegationRules(businessId),
      fetchAssignments(businessId),
    ]);
    if (rRes.data) setRules(rRes.data);
    if (aRes.data) setAssignments(aRes.data);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!businessId) return;
      const [rRes, aRes] = await Promise.all([
        fetchDelegationRules(businessId),
        fetchAssignments(businessId),
      ]);
      if (!cancelled) {
        if (rRes.data) setRules(rRes.data);
        if (aRes.data) setAssignments(aRes.data);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const resetForm = () => {
    setForm({ delegatorId: "", delegateId: "", scope: "ALL", maxTier: 1, activeUntil: "", reason: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!businessId || !form.delegatorId || !form.delegateId) {
      toast.error("Select delegator and delegate");
      return;
    }
    const payload: Omit<DelegationRule, "id" | "businessId" | "createdAt" | "updatedAt"> = {
      delegatorId: form.delegatorId,
      delegateId: form.delegateId,
      scope: form.scope,
      maxTier: form.maxTier,
      isActive: true,
      reason: form.reason || undefined,
      activeUntil: form.activeUntil ? new Date(form.activeUntil).toISOString() : undefined,
    } as Omit<DelegationRule, "id" | "businessId" | "createdAt" | "updatedAt">;
    if (editingId) {
      const res = await updateDelegationRule(businessId, editingId, payload);
      if (res.data) {
        toast.success("Rule updated");
        resetForm();
        load();
      } else toast.error("Failed to update");
    } else {
      const res = await createDelegationRule(businessId, payload);
      if (res.data) {
        toast.success("Rule created");
        resetForm();
        load();
      } else toast.error("Failed to create");
    }
  };

  const handleToggleActive = async (r: DelegationRule) => {
    if (!businessId) return;
    const res = await updateDelegationRule(businessId, r.id, { isActive: !r.isActive });
    if (res.data) {
      toast.success(r.isActive ? "Rule deactivated" : "Rule activated");
      load();
    } else toast.error("Failed to update");
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    const res = await deleteDelegationRule(businessId, id);
    if (res.data) {
      toast.success("Rule deleted");
      load();
    } else toast.error("Failed to delete");
  };

  const assignmentName = (id: string) => {
    const a = assignments.find((x) => x.id === id);
    if (!a) return id.slice(0, 8);
    const u = a.membership?.user;
    return u?.name || `${u?.firstName || ""} ${u?.lastName || ""}`.trim() || u?.email || a.userId;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Delegation Rules</h3>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium"
          style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? "Cancel" : "Add Rule"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Delegator</label>
              <select
                value={form.delegatorId}
                onChange={(e) => setForm((f) => ({ ...f, delegatorId: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              >
                <option value="">Select</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>{assignmentName(a.id)} — {a.orgUnit?.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Delegate</label>
              <select
                value={form.delegateId}
                onChange={(e) => setForm((f) => ({ ...f, delegateId: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              >
                <option value="">Select</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>{assignmentName(a.id)} — {a.orgUnit?.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Scope</label>
              <select
                value={form.scope}
                onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Max Tier</label>
              <input
                type="number"
                min={0}
                max={10}
                value={form.maxTier}
                onChange={(e) => setForm((f) => ({ ...f, maxTier: parseInt(e.target.value) || 0 }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Active Until</label>
              <input
                type="date"
                value={form.activeUntil}
                onChange={(e) => setForm((f) => ({ ...f, activeUntil: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Reason</label>
              <input
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
                placeholder="e.g. Vacation coverage"
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
        title="Delete rule?"
        message="This delegation rule will be permanently removed."
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
          {rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <GitBranch className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-sm">No delegation rules yet</p>
              <p className="text-xs mt-1">Set up temporary or permanent approval delegation</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {rules.map((r) => {
                const isExpired = r.activeUntil ? new Date(r.activeUntil) < new Date() : false;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {assignmentName(r.delegatorId)}
                        <span className="text-muted-foreground">→</span>
                        {assignmentName(r.delegateId)}
                        {!r.isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">Inactive</span>
                        )}
                        {isExpired && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">Expired</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="px-1.5 py-0.5 rounded bg-muted border border-border/40">{r.scope}</span>
                        <span>max tier {r.maxTier}</span>
                        {r.reason && <span>· {r.reason}</span>}
                        {r.activeUntil && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            until {new Date(r.activeUntil).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleActive(r)}
                        className={`h-7 px-2 rounded border text-[11px] transition-colors ${
                          r.isActive
                            ? "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                            : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                        }`}
                      >
                        {r.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(r.id)}
                        className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
