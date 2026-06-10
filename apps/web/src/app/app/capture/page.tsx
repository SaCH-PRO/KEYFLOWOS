"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  Loader2,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileImage,
  FileText,
  Mic,
  Video,
  BrainCircuit,
  Filter,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { CaptureButton } from "@/components/device/capture-button";
import {
  listCaptures,
  processCapture,
  type CaptureResult,
} from "@/lib/api/device";
import { SectionCard } from "@/components/ui/section-card";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { Button } from "@/components/ui/button";

function mediaTypeIcon(type: string) {
  switch (type) {
    case "image":
      return <FileImage className="w-4 h-4" />;
    case "video":
      return <Video className="w-4 h-4" />;
    case "audio":
      return <Mic className="w-4 h-4" />;
    default:
      return <FileText className="w-4 h-4" />;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "UPLOADED":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">
          Uploaded
        </span>
      );
    case "PROCESSING":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
          Processing
        </span>
      );
    case "PROCESSED":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
          Processed
        </span>
      );
    case "FAILED":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
          Failed
        </span>
      );
    default:
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
          {status}
        </span>
      );
  }
}

function confidenceBadge(score: number | null) {
  if (score == null) return null;
  if (score >= 80) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
        {score}%
      </span>
    );
  }
  if (score >= 60) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
        {score}%
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
      {score}%
    </span>
  );
}

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "business_card", label: "Business card" },
  { value: "receipt", label: "Receipt" },
  { value: "document", label: "Document" },
  { value: "product", label: "Product" },
];

export default function CapturePage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [captures, setCaptures] = useState<CaptureResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filterType, setFilterType] = useState("");
  const [processingAll, setProcessingAll] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    let cancelled = false;
    const doLoad = async () => {
      setLoading(true);
      try {
        const res = await listCaptures(businessId, { limit: 50 });
        if (!cancelled) {
          setCaptures((res.data?.items ?? []) as CaptureResult[]);
          setTotal(res.data?.total ?? 0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    doLoad();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  useEffect(() => {
    const cleanup = load();
    return () => {
      cleanup.then((fn) => fn?.());
    };
  }, [load]);

  const filteredCaptures = filterType
    ? captures.filter((c) => c.intake?.detectedType === filterType)
    : captures;

  const unprocessedCaptures = captures.filter(
    (c) => c.asset.status !== "PROCESSED" && c.asset.status !== "FAILED",
  );

  const handleProcessAll = async () => {
    if (!businessId || unprocessedCaptures.length === 0) return;
    setProcessingAll(true);
    try {
      let processed = 0;
      for (const cap of unprocessedCaptures) {
        const res = await processCapture(businessId, cap.asset.id);
        if (!res.error) processed++;
      }
      toast.success(`Processed ${processed} capture${processed === 1 ? "" : "s"}`);
      load();
    } catch {
      toast.error("Process all failed");
    } finally {
      setProcessingAll(false);
    }
  };

  if (!businessId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Select a business to view captures.
        </p>
      </div>
    );
  }

  return (
    <UnifiedPageShell
      title="Capture"
      subtitle="Scan cards, receipts, documents, and more."
      icon={Camera}
      maxWidth="5xl"
      headerActions={
        <CaptureButton
          businessId={businessId}
          variant="inline"
          onCaptureCreated={load}
        />
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SectionCard className="p-3">
          <p className="text-2xl font-bold">{total}</p>
          <p className="text-xs text-muted-foreground">Total captures</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-2xl font-bold">
            {captures.filter((c) => c.intake?.status === "PENDING").length}
          </p>
          <p className="text-xs text-muted-foreground">Pending review</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-2xl font-bold">
            {captures.filter((c) => c.intake?.detectedType === "business_card")
              .length}
          </p>
          <p className="text-xs text-muted-foreground">Business cards</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-2xl font-bold">
            {captures.filter((c) => c.intake?.detectedType === "receipt").length}
          </p>
          <p className="text-xs text-muted-foreground">Receipts</p>
        </SectionCard>
      </div>

      {/* Capture list */}
      <SectionCard>
        <div className="p-4 border-b border-border/60 flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-semibold">Recent Captures</h2>
          <div className="flex items-center gap-2">
            {loading && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            )}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="text-xs bg-background border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/20"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {unprocessedCaptures.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleProcessAll}
                loading={processingAll}
                disabled={processingAll}
              >
                <BrainCircuit className="w-3.5 h-3.5 mr-1.5" />
                Process All
              </Button>
            )}
          </div>
        </div>

        {loading && captures.length === 0 ? (
          <ListPageSkeleton />
        ) : filteredCaptures.length === 0 ? (
          <div className="p-8 text-center">
            <Camera className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">No captures found</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              Use the Capture button to scan business cards, receipts,
              documents, or products. KEY will extract data and suggest actions.
            </p>
            <div className="mt-4">
              <CaptureButton
                businessId={businessId}
                variant="inline"
                onCaptureCreated={load}
              />
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filteredCaptures.map((cap) => {
              const confidence = cap.intake?.confidenceScore ?? null;
              const needsReview = confidence != null && confidence < 60;
              return (
                <button
                  key={cap.asset.id}
                  onClick={() => router.push(`/app/capture/${cap.asset.id}`)}
                  className="w-full text-left p-4 flex items-start gap-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="mt-0.5 text-muted-foreground">
                    {mediaTypeIcon(cap.asset.mediaType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">
                        {cap.asset.fileName ||
                          cap.intake?.detectedType ||
                          "Capture"}
                      </p>
                      {statusBadge(cap.asset.status)}
                      {confidenceBadge(confidence)}
                      {needsReview && (
                        <span className="text-[10px] font-medium text-red-400 flex items-center gap-0.5">
                          <AlertCircle className="w-3 h-3" />
                          Needs review
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {cap.intake?.detectedType
                        ? `${cap.intake.detectedType.replace(/_/g, " ")} • `
                        : ""}
                      {cap.intake?.summary || cap.asset.mediaType}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(cap.asset.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {cap.intake?.status === "PENDING" ? (
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-1" />
                  ) : cap.intake?.status === "ACCEPTED" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-1" />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Floating capture button for mobile */}
      <div className="md:hidden">
        <CaptureButton
          businessId={businessId}
          variant="fab"
          onCaptureCreated={load}
        />
      </div>
    </UnifiedPageShell>
  );
}
