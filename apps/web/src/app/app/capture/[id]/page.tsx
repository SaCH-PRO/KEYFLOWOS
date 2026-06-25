"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Camera,
  AlertCircle,
  Clock,
  BrainCircuit,
  UserPlus,
  Receipt,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import {
  getCapture,
  processCapture,
  approveIntake,
  rejectIntake,
  createContactFromCard,
  type CaptureResult,
} from "@/lib/api/device";
import { getStoredBusinessId } from "@/lib/workspace";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  if (score >= 80) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-400/30 text-emerald-400 bg-emerald-500/10"
      >
        {score}% confidence
      </Badge>
    );
  }
  if (score >= 60) {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/30 text-amber-400 bg-amber-500/10"
      >
        {score}% confidence
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-red-400/30 text-red-400 bg-red-500/10"
    >
      {score}% confidence
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "UPLOADED":
      return (
        <Badge
          variant="outline"
          className="border-blue-400/30 text-blue-400 bg-blue-500/10"
        >
          Uploaded
        </Badge>
      );
    case "PROCESSING":
      return (
        <Badge
          variant="outline"
          className="border-amber-400/30 text-amber-400 bg-amber-500/10"
        >
          Processing
        </Badge>
      );
    case "PROCESSED":
      return (
        <Badge
          variant="outline"
          className="border-emerald-400/30 text-emerald-400 bg-emerald-500/10"
        >
          Processed
        </Badge>
      );
    case "FAILED":
      return <Badge variant="destructive">Failed</Badge>;
    case "PENDING":
      return (
        <Badge
          variant="outline"
          className="border-amber-400/30 text-amber-400 bg-amber-500/10"
        >
          Pending
        </Badge>
      );
    case "ACCEPTED":
      return (
        <Badge
          variant="outline"
          className="border-emerald-400/30 text-emerald-400 bg-emerald-500/10"
        >
          Approved
        </Badge>
      );
    case "REJECTED":
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function CaptureDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const businessId = getStoredBusinessId() ?? "";
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id || !businessId) return;
    setLoading(true);
    try {
      const res = await getCapture(businessId, id);
      if (res.error) throw new Error(res.error);
      setCapture(res.data ?? null);
    } catch {
      toast.error("Failed to load capture");
    } finally {
      setLoading(false);
    }
  }, [id, businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleProcess = async () => {
    if (!capture || !businessId) return;
    setActionLoading("process");
    try {
      const res = await processCapture(businessId, capture.asset.id);
      if (res.error) throw new Error(res.error);
      toast.success("AI processing complete");
      load();
    } catch {
      toast.error("AI processing failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async () => {
    if (!capture?.intake || !businessId) return;
    setActionLoading("approve");
    try {
      const res = await approveIntake(businessId, capture.intake.id);
      if (res.error) throw new Error(res.error);
      toast.success("Approved");
      load();
    } catch {
      toast.error("Failed to approve");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!capture?.intake || !businessId) return;
    setActionLoading("reject");
    try {
      const res = await rejectIntake(businessId, capture.intake.id);
      if (res.error) throw new Error(res.error);
      toast.success("Rejected");
      load();
    } catch {
      toast.error("Failed to reject");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateContact = async () => {
    if (!capture?.intake || !businessId) return;
    const data = capture.classification?.extractedData ?? {};
    setActionLoading("contact");
    try {
      const res = await createContactFromCard(businessId, {
        visualIntakeId: capture.intake.id,
        name: data.name as string | undefined,
        phone: data.phone as string | undefined,
        email: data.email as string | undefined,
        company: data.company as string | undefined,
        title: data.title as string | undefined,
        website: data.website as string | undefined,
      });
      if (res.error) throw new Error(res.error);
      toast.success("Contact created");
      load();
    } catch {
      toast.error("Failed to create contact");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateExpense = () => {
    const data = capture?.classification?.extractedData ?? {};
    const prefill = encodeURIComponent(JSON.stringify(data));
    router.push(`/app/expenses?prefill=${prefill}`);
  };

  if (!businessId) {
    return (
      <UnifiedPageShell title="Capture" subtitle="View capture details" icon={Camera}>
        <p className="text-sm text-muted-foreground">
          Select a business to view captures.
        </p>
      </UnifiedPageShell>
    );
  }

  if (loading) {
    return (
      <UnifiedPageShell title="Capture" subtitle="View capture details" icon={Camera}>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </UnifiedPageShell>
    );
  }

  if (!capture) {
    return (
      <UnifiedPageShell title="Capture" subtitle="View capture details" icon={Camera}>
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mb-3" />
          <h2 className="text-lg font-medium">Capture not found</h2>
          <Button onClick={() => router.push("/app/capture")} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Captures
          </Button>
        </div>
      </UnifiedPageShell>
    );
  }

  const { asset, intake, classification } = capture;
  const confidence = intake?.confidenceScore ?? classification?.confidenceScore ?? null;
  const needsReview = confidence != null && confidence < 60;

  return (
    <UnifiedPageShell title="Capture" subtitle="View capture details" icon={Camera}>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/app/capture")}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">
              {asset.fileName || "Capture"}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {intake?.detectedType && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary capitalize">
                  {intake.detectedType.replace(/_/g, " ")}
                </span>
              )}
              <StatusBadge status={intake?.status ?? asset.status} />
              <ConfidenceBadge score={confidence} />
              {needsReview && (
                <span className="text-[10px] font-medium text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Needs review
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main */}
          <div className="lg:col-span-2 space-y-6">
            {asset.publicUrl && asset.mediaType === "image" && (
              <SectionCard noPadding>
                {/* eslint-disable-next-line @next/next/no-img-element -- external capture URL from S3/R2; unoptimized img acceptable here */}
                <img
                  src={asset.publicUrl}
                  alt={asset.fileName ?? "capture"}
                  className="w-full max-h-[60vh] object-contain bg-muted"
                />
              </SectionCard>
            )}

            {classification && (
              <SectionCard title="Extracted Data">
                {classification.extractedData &&
                Object.keys(classification.extractedData).length > 0 ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {Object.entries(classification.extractedData).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt className="text-xs text-muted-foreground capitalize">
                            {key.replace(/_/g, " ")}
                          </dt>
                          <dd className="text-sm font-medium">
                            {String(value)}
                          </dd>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No data extracted.
                  </p>
                )}
              </SectionCard>
            )}

            {/* Actions */}
            <SectionCard title="Actions">
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleProcess}
                  loading={actionLoading === "process"}
                  disabled={!!actionLoading}
                >
                  <BrainCircuit className="w-4 h-4 mr-2" />
                  Process with AI
                </Button>
                {intake?.detectedType === "business_card" && (
                  <Button
                    variant="outline"
                    onClick={handleCreateContact}
                    loading={actionLoading === "contact"}
                    disabled={!!actionLoading}
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Create Contact
                  </Button>
                )}
                {intake?.detectedType === "receipt" && (
                  <Button
                    variant="outline"
                    onClick={handleCreateExpense}
                    disabled={!!actionLoading}
                  >
                    <Receipt className="w-4 h-4 mr-2" />
                    Create Expense
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={handleApprove}
                  loading={actionLoading === "approve"}
                  disabled={!!actionLoading || intake?.status === "ACCEPTED"}
                >
                  <ThumbsUp className="w-4 h-4 mr-2" />
                  Approve
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReject}
                  loading={actionLoading === "reject"}
                  disabled={!!actionLoading || intake?.status === "REJECTED"}
                  className="hover:text-red-600 hover:border-red-300"
                >
                  <ThumbsDown className="w-4 h-4 mr-2" />
                  Reject
                </Button>
              </div>
            </SectionCard>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <SectionCard title="Meta">
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Created</span>
                  <span className="ml-auto">
                    {new Date(asset.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Type</span>
                  <span className="ml-auto capitalize">{asset.mediaType}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Size</span>
                  <span className="ml-auto">
                    {asset.sizeBytes
                      ? `${(asset.sizeBytes / 1024).toFixed(1)} KB`
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">MIME</span>
                  <span className="ml-auto">{asset.contentType}</span>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </UnifiedPageShell>
  );
}
