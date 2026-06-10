"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Shield,
  CheckCircle2,
  XCircle,
  Trash2,
  Clock,
  AlertTriangle,
  User,
  Printer,
  FileDown,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  ApprovalRequest,
  fetchApprovalRequest,
  approveRequest,
  rejectRequest,
  cancelApprovalRequest,
  fetchTeamMembers,
  type TeamMemberSummary,
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

const STEP_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  skipped: "bg-slate-100 text-slate-700",
};

export default function ApprovalDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [req, setReq] = useState<ApprovalRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMemberSummary[]>([]);
  const printRef = useRef<HTMLDivElement>(null);

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId || !id) return;
    setLoading(true);
    try {
      const [res, team] = await Promise.all([
        fetchApprovalRequest(businessId, id),
        fetchTeamMembers(businessId),
      ]);
      if (res.error) throw new Error(res.error);
      setReq(res.data ?? null);
      setMembers(team);
    } catch (_err) {
      toast.error("Failed to load approval request");
    } finally {
      setLoading(false);
    }
  }, [businessId, id]);

  useEffect(() => {
    load();
  }, [load]);

  const getApproverName = (approverId: string) => {
    const member = members.find((m) => m.userId === approverId || m.id === approverId);
    if (member?.user?.name) return member.user.name;
    if (member?.user?.firstName) {
      return `${member.user.firstName} ${member.user.lastName ?? ""}`.trim();
    }
    return approverId.slice(0, 8);
  };

  const handleApprove = async () => {
    if (!businessId || !req) return;
    setActionLoading("approve");
    try {
      await approveRequest(businessId, id);
      toast.success("Approval request approved");
      load();
    } catch {
      toast.error("Failed to approve");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!businessId || !req) return;
    setActionLoading("reject");
    try {
      await rejectRequest(businessId, id);
      toast.success("Approval request rejected");
      load();
    } catch {
      toast.error("Failed to reject");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!businessId || !req) return;
    if (!confirm("Cancel this approval request?")) return;
    setActionLoading("cancel");
    try {
      await cancelApprovalRequest(businessId, id);
      toast.success("Approval request cancelled");
      router.push("/app/approvals");
    } catch {
      toast.error("Failed to cancel");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePrint = () => {
    if (typeof window === "undefined") return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const content = printRef.current?.innerHTML ?? "";
    printWindow.document.write(`
      <html>
        <head>
          <title>Approval Audit - ${req?.title ?? ""}</title>
          <style>
            body { font-family: system-ui, sans-serif; padding: 2rem; color: #111; }
            h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
            .meta { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
            .section { margin-bottom: 1.5rem; }
            .section h2 { font-size: 1rem; margin-bottom: 0.5rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
            .row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #eee; }
            .step { padding: 0.75rem; border: 1px solid #ddd; border-radius: 0.5rem; margin-bottom: 0.5rem; }
            .status { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
            .approved { background: #dcfce7; color: #166534; }
            .rejected { background: #fee2e2; color: #991b1b; }
            .pending { background: #fef3c7; color: #92400e; }
            .skipped { background: #f3f4f6; color: #374151; }
          </style>
        </head>
        <body>
          ${content}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  if (loading) {
    return (
      <WorkspaceShell icon={Shield} title="Approval">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </WorkspaceShell>
    );
  }

  if (!req) {
    return (
      <WorkspaceShell icon={Shield} title="Approval">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mb-3" />
          <h2 className="text-lg font-medium">Approval request not found</h2>
          <button
            onClick={() => router.push("/app/approvals")}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Approvals
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  const isPending = req.status === "pending";

  return (
    <WorkspaceShell icon={Shield} title="Approval">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => router.push("/app/approvals")}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{req.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  STATUS_COLORS[req.status] || "bg-gray-100"
                }`}
              >
                {STATUS_LABELS[req.status] || req.status}
              </span>
              <span className="text-muted-foreground text-sm">ID: {req.id.slice(0, 8)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
              style={{ borderColor: "hsl(var(--kf-border))" }}
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
              style={{ borderColor: "hsl(var(--kf-border))" }}
            >
              <FileDown className="w-4 h-4" />
              PDF
            </button>
          </div>
        </div>

        <div ref={printRef} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main info */}
            <div className="lg:col-span-2 space-y-6">
              {/* Details */}
              <div className="border rounded-xl p-4 space-y-3" style={{ borderColor: "hsl(var(--kf-border))" }}>
                <h3 className="text-sm font-medium">Details</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Type</span>
                    <p className="font-medium capitalize">{req.requestType.replace(/_/g, " ")}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Threshold</span>
                    <p className="font-medium">{req.threshold ?? "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Current Step</span>
                    <p className="font-medium">{req.currentStep + 1} of {req.steps?.length ?? 0}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Requester</span>
                    <p className="font-medium">{getApproverName(req.requesterId)}</p>
                  </div>
                </div>
                {req.description && (
                  <div className="pt-2 border-t" style={{ borderColor: "hsl(var(--kf-border))" }}>
                    <span className="text-muted-foreground text-sm">Description</span>
                    <p className="text-sm mt-1">{req.description}</p>
                  </div>
                )}
              </div>

              {/* Steps */}
              {req.steps && req.steps.length > 0 && (
                <div className="border rounded-xl p-4" style={{ borderColor: "hsl(var(--kf-border))" }}>
                  <h3 className="text-sm font-medium mb-3">Approval Steps</h3>
                  <div className="space-y-2">
                    {req.steps.map((step, idx) => (
                      <div key={step.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                            {idx + 1}
                          </div>
                          <div>
                            <div className="text-sm font-medium flex items-center gap-2">
                              <User className="w-3.5 h-3.5 text-muted-foreground" />
                              {getApproverName(step.approverId)}
                            </div>
                            {step.decision && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                Decision: <span className="font-medium">{step.decision}</span>
                                {step.comment ? ` — ${step.comment}` : ""}
                                {step.decidedAt && (
                                  <span className="block text-[10px] text-muted-foreground/70 mt-0.5">
                                    {new Date(step.decidedAt).toLocaleString()}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            STEP_STATUS_COLORS[step.status] || "bg-gray-100"
                          }`}
                        >
                          {step.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              {isPending && (
                <div className="border rounded-xl p-4" style={{ borderColor: "hsl(var(--kf-border))" }}>
                  <h3 className="text-sm font-medium mb-3">Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleApprove}
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === "approve" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      Approve
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === "reject" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                      Reject
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      style={{ borderColor: "hsl(var(--kf-border))" }}
                    >
                      {actionLoading === "cancel" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      Cancel Request
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <div className="border rounded-xl p-4 space-y-3 text-sm" style={{ borderColor: "hsl(var(--kf-border))" }}>
                <h3 className="font-medium">Meta</h3>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Created</span>
                  <span className="ml-auto">{new Date(req.createdAt).toLocaleString()}</span>
                </div>
                {req.resolvedAt && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-muted-foreground">Resolved</span>
                    <span className="ml-auto">{new Date(req.resolvedAt).toLocaleString()}</span>
                  </div>
                )}
                {req.resolution && (
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Resolution</span>
                    <span className="ml-auto capitalize">{req.resolution}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
