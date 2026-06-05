"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Shield,
  Plus,
  Loader2,
  Search,
  Trash2,
  Eye,
  Clock,
  ArrowRight,
  X,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  ApprovalRequest,
  fetchApprovalRequests,
  fetchPendingApprovalsForMe,
  deleteApprovalRequest,
  createApprovalRequest,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  escalated: "Escalated",
  delegated: "Delegated",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  escalated: "bg-purple-100 text-purple-700",
  delegated: "bg-blue-100 text-blue-700",
  cancelled: "bg-slate-100 text-slate-700",
};

export default function ApprovalsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [pendingForMe, setPendingForMe] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [allRes, pendingRes] = await Promise.all([
        fetchApprovalRequests(businessId, { status: filterStatus || undefined }),
        fetchPendingApprovalsForMe(businessId).catch(() => ({ data: [] })),
      ]);
      if (allRes.data) setRequests(allRes.data.items);
      if (pendingRes.data) setPendingForMe(pendingRes.data);
    } catch (err) {
      toast.error("Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, [businessId, filterStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return requests;
    const q = searchQuery.toLowerCase();
    return requests.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }, [requests, searchQuery]);

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!confirm("Delete this approval request?")) return;
    try {
      await deleteApprovalRequest(businessId, id);
      toast.success("Approval request deleted");
      load();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!businessId) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    setCreating(true);
    try {
      await createApprovalRequest(businessId, {
        requestType: (fd.get("type") as string) || "general",
        title: fd.get("title") as string,
        description: (fd.get("description") as string) || undefined,
        steps: (fd.get("approvers") as string)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((approverId, index) => ({ stepOrder: index, approverId })),
      });
      toast.success("Approval request created");
      setShowCreate(false);
      load();
    } catch {
      toast.error("Failed to create approval request");
    } finally {
      setCreating(false);
    }
  };

  const statuses = ["pending", "approved", "rejected", "escalated", "delegated", "cancelled"];

  return (
    <WorkspaceShell icon={Shield} title="Approvals">
      <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
            <p className="text-muted-foreground mt-1">
              Manage approval workflows and decisions
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Request
          </button>
        </div>

        {/* Pending for me */}
        {pendingForMe.length > 0 && (
          <div className="border rounded-xl p-4 bg-amber-50/50">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              Pending Your Decision ({pendingForMe.length})
            </h3>
            <div className="space-y-2">
              {pendingForMe.slice(0, 3).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-white border cursor-pointer hover:shadow-sm transition-shadow"
                  onClick={() => router.push(`/app/approvals/${r.id}`)}
                >
                  <div>
                    <span className="font-medium">{r.title}</span>
                    <span className="text-muted-foreground text-sm ml-2">
                      {r.requestType.replace(/_/g, " ")}
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterStatus("")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !filterStatus ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
            }`}
          >
            All
          </button>
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s === filterStatus ? "" : s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                s === filterStatus
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              {STATUS_LABELS[s]} ({requests.filter((r) => r.status === s).length})
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search approvals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border rounded-xl bg-muted/20">
            <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <h3 className="text-lg font-medium">No approval requests</h3>
          </div>
        ) : (
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Title</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Steps</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/app/approvals/${r.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium max-w-xs truncate">{r.title}</div>
                      <div className="text-muted-foreground text-xs mt-0.5">
                        {r.description || "No description"}
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize">{r.requestType.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                          STATUS_COLORS[r.status] || "bg-gray-100"
                        }`}
                      >
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.steps?.length ?? 0} steps
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/app/approvals/${r.id}`);
                          }}
                          className="p-1.5 rounded hover:bg-muted transition-colors"
                        >
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(r.id);
                          }}
                          className="p-1.5 rounded hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">New Approval Request</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title *</label>
                <input name="title" required className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Approval title" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea name="description" rows={2} className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="What needs approval?" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select name="type" className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="general">General</option>
                  <option value="quote_discount">Quote Discount</option>
                  <option value="expense">Expense</option>
                  <option value="content_delivery">Content Delivery</option>
                  <option value="refund">Refund</option>
                  <option value="po">Purchase Order</option>
                  <option value="time_off">Time Off</option>
                  <option value="task_completion">Task Completion</option>
                  <option value="evidence_verification">Evidence Verification</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Approver IDs *</label>
                <input name="approvers" required className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="user-id-1, user-id-2" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors">Cancel</button>
                <button type="submit" disabled={creating} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
