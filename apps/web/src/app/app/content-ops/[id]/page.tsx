"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  FileText,
  Megaphone,
  Mail,
  Image as ImageIcon,
  Video,
  PenTool,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Package,
  Calendar,
  User,
  Shield,
  Truck,
  X,
  Send,
  Play,
  Eye,
  Check,
  Upload,
  FolderOpen,
  FilePlus,
  Receipt,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  ContentRequest,
  ContentRequestStatus,
  fetchContentRequest,
  submitContentRequest,
  assignContentRequest,
  startContentProduction,
  submitForReview,
  reviewContentRequest,
  deliverContentRequest,
  createDriveFolder,
  createDriveDoc,
  fetchContentDeliveryStatus,
  ContentDeliveryStatus,
  generateInvoiceFromContentRequest,
  uploadDeliverables,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const STATUS_LABELS: Record<ContentRequestStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  assigned: "Assigned",
  in_production: "In Production",
  internal_review: "Internal Review",
  user_review: "User Review",
  approved: "Approved",
  uploaded_to_drive: "Uploaded to Drive",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_FLOW: ContentRequestStatus[] = [
  "draft",
  "submitted",
  "assigned",
  "in_production",
  "internal_review",
  "user_review",
  "approved",
  "uploaded_to_drive",
  "delivered",
];

const CONTENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  blog_post: <FileText className="w-4 h-4" />,
  social_post: <Megaphone className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
  video_script: <Video className="w-4 h-4" />,
  flyer: <ImageIcon className="w-4 h-4" aria-hidden="true" />,
  whitepaper: <PenTool className="w-4 h-4" />,
  landing_page: <FileText className="w-4 h-4" />,
  case_study: <FileText className="w-4 h-4" />,
  newsletter: <Mail className="w-4 h-4" />,
  ad_copy: <Megaphone className="w-4 h-4" />,
  press_release: <FileText className="w-4 h-4" />,
};

const ACTION_BUTTONS: Partial<
  Record<ContentRequestStatus, Array<{ label: string; action: string; icon: React.ReactNode }>>
> = {
  draft: [{ label: "Submit", action: "submit", icon: <Send className="w-4 h-4" /> }],
  submitted: [{ label: "Assign", action: "assign", icon: <User className="w-4 h-4" /> }],
  assigned: [{ label: "Start Production", action: "start", icon: <Play className="w-4 h-4" /> }],
  in_production: [
    { label: "Submit for Review", action: "submit_review", icon: <Eye className="w-4 h-4" /> },
  ],
  internal_review: [
    { label: "Pass Review", action: "review_pass", icon: <Check className="w-4 h-4" /> },
    { label: "Request Changes", action: "review_fail", icon: <X className="w-4 h-4" /> },
  ],
  user_review: [
    { label: "Approve", action: "approve", icon: <Shield className="w-4 h-4" /> },
    { label: "Request Revision", action: "revision", icon: <AlertTriangle className="w-4 h-4" /> },
  ],
  approved: [
    { label: "Upload Deliverables", action: "upload", icon: <Upload className="w-4 h-4" /> },
  ],
  uploaded_to_drive: [
    { label: "Deliver", action: "deliver", icon: <Truck className="w-4 h-4" /> },
  ],
};

