"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ShoppingCart,
  ArrowLeft,
  Loader2,
  Send,
  CheckCircle2,
  Package,
  Calendar,
  AlertCircle,
  Sparkles,
  FileText,
  X,
  Truck,
  Check,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchProcurementRequest,
  submitProcurementRequest,
  approveProcurementRequest,
  rejectProcurementRequest,
  fetchProcurementSuppliers,
  selectProcurementVendor,
  issueProcurementPO,
  acknowledgeProcurementVendor,
  fulfillProcurementRequest,
  invoiceProcurementRequest,
  type ProcurementRequest,
} from "@/lib/client";
import { WorkspaceShell } from "@/components/ui/workspace-shell";

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    SUBMITTED: "bg-amber-500/10 text-amber-500",
    APPROVED: "bg-emerald-500/10 text-emerald-500",
    COMPLETED: "bg-blue-500/10 text-blue-500",
    REJECTED: "bg-red-500/10 text-red-500",
    PO_ISSUED: "bg-blue-500/10 text-blue-500",
    VENDOR_ACKNOWLEDGED: "bg-indigo-500/10 text-indigo-500",
    FULFILLED: "bg-teal-500/10 text-teal-500",
    INVOICED: "bg-cyan-500/10 text-cyan-500",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${styles[status] || styles.DRAFT}`}>
      {status}
    </span>
  );
}

export default function ProcurementDetailPage() {
  const router = useRouter();
  const params = useParams();
  const requestId = params.requestId as string;
  const [req, setReq] = useState<ProcurementRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; displayName: string }>>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>("");

  const load = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz || !requestId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchProcurementRequest(biz, requestId);
      if (res.data) setReq(res.data);
      else toast.error("Request not found");
    } catch {
      toast.error("Failed to load request");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    const biz = getStoredBusinessId();
    if (!biz || !requestId) return;
    setSubmitting(true);
    try {
      const res = await submitProcurementRequest(biz, requestId);
      if (res.data) {
        toast.success("Request submitted for review");
        setReq(res.data);
      } else {
        toast.error(res.error || "Failed to submit");
      }
    } catch {
      toast.error("Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    const biz = getStoredBusinessId();
    if (!biz || !requestId) return;
    setSubmitting(true);
    try {
      const res = await approveProcurementRequest(biz, requestId);
      if (res.data) {
        toast.success("Request approved");
        setReq(res.data);
      } else {
        toast.error(res.error || "Failed to approve");
      }
    } catch {
      toast.error("Failed to approve request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    const biz = getStoredBusinessId();
    if (!biz || !requestId) return;
    setSubmitting(true);
    try {
      const res = await rejectProcurementRequest(biz, requestId, rejectReason || undefined);
      if (res.data) {
        toast.success("Request rejected");
        setReq(res.data);
        setShowRejectInput(false);
        setRejectReason("");
      } else {
        toast.error(res.error || "Failed to reject");
      }
    } catch {
      toast.error("Failed to reject request");
    } finally {
      setSubmitting(false);
    }
  };

  const loadSuppliers = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    const res = await fetchProcurementSuppliers(biz);
    if (res.data) setSuppliers(res.data);
  }, []);

  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);

  const handleSelectVendor = async () => {
    const biz = getStoredBusinessId();
    if (!biz || !requestId || !selectedVendor) return;
    setSubmitting(true);
    try {
      const res = await selectProcurementVendor(biz, requestId, selectedVendor);
      if (res.data) {
        toast.success("Vendor selected");
        setReq(res.data);
      } else {
        toast.error("Failed to select vendor");
      }
    } catch {
      toast.error("Failed to select vendor");
    } finally {
      setSubmitting(false);
    }
  };

  const handleIssuePO = async () => {
    const biz = getStoredBusinessId();
    if (!biz || !requestId) return;
    setSubmitting(true);
    try {
      const res = await issueProcurementPO(biz, requestId);
      if (res.data) {
        toast.success(`PO ${res.data.purchaseOrder?.poNumber} issued`);
        setReq(res.data);
      } else {
        toast.error("Failed to issue PO");
      }
    } catch {
      toast.error("Failed to issue PO");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcknowledge = async () => {
    const biz = getStoredBusinessId();
    if (!biz || !requestId) return;
    setSubmitting(true);
    try {
      const res = await acknowledgeProcurementVendor(biz, requestId);
      if (res.data) { toast.success("Vendor acknowledged"); setReq(res.data); }
    } catch { toast.error("Failed"); }
    finally { setSubmitting(false); }
  };

  const handleFulfill = async () => {
    const biz = getStoredBusinessId();
    if (!biz || !requestId) return;
    setSubmitting(true);
    try {
      const res = await fulfillProcurementRequest(biz, requestId);
      if (res.data) { toast.success("Marked as fulfilled"); setReq(res.data); }
    } catch { toast.error("Failed"); }
    finally { setSubmitting(false); }
  };

  const handleInvoice = async () => {
    const biz = getStoredBusinessId();
    if (!biz || !requestId) return;
    setSubmitting(true);
    try {
      const res = await invoiceProcurementRequest(biz, requestId);
      if (res.data) { toast.success("Marked as invoiced"); setReq(res.data); }
    } catch { toast.error("Failed"); }
    finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <WorkspaceShell icon={ShoppingCart} title="Procurement" subtitle="Loading..." iconColor="#F97316">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
      </WorkspaceShell>
    );
  }

  if (!req) {
    return (
      <WorkspaceShell icon={ShoppingCart} title="Procurement" subtitle="Request not found" iconColor="#F97316">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">Request not found</p>
          <button
            onClick={() => router.push("/app/procurement")}
            className="mt-3 text-xs text-primary hover:underline"
          >
            Back to Procurement
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  const interpreted = req.interpretedNeed as Record<string, unknown> | null;
  const packages = req.recommendedPackages as Array<{
    name: string;
    description: string;
    estimatedCost?: { min: number; max: number };
    timeline?: string;
  }> | null;
  const brief = req.brief as Record<string, unknown> | null;

  return (
    <WorkspaceShell
      icon={ShoppingCart}
      title="Procurement Request"
      subtitle={new Date(req.createdAt).toLocaleDateString()}
      iconColor="#F97316"
      headerRight={
        <button
          onClick={() => router.push("/app/procurement")}
          className="flex items-center gap-1.5 h-9 px-3 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all text-xs font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
      }
    >
      <div className="max-w-2xl space-y-4">
        {/* Status Header */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {statusBadge(req.status)}
              {req.priority && (
                <span className="text-[10px] text-muted-foreground">{req.priority} priority</span>
              )}
            </div>
            {req.status === "DRAFT" && (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium"
                style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                Submit for Review
              </button>
            )}
            {req.status === "SUBMITTED" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleApprove}
                  disabled={submitting}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                >
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Approve
                </button>
                {!showRejectInput ? (
                  <button
                    onClick={() => setShowRejectInput(true)}
                    disabled={submitting}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-600 hover:bg-red-500/20"
                  >
                    <X className="w-3 h-3" />
                    Reject
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className="h-8 px-2 rounded-lg border border-border/50 bg-background text-[11px] w-40"
                    />
                    <button
                      onClick={handleReject}
                      disabled={submitting}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-600 hover:bg-red-500/20"
                    >
                      {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                    </button>
                    <button
                      onClick={() => { setShowRejectInput(false); setRejectReason(""); }}
                      className="h-8 px-2 rounded-lg text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
            {req.status === "APPROVED" && (
              <div className="flex items-center gap-2">
                {req.supplierConnectionId ? (
                  <button
                    onClick={handleIssuePO}
                    disabled={submitting}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"
                  >
                    {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Truck className="w-3 h-3" />}
                    Issue PO
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedVendor}
                      onChange={(e) => setSelectedVendor(e.target.value)}
                      className="h-8 px-2 rounded-lg border border-border/50 bg-background text-[11px]"
                    >
                      <option value="">Select vendor...</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.displayName}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleSelectVendor}
                      disabled={submitting || !selectedVendor}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 disabled:opacity-50"
                    >
                      {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Set Vendor
                    </button>
                  </div>
                )}
              </div>
            )}
            {req.status === "PO_ISSUED" && (
              <button
                onClick={handleAcknowledge}
                disabled={submitting}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Vendor Acknowledged
              </button>
            )}
            {req.status === "VENDOR_ACKNOWLEDGED" && (
              <button
                onClick={handleFulfill}
                disabled={submitting}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium bg-teal-500/10 text-teal-600 hover:bg-teal-500/20"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Package className="w-3 h-3" />}
                Mark Fulfilled
              </button>
            )}
            {req.status === "FULFILLED" && (
              <button
                onClick={handleInvoice}
                disabled={submitting}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Receipt className="w-3 h-3" />}
                Mark Invoiced
              </button>
            )}
          </div>
          <p className="text-sm font-medium text-foreground/90">{req.userPrompt}</p>
        </div>

        {/* Interpreted Need */}
        {interpreted && (
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-semibold">AI Interpretation</h3>
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              {!!interpreted.category && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground/50">Category:</span>
                  <span className="capitalize">{String(interpreted.category)}</span>
                </div>
              )}
              {!!interpreted.urgency && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground/50">Urgency:</span>
                  <span>{String(interpreted.urgency)}</span>
                </div>
              )}
              {!!interpreted.scope && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground/50">Scope:</span>
                  <span className="capitalize">{String(interpreted.scope).replace("_", " ")}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recommended Packages */}
        {packages && packages.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-semibold">Recommended Packages ({packages.length})</h3>
            </div>
            <div className="space-y-2">
              {packages.map((pkg, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border/30 bg-background/50 p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{pkg.name}</span>
                    {pkg.estimatedCost && (
                      <span className="text-[10px] text-emerald-500 font-medium">
                        ${pkg.estimatedCost.min} – ${pkg.estimatedCost.max}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{pkg.description}</p>
                  {pkg.timeline && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground/60">
                      <Calendar className="w-3 h-3" />
                      {pkg.timeline}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Brief */}
        {brief && (
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-semibold">Internal Brief</h3>
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              {!!brief.businessGoal && (
                <p><span className="text-foreground/70 font-medium">Goal:</span> {String(brief.businessGoal)}</p>
              )}
              {!!brief.suggestedNextStep && (
                <p><span className="text-foreground/70 font-medium">Next step:</span> {String(brief.suggestedNextStep)}</p>
              )}
              {typeof brief.aiConfidence === "number" && (
                <p><span className="text-foreground/70 font-medium">AI confidence:</span> {String(brief.aiConfidence)}%</p>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        {req.internalNotes && (
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <h3 className="text-xs font-semibold mb-2">Internal Notes</h3>
            <p className="text-xs text-muted-foreground">{req.internalNotes}</p>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
