"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Upload,
  CreditCard,
  Receipt,
  FileText,
  Package,
  Mic,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  createCapture,
  createContactFromCard,
  type CaptureResult,
} from "@/lib/api/device";
import { apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface CaptureSheetProps {
  businessId: string;
  open: boolean;
  onClose: () => void;
  onCaptureCreated?: () => void;
}

type CaptureMode =
  | "camera"
  | "upload"
  | "business_card"
  | "receipt"
  | "document"
  | "product"
  | "voice";

interface CaptureOption {
  id: CaptureMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  capture?: string;
  accept?: string;
}

const OPTIONS: CaptureOption[] = [
  {
    id: "camera",
    label: "Take Photo",
    description: "Capture anything with your camera",
    icon: <Camera className="h-5 w-5" />,
    capture: "environment",
    accept: "image/*",
  },
  {
    id: "upload",
    label: "Upload File",
    description: "Choose from your device",
    icon: <Upload className="h-5 w-5" />,
    accept: "image/*,video/*,audio/*,application/pdf",
  },
  {
    id: "business_card",
    label: "Scan Business Card",
    description: "Extract contact details",
    icon: <CreditCard className="h-5 w-5" />,
    capture: "environment",
    accept: "image/*",
  },
  {
    id: "receipt",
    label: "Scan Receipt",
    description: "Create expense record",
    icon: <Receipt className="h-5 w-5" />,
    capture: "environment",
    accept: "image/*",
  },
  {
    id: "document",
    label: "Scan Document",
    description: "Save and summarize",
    icon: <FileText className="h-5 w-5" />,
    capture: "environment",
    accept: "image/*,application/pdf",
  },
  {
    id: "product",
    label: "Scan Product",
    description: "Update inventory",
    icon: <Package className="h-5 w-5" />,
    capture: "environment",
    accept: "image/*",
  },
  {
    id: "voice",
    label: "Voice Note",
    description: "Record or talk to KEY",
    icon: <Mic className="h-5 w-5" />,
    accept: "audio/*",
  },
];

export function CaptureSheet({
  businessId,
  open,
  onClose,
  onCaptureCreated,
}: CaptureSheetProps) {
  const [step, setStep] = useState<
    "menu" | "uploading" | "result" | "batch-done" | "error"
  >("menu");
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [error, setError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingMode, setPendingMode] = useState<CaptureMode | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const handleOptionClick = (option: CaptureOption) => {
    setPendingMode(option.id);
    if (fileInputRef.current) {
      fileInputRef.current.accept = option.accept ?? "*";
      fileInputRef.current.capture = option.capture ?? "";
      fileInputRef.current.click();
    }
  };

  const uploadFile = async (file: File, mode: CaptureMode) => {
    // 1. Get presigned upload URL
    // businessId is required by BusinessGuard on this route — it reads params,
    // body then query and refuses with "businessId is required" when absent.
    // Omitting it made every capture 403 for non-SUPER_ADMIN users.
    const captureBusinessId = getStoredBusinessId();
    if (!captureBusinessId) {
      throw new Error("No active workspace — cannot upload until a business is selected");
    }
    const presignedRes = await apiPostSimple<{
      uploadURL: string;
      objectPath: string;
    }>("/uploads/request-url", {
      businessId: captureBusinessId,
      name: file.name,
      size: file.size,
      contentType: file.type,
    });
    if (presignedRes.error || !presignedRes.data) {
      throw new Error(presignedRes.error ?? "Failed to get upload URL");
    }
    const presigned = presignedRes.data;

    // 2. Upload file directly to storage
    const uploadRes = await fetch(presigned.uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
    if (!uploadRes.ok) throw new Error("Upload failed");

    // 3. Create capture record
    const mediaType: "image" | "video" | "audio" | "document" = file.type.startsWith(
      "image/",
    )
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "document";

    const publicUrl = presigned.uploadURL.split("?")[0];

    const captureRes = await createCapture(businessId, {
      objectPath: presigned.objectPath,
      publicUrl,
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      mediaType,
      source: "capture",
      captureMode: mode,
    });
    if (captureRes.error || !captureRes.data) {
      throw new Error(captureRes.error ?? "Failed to create capture");
    }

    return captureRes.data;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0 || !pendingMode) return;

    setStep("uploading");
    setError("");
    setBatchProgress({ current: 0, total: files.length });

    try {
      const results: CaptureResult[] = [];
      for (let i = 0; i < files.length; i++) {
        setBatchProgress({ current: i + 1, total: files.length });
        const res = await uploadFile(files[i], pendingMode);
        results.push(res);
      }

      if (files.length === 1 && results[0]) {
        setResult(results[0]);
        setStep("result");
      } else {
        setStep("batch-done");
      }

      onCaptureCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
      setStep("error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setPendingMode(null);
      setBatchProgress(null);
    }
  };

  const handleReset = () => {
    setStep("menu");
    setResult(null);
    setError("");
  };

  const handleDone = () => {
    onClose();
    handleReset();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v: boolean) => {
        if (!v) {
          onClose();
          handleReset();
        }
      }}
    >
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Capture
          </SheetTitle>
        </SheetHeader>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {step === "menu" && (
          <div className="grid grid-cols-1 gap-3 mt-6">
            <p className="text-sm text-muted-foreground mb-2">
              Capture something for your business
            </p>
            {OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleOptionClick(opt)}
                className="flex items-start gap-4 p-4 rounded-xl border bg-card hover:bg-accent transition-colors text-left"
              >
                <div className="mt-0.5 text-primary">{opt.icon}</div>
                <div>
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-sm text-muted-foreground">
                    {opt.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === "uploading" && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground">
              {batchProgress
                ? `Uploading ${batchProgress.current} of ${batchProgress.total}…`
                : "Uploading and analyzing…"}
            </p>
          </div>
        )}

        {step === "result" && result && (
          <CaptureResultView
            result={result}
            businessId={businessId}
            onReset={handleReset}
            onClose={handleDone}
          />
        )}

        {step === "batch-done" && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <p className="font-medium">Uploads complete</p>
            <p className="text-sm text-muted-foreground">
              Your captures have been uploaded and are being processed.
            </p>
            <Button onClick={handleDone}>Done</Button>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="text-destructive font-medium">Capture failed</p>
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              {error}
            </p>
            <Button onClick={handleReset}>Try Again</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CaptureResultView({
  result,
  businessId,
  onReset,
  onClose,
}: {
  result: CaptureResult;
  businessId: string;
  onReset: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { asset, intake, classification } = result;
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleAction = async (action: Record<string, unknown>) => {
    const type = action.type as string;
    if (!type) {
      onClose();
      return;
    }

    if (type === "create_contact") {
      if (!intake) {
        onClose();
        return;
      }
      const data = classification?.extractedData ?? {};
      setActionLoading("contact");
      try {
        const res = await createContactFromCard(businessId, {
          visualIntakeId: intake.id,
          name: data.name as string | undefined,
          phone: data.phone as string | undefined,
          email: data.email as string | undefined,
          company: data.company as string | undefined,
          title: data.title as string | undefined,
          website: data.website as string | undefined,
        });
        if (res.error) throw new Error(res.error);
      } catch {
        // silently fail; user can retry from detail page
      } finally {
        setActionLoading(null);
        onClose();
      }
      return;
    }

    if (type === "create_expense") {
      const data = classification?.extractedData ?? {};
      const amount =
        typeof data.total === "number"
          ? data.total
          : typeof data.amount === "number"
            ? data.amount
            : typeof data.totalAmount === "number"
              ? data.totalAmount
              : undefined;
      const vendor = (data.vendor as string) || (data.merchant as string) || undefined;
      const date =
        (data.date as string) || (data.invoiceDate as string) || (data.dateIssued as string) || undefined;
      const prefill = {
        description: (data.description as string) || classification?.summary || "Captured receipt",
        amount,
        date,
        vendor,
        receiptUrl: asset.publicUrl,
      };
      const qs = encodeURIComponent(JSON.stringify(prefill));
      router.push(`/app/expenses?prefill=${qs}`);
      return;
    }

    if (type === "review" || type === "review_manually") {
      router.push(`/app/capture/${asset.id}`);
      return;
    }

    // Default fallback for unknown actions
    onClose();
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-2 text-green-600">
        <CheckCircle2 className="h-5 w-5" />
        <span className="font-medium">Captured successfully</span>
      </div>

      {asset.publicUrl && (
        <div className="rounded-lg overflow-hidden border bg-muted">
          {asset.mediaType === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- external capture URL from S3/R2; unoptimized img acceptable here
            <img
              src={asset.publicUrl}
              alt={asset.fileName ?? "capture"}
              className="w-full h-48 object-cover"
            />
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground">
              {asset.fileName}
            </div>
          )}
        </div>
      )}

      {classification && (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Detected
            </span>
            <ConfidenceBadge score={classification.confidenceScore} />
          </div>
          <p className="font-medium capitalize">
            {classification.detectedType.replace(/_/g, " ")}
          </p>
          <p className="text-sm text-muted-foreground">
            {classification.summary}
          </p>

          {classification.extractedData &&
            Object.keys(classification.extractedData).length > 0 && (
              <div className="pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Extracted
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {Object.entries(classification.extractedData).map(
                    ([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="text-muted-foreground capitalize">
                          {key.replace(/_/g, " ")}
                        </dt>
                        <dd className="font-medium">{String(value)}</dd>
                      </div>
                    ),
                  )}
                </dl>
              </div>
            )}

          {classification.recommendedActions.length > 0 && (
            <div className="pt-2 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Suggested Actions
              </p>
              {classification.recommendedActions.map(
                (action: Record<string, unknown>, i: number) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    loading={actionLoading === `action-${i}`}
                    disabled={!!actionLoading}
                    onClick={() => handleAction(action)}
                  >
                    {action.label ? String(action.label) : "Action"}
                  </Button>
                ),
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onReset}>
          <Camera className="h-4 w-4 mr-2" />
          Capture Another
        </Button>
        <Button className="flex-1" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 80) {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
        {score}% confidence
      </span>
    );
  }
  if (score >= 60) {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">
        {score}% confidence
      </span>
    );
  }
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
      {score}% confidence
    </span>
  );
}