export default function ContentRequestDetailPage() {
  const router = useRouter();
  const params = useParams();
  const requestId = params.id as string;
  const [req, setReq] = useState<ContentRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<ContentDeliveryStatus | null>(null);
  const [showAssignInput, setShowAssignInput] = useState(false);
  const [assignees, setAssignees] = useState("");
  const [reviewComment, setReviewComment] = useState("");

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId || !requestId) return;
    setLoading(true);
    try {
      const [res, deliveryRes] = await Promise.all([
        fetchContentRequest(businessId, requestId),
        fetchContentDeliveryStatus(businessId, requestId).catch(() => null),
      ]);
      if (res.error) throw new Error(res.error);
      setReq(res.data ?? null);
      setDeliveryStatus(deliveryRes?.data ?? null);
    } catch (_err) {
      toast.error("Failed to load content request");
    } finally {
      setLoading(false);
    }
  }, [businessId, requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (action: string) => {
    if (!businessId || !req) return;
    setActionLoading(action);
    try {
      switch (action) {
        case "submit":
          await submitContentRequest(businessId, requestId);
          toast.success("Submitted for assignment");
          break;
        case "assign":
          setShowAssignInput(true);
          setActionLoading(null);
          return;
        case "start":
          await startContentProduction(businessId, requestId);
          toast.success("Production started");
          break;
        case "submit_review":
          await submitForReview(businessId, requestId, reviewComment);
          toast.success("Submitted for review");
          break;
        case "review_pass":
          await reviewContentRequest(businessId, requestId, { approved: true, comment: reviewComment });
          toast.success("Review passed");
          break;
        case "review_fail":
          await reviewContentRequest(businessId, requestId, { approved: false, comment: reviewComment });
          toast.success("Changes requested");
          break;
        case "approve":
          await reviewContentRequest(businessId, requestId, { approved: true, comment: reviewComment });
          toast.success("Approved");
          break;
        case "revision":
          await reviewContentRequest(businessId, requestId, { approved: false, comment: reviewComment });
          toast.success("Revision requested");
          break;
        case "upload": {
          const raw = window.prompt("Enter asset file IDs to upload as deliverables (comma-separated):");
          if (raw === null) break;
          const fileIds = raw
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);
          if (fileIds.length === 0) {
            toast.info("No file IDs provided.");
            break;
          }
          const uploadRes = await uploadDeliverables(businessId, requestId, { fileIds });
          if (uploadRes.data) {
            toast.success(`Uploaded ${fileIds.length} deliverable(s)`);
          } else {
            toast.error(uploadRes.error ?? "Upload failed");
          }
          break;
        }
        case "deliver":
          await deliverContentRequest(businessId, requestId);
          toast.success("Delivered to client");
          break;
        case "generate_invoice":
          await generateInvoiceFromContentRequest(businessId, requestId);
          toast.success("Invoice generated");
          break;
        case "drive_folder":
          const folderRes = await createDriveFolder(businessId, requestId);
          if (folderRes.data) toast.success(`Drive folder created: ${folderRes.data.folderUrl}`);
          break;
        case "drive_doc":
          const docRes = await createDriveDoc(businessId, requestId, `${req.businessGoal} — Brief`);
          if (docRes.data) toast.success(`Drive doc created: ${docRes.data.docUrl}`);
          break;
        default:
          break;
      }
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleAssign = async () => {
    if (!businessId || !req) return;
    const ids = assignees.split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) {
      toast.error("Enter at least one team member ID");
      return;
    }
    setActionLoading("assign_confirm");
    try {
      await assignContentRequest(businessId, requestId, ids);
      toast.success("Assigned");
      setShowAssignInput(false);
      setAssignees("");
      load();
    } catch {
      toast.error("Assignment failed");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <WorkspaceShell icon={FileText} title="Content Request">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </WorkspaceShell>
    );
  }

  if (!req) {
    return (
      <WorkspaceShell icon={FileText} title="Content Request">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <Package className="w-12 h-12 text-muted-foreground mb-3" />
          <h2 className="text-lg font-medium">Content request not found</h2>
          <button
            onClick={() => router.push("/app/content-ops")}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Content Ops
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  const currentStep = STATUS_FLOW.indexOf(req.status as ContentRequestStatus);
  const actions = ACTION_BUTTONS[req.status as ContentRequestStatus] || [];

  return (
    <WorkspaceShell icon={FileText} title="Content Request">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/app/content-ops")}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{req.businessGoal}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  req.priority === "urgent"
                    ? "bg-red-100 text-red-700"
                    : req.priority === "high"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {req.priority}
              </span>
              <span className="text-muted-foreground text-sm">ID: {req.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>

        {/* Status pipeline */}
        <div className="border rounded-xl p-4 bg-muted/20">
          <h3 className="text-sm font-medium mb-3">Pipeline</h3>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {STATUS_FLOW.map((status, idx) => {
              const isActive = idx === currentStep;
              const isDone = idx < currentStep;
              const _isFuture = idx > currentStep;
              return (
                <div key={status} className="flex items-center shrink-0">
                  <div
                    className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : isDone
                        ? "bg-green-100 text-green-700"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                    {STATUS_LABELS[status]}
                  </div>
                  {idx < STATUS_FLOW.length - 1 && (
                    <div
                      className={`w-6 h-0.5 mx-1 ${
                        isDone ? "bg-green-300" : "bg-muted"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Content types */}
            <div className="border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-3">Content Types</h3>
              <div className="flex flex-wrap gap-2">
                {req.contentTypes.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-sm"
                  >
                    {CONTENT_TYPE_ICONS[t] || <FileText className="w-4 h-4" />}
                    <span className="capitalize">{t.replace(/_/g, " ")}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Details */}
            <div className="border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-medium">Details</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Target Audience</span>
                  <p className="font-medium">{req.targetAudience || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Offer</span>
                  <p className="font-medium">{req.offer || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Product/Service</span>
                  <p className="font-medium">{req.productOrService || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Branch</span>
                  <p className="font-medium">{req.branch || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Tone</span>
                  <p className="font-medium">{req.tone || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Due Date</span>
                  <p className="font-medium">
                    {req.dueDate ? new Date(req.dueDate).toLocaleDateString() : "—"}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            {actions.length > 0 && (
              <div className="border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-3">Actions</h3>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <button
                      key={a.action}
                      onClick={() => handleAction(a.action)}
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === a.action ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        a.icon
                      )}
                      {a.label}
                    </button>
                  ))}
                </div>

                {showAssignInput && (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      placeholder="Enter team member IDs, comma-separated"
                      value={assignees}
                      onChange={(e) => setAssignees(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                    />
                    <button
                      onClick={handleAssign}
                      disabled={actionLoading === "assign_confirm"}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === "assign_confirm" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Assign"
                      )}
                    </button>
                  </div>
                )}

                {(actions.some((a) => a.action.includes("review")) ||
                  actions.some((a) => a.action === "approve") ||
                  actions.some((a) => a.action === "revision")) && (
                  <div className="mt-3">
                    <textarea
                      placeholder="Add a comment..."
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Delivery */}
            {deliveryStatus && (
              <div className="border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-3">Delivery Status</h3>
                <div className="space-y-2">
                  {deliveryStatus.packages?.map((pkg) => (
                    <div key={pkg.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">Package {pkg.id.slice(0, 8)}</span>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          pkg.status === "delivered"
                            ? "bg-green-100 text-green-700"
                            : pkg.status === "uploaded"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {pkg.status}
                      </span>
                    </div>
                  )) || (
                    <p className="text-sm text-muted-foreground">No delivery packages yet</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Meta */}
            <div className="border rounded-xl p-4 space-y-3 text-sm">
              <h3 className="font-medium">Meta</h3>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Created</span>
                <span className="ml-auto">{new Date(req.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Updated</span>
                <span className="ml-auto">{new Date(req.updatedAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Requested By</span>
                <span className="ml-auto">{req.requestedBy}</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Approval</span>
                <span className="ml-auto">{req.approvalRequired ? "Required" : "Not required"}</span>
              </div>
              {req.approvedBy && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-muted-foreground">Approved By</span>
                  <span className="ml-auto">{req.approvedBy}</span>
                </div>
              )}
            </div>

            {/* Assigned */}
            {req.assignedTeamMemberIds.length > 0 && (
              <div className="border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-3">Assigned Team</h3>
                <div className="space-y-2">
                  {req.assignedTeamMemberIds.map((id) => (
                    <div key={id} className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span>{id.slice(0, 8)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Invoice */}
            {req.invoiceId && (
              <div className="border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-3">Invoice</h3>
                <div className="flex items-center gap-2 text-sm">
                  <Receipt className="w-4 h-4 text-green-500" />
                  <span className="text-muted-foreground">Invoice ID</span>
                  <span className="ml-auto font-mono text-xs">{req.invoiceId.slice(0, 12)}...</span>
                </div>
              </div>
            )}
            {req.status === "delivered" && !req.invoiceId && (
              <div className="border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-3">Invoice</h3>
                <button
                  onClick={() => handleAction("generate_invoice")}
                  disabled={!!actionLoading}
                  className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted transition-colors text-sm"
                >
                  {actionLoading === "generate_invoice" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Receipt className="w-4 h-4" />
                  )}
                  Generate Invoice
                </button>
              </div>
            )}

            {/* Drive */}
            {req.googleDriveFolderId && (
              <div className="border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-3">Google Drive</h3>
                <div className="flex items-center gap-2 text-sm">
                  <FolderOpen className="w-4 h-4 text-blue-500" />
                  <span className="text-muted-foreground">Folder ID</span>
                  <span className="ml-auto font-mono text-xs">{req.googleDriveFolderId.slice(0, 12)}...</span>
                </div>
              </div>
            )}

            {/* Tools */}
            <div className="border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-3">Tools</h3>
              <div className="space-y-2">
                <button
                  onClick={() => handleAction("drive_folder")}
                  disabled={!!actionLoading}
                  className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted transition-colors text-sm"
                >
                  <FolderOpen className="w-4 h-4" />
                  Create Drive Folder
                </button>
                <button
                  onClick={() => handleAction("drive_doc")}
                  disabled={!!actionLoading}
                  className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted transition-colors text-sm"
                >
                  <FilePlus className="w-4 h-4" />
                  Create Drive Doc
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
