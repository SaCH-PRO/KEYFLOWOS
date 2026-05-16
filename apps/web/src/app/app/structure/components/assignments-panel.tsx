"use client";

import { useEffect, useState } from "react";
import { Users, Plus, Trash2, Loader2, X, Check, UserCircle } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  fetchOrgUnits,
  fetchJobRoles,
  type OrgAssignment,
  type OrgUnit,
  type JobRole,
} from "@/lib/client";
import { apiGet } from "@/lib/api";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Member = {
  id: string;
  userId: string;
  role: string;
  user: {
    id: string;
    email: string;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    avatarUrl?: string | null;
  };
};

export function AssignmentsPanel() {
  const businessId = getStoredBusinessId();
  const [assignments, setAssignments] = useState<OrgAssignment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    membershipId: "",
    userId: "",
    orgUnitId: "",
    jobRoleId: "",
    reportsToId: "",
    isPrimary: true,
  });

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const [aRes, uRes, rRes] = await Promise.all([
      fetchAssignments(businessId),
      fetchOrgUnits(businessId),
      fetchJobRoles(businessId),
    ]);
    if (aRes.data) setAssignments(aRes.data);
    if (uRes.data) setUnits(uRes.data);
    if (rRes.data) setRoles(rRes.data);

    // Fetch team members from existing team endpoint
    const mRes = await apiGet<{ members: Member[] }>(`/identity/businesses/${businessId}/team`);
    if (mRes.data?.members) setMembers(mRes.data.members);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!businessId) return;
      const [aRes, uRes, rRes] = await Promise.all([
        fetchAssignments(businessId),
        fetchOrgUnits(businessId),
        fetchJobRoles(businessId),
      ]);
      if (!cancelled) {
        if (aRes.data) setAssignments(aRes.data);
        if (uRes.data) setUnits(uRes.data);
        if (rRes.data) setRoles(rRes.data);
      }

      // Fetch team members from existing team endpoint
      const mRes = await apiGet<{ members: Member[] }>(`/identity/businesses/${businessId}/team`);
      if (!cancelled && mRes.data?.members) setMembers(mRes.data.members);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const assignmentName = (id: string) => {
    const a = assignments.find((x) => x.id === id);
    if (!a) return id.slice(0, 8);
    const u = a.membership?.user;
    return u?.name || `${u?.firstName || ""} ${u?.lastName || ""}`.trim() || u?.email || a.userId;
  };

  const resetForm = () => {
    setForm({ membershipId: "", userId: "", orgUnitId: "", jobRoleId: "", reportsToId: "", isPrimary: true });
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!businessId || !form.membershipId || !form.orgUnitId) {
      toast.error("Select a staff member and org unit");
      return;
    }
    const res = await createAssignment(businessId, form);
    if (res.data) {
      toast.success("Assignment created");
      resetForm();
      load();
    } else toast.error("Failed to create assignment");
  };

  const handleEnd = async (id: string) => {
    if (!businessId) return;
    const res = await updateAssignment(businessId, id, { endedAt: new Date().toISOString() });
    if (res.data) {
      toast.success("Assignment ended");
      load();
    } else toast.error("Failed to update");
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    const res = await deleteAssignment(businessId, id);
    if (res.data) {
      toast.success("Assignment removed");
      load();
    } else toast.error("Failed to delete");
  };

  const selectedMember = members.find((m) => m.id === form.membershipId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Staff Assignments</h3>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium"
          style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? "Cancel" : "Assign Staff"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Staff Member</label>
              <select
                value={form.membershipId}
                onChange={(e) => {
                  const m = members.find((x) => x.id === e.target.value);
                  setForm((f) => ({ ...f, membershipId: e.target.value, userId: m?.userId ?? "" }));
                }}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              >
                <option value="">Select member</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user.name || `${m.user.firstName || ""} ${m.user.lastName || ""}`.trim() || m.user.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Org Unit</label>
              <select
                value={form.orgUnitId}
                onChange={(e) => setForm((f) => ({ ...f, orgUnitId: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              >
                <option value="">Select unit</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Job Role</label>
              <select
                value={form.jobRoleId}
                onChange={(e) => setForm((f) => ({ ...f, jobRoleId: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              >
                <option value="">None</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Reports To</label>
              <select
                value={form.reportsToId}
                onChange={(e) => setForm((f) => ({ ...f, reportsToId: e.target.value }))}
                className="w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm"
              >
                <option value="">None</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {assignmentName(a.id)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPrimary"
              checked={form.isPrimary}
              onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
              className="rounded border-border"
            />
            <label htmlFor="isPrimary" className="text-xs text-muted-foreground">Primary assignment</label>
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
              Assign
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Remove assignment?"
        message="This will permanently delete the assignment record."
        confirmLabel="Remove"
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
          {assignments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-sm">No assignments yet</p>
              <p className="text-xs mt-1">Assign staff to org units and roles</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {assignments.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                    <UserCircle className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{assignmentName(a.id)}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-muted border border-border/40">{a.orgUnit?.name ?? "Unknown"}</span>
                      {a.jobRole && (
                        <span className="px-1.5 py-0.5 rounded bg-muted border border-border/40" style={{ color: a.jobRole.color ?? undefined }}>
                          {a.jobRole.name}
                        </span>
                      )}
                      {a.isPrimary && (
                        <span className="text-[10px] text-emerald-400">Primary</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEnd(a.id)}
                      className="h-7 px-2 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      End
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(a.id)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
