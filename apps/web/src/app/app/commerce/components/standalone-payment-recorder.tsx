"use client";

import React, { useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DollarSign,
  Upload,
  HardDrive,
  ScanLine,
  FileImage,
  FileText,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  ArrowRight,
  ChevronLeft,
  User,
  Calendar,
  Hash,
  Banknote,
} from "lucide-react";
import { SideSheet } from "./side-sheet";
import { useUpload } from "@/hooks/use-upload";
import { useDriveUpload } from "@/hooks/use-drive-upload";
import { formatCurrency } from "@/lib/currency";
import { extractPaymentEvidence, recordPaymentFromEvidence } from "@/lib/client";
import { toast } from "sonner";

const ACCENT = "rgb(16,185,129)";
const ACCENT_BG = "rgba(16,185,129,0.15)";
const ACCENT_BORDER = "rgba(16,185,129,0.3)";

type Step = "upload" | "review" | "recorded";

interface ExtractedData {
  amount: number;
  method: string;
  reference?: string;
  notes?: string;
  confidence: number;
  date?: string;
  payer?: string;
}

interface CandidateInvoice {
  id: string;
  invoiceNumber: string | null;
  total: number;
  remaining: number;
  currency: string;
  status: string;
  contactName: string;
  dueDate: string | null;
}

interface StandalonePaymentRecorderProps {
  businessId: string;
  open: boolean;
  onClose: () => void;
  onRecorded?: () => void;
}

export function StandalonePaymentRecorder({
  businessId,
  open,
  onClose,
  onRecorded,
}: StandalonePaymentRecorderProps) {
  const [step, setStep] = useState<Step>("upload");
  const [evidenceFile, setEvidenceFile] = useState<{
    url: string;
    mimeType: string;
    filename: string;
    source: "drive" | "upload";
    driveFileId?: string;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [candidates, setCandidates] = useState<CandidateInvoice[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedResult, setRecordedResult] = useState<{
    paymentId: string;
    invoiceId: string;
    amount: number;
    invoiceStatus: string;
  } | null>(null);

  const { uploadFile, isUploading, progress } = useUpload();
  const { uploadToDrive } = useDriveUpload();
  const evidenceBufferRef = useRef<ArrayBuffer | null>(null);

  const reset = () => {
    setStep("upload");
    setEvidenceFile(null);
    setScanError(null);
    setShowDrivePicker(false);
    setExtracted(null);
    setCandidates([]);
    setSelectedInvoiceId(null);
    setRecording(false);
    setRecordedResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error("Only PDF and image files are supported");
      return;
    }
    const arr = await file.arrayBuffer();
    evidenceBufferRef.current = arr;
    const result = await uploadFile(file);
    if (result) {
      setEvidenceFile({
        url: result.uploadURL,
        mimeType: file.type,
        filename: file.name,
        source: "upload",
      });
      setScanError(null);
    }
  };

  const handleDriveSelect = (file: { id: string; name: string; mimeType: string }) => {
    setEvidenceFile({
      url: `https://drive.google.com/file/d/${file.id}/view`,
      mimeType: file.mimeType,
      filename: file.name,
      source: "drive",
      driveFileId: file.id,
    });
    setShowDrivePicker(false);
    setScanError(null);
  };

  const handleScan = async () => {
    if (!evidenceFile) return;
    setScanning(true);
    setScanError(null);
    try {
      const res = await extractPaymentEvidence(businessId, {
        evidenceUrl: evidenceFile.url,
        evidenceMimeType: evidenceFile.mimeType,
        filename: evidenceFile.filename,
        source: evidenceFile.source,
        driveFileId: evidenceFile.driveFileId,
      });
      if (res.error) {
        setScanError(res.error);
        toast.error(res.error);
      } else if (res.data) {
        setExtracted(res.data.extracted);
        setCandidates(res.data.candidates);
        setStep("review");
        if (res.data.candidates.length > 0) {
          setSelectedInvoiceId(res.data.candidates[0].id);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      setScanError(msg);
      toast.error(msg);
    } finally {
      setScanning(false);
    }
  };

  const handleRecord = async () => {
    if (!evidenceFile || !selectedInvoiceId || !extracted) return;
    setRecording(true);
    try {
      const res = await recordPaymentFromEvidence(businessId, selectedInvoiceId, {
        evidenceUrl: evidenceFile.url,
        evidenceMimeType: evidenceFile.mimeType,
        filename: evidenceFile.filename,
        source: evidenceFile.source,
        driveFileId: evidenceFile.driveFileId,
      });
      if (res.error) {
        toast.error(res.error);
      } else if (res.data) {
        setRecordedResult({
          paymentId: res.data.payment.id,
          invoiceId: selectedInvoiceId,
          amount: res.data.payment.amount,
          invoiceStatus: res.data.invoiceStatus,
        });

        // Upload evidence to Google Drive if it was a file upload (not from Drive)
        if (evidenceBufferRef.current && evidenceFile?.source === "upload") {
          uploadToDrive({
            businessId,
            entityType: "payment",
            entityId: res.data.payment.id,
            fileName: `PaymentEvidence-${evidenceFile.filename}`,
            mimeType: evidenceFile.mimeType || "application/octet-stream",
            content: evidenceBufferRef.current,
            contentFormat: "binary",
            silent: true,
          }).then((ok) => {
            if (ok) toast.success("Evidence saved to Drive");
          });
        }

        setStep("recorded");
        toast.success(`Payment of ${formatCurrency(res.data.payment.amount, res.data.payment.currency)} recorded`);
        onRecorded?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to record payment";
      toast.error(msg);
    } finally {
      setRecording(false);
    }
  };

  const selectedInvoice = useMemo(
    () => candidates.find((c) => c.id === selectedInvoiceId) ?? null,
    [candidates, selectedInvoiceId],
  );

  return (
    <SideSheet
      open={open}
      onClose={handleClose}
      title="Record Payment"
      subtitle={step === "upload" ? "Upload payment evidence and let AI do the rest" : step === "review" ? "Review extracted details and match to an invoice" : "Payment recorded successfully"}
      width="lg"
      icon={
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}` }}
        >
          <DollarSign className="w-5 h-5" style={{ color: ACCENT }} />
        </div>
      }
      footer={
        step === "review" ? (
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setStep("upload")}
              className="px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors border border-border/40 inline-flex items-center gap-1.5"
            >
              <ChevronLeft className="w-3 h-3" />
              Back
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClose}
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors border border-border/40"
              >
                Cancel
              </button>
              <button
                onClick={handleRecord}
                disabled={recording || !selectedInvoiceId}
                className="px-4 py-2.5 rounded-xl text-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                style={{
                  background: ACCENT_BG,
                  color: ACCENT,
                  border: `1px solid ${ACCENT_BORDER}`,
                }}
              >
                {recording ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Recording...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Record Payment
                  </>
                )}
              </button>
            </div>
          </div>
        ) : step === "recorded" ? (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl text-xs font-medium transition-colors"
              style={{
                background: ACCENT_BG,
                color: ACCENT,
                border: `1px solid ${ACCENT_BORDER}`,
              }}
            >
              Done
            </button>
          </div>
        ) : undefined
      }
    >
      <AnimatePresence mode="wait">
        {step === "upload" && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            {/* Upload area */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-border/40 space-y-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Payment Evidence</p>
              <p className="text-xs text-muted-foreground">
                Upload a screenshot, receipt, or bank transfer confirmation. Our AI will extract the payment amount,
                date, and reference, then match it to the right invoice.
              </p>

              {!evidenceFile ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col items-center gap-2 px-4 py-6 rounded-xl border border-border/40 hover:border-[hsl(var(--kf-accent1))]/40 hover:bg-[hsl(var(--kf-accent1))]/5 transition-all cursor-pointer text-center">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                    <span className="text-xs font-medium">Upload File</span>
                    <span className="text-[10px] text-muted-foreground/60">PDF or image</span>
                    <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} />
                  </label>
                  <button
                    onClick={() => setShowDrivePicker(true)}
                    className="flex flex-col items-center gap-2 px-4 py-6 rounded-xl border border-border/40 hover:border-[hsl(var(--kf-accent1))]/40 hover:bg-[hsl(var(--kf-accent1))]/5 transition-all text-center"
                  >
                    <HardDrive className="w-5 h-5 text-muted-foreground" />
                    <span className="text-xs font-medium">Google Drive</span>
                    <span className="text-[10px] text-muted-foreground/60">Pick from Drive</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-border/30">
                    {evidenceFile.mimeType.startsWith("image/") ? (
                      <FileImage className="w-5 h-5 text-purple-400 shrink-0" />
                    ) : (
                      <FileText className="w-5 h-5 text-red-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{evidenceFile.filename}</p>
                      <p className="text-[10px] text-muted-foreground/60 capitalize">{evidenceFile.source} · {evidenceFile.mimeType.split("/")[1]}</p>
                    </div>
                    <button
                      onClick={() => { setEvidenceFile(null); setScanError(null); }}
                      className="p-1.5 rounded hover:bg-white/[0.05] shrink-0"
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>

                  {!scanError && (
                    <button
                      onClick={handleScan}
                      disabled={scanning || isUploading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors disabled:opacity-50"
                    >
                      {scanning || isUploading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ScanLine className="w-3.5 h-3.5" />
                      )}
                      {isUploading ? `Uploading ${progress}%` : scanning ? "Scanning document..." : "Scan & Find Invoice"}
                    </button>
                  )}

                  {scanError && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-400">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {scanError}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Manual option */}
            <div className="p-3 rounded-xl border border-border/30 bg-white/[0.01]">
              <p className="text-[10px] text-muted-foreground/60 text-center">
                After scanning, you&apos;ll be able to review the extracted details and select the matching invoice.
              </p>
            </div>
          </motion.div>
        )}

        {step === "review" && (
          <motion.div
            key="review"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            {/* Extracted details */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-border/40 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Extracted Details</p>
                {extracted && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${extracted.confidence >= 0.8 ? "bg-emerald-500/10 text-emerald-400" : extracted.confidence >= 0.5 ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"}`}>
                    {Math.round(extracted.confidence * 100)}% confidence
                  </span>
                )}
              </div>

              {extracted ? (
                <div className="grid grid-cols-2 gap-3">
                  <DetailItem icon={DollarSign} label="Amount" value={formatCurrency(extracted.amount, "TTD")} />
                  <DetailItem icon={Banknote} label="Method" value={extracted.method} />
                  {extracted.reference && <DetailItem icon={Hash} label="Reference" value={extracted.reference} />}
                  {extracted.date && <DetailItem icon={Calendar} label="Date" value={extracted.date} />}
                  {extracted.payer && <DetailItem icon={User} label="Payer" value={extracted.payer} />}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                  Could not extract payment details. Please select an invoice and record manually.
                </div>
              )}
            </div>

            {/* Candidate invoices */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {candidates.length > 0 ? "Matching Invoices" : "No unpaid invoices found"}
              </p>

              {candidates.length === 0 && (
                <div className="p-4 rounded-xl border border-border/30 bg-white/[0.01] text-center">
                  <FileText className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No outstanding invoices to match against.</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">Create an invoice first, then try recording payment again.</p>
                </div>
              )}

              <div className="space-y-2">
                {candidates.map((candidate, idx) => (
                  <button
                    key={candidate.id}
                    onClick={() => setSelectedInvoiceId(candidate.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      selectedInvoiceId === candidate.id
                        ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/5"
                        : "border-border/30 bg-white/[0.02] hover:border-border/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          selectedInvoiceId === candidate.id
                            ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]"
                            : "border-border/40"
                        }`}>
                          {selectedInvoiceId === candidate.id && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">
                            Invoice #{candidate.invoiceNumber ?? candidate.id.slice(0, 8)}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {candidate.contactName}
                            {candidate.dueDate && ` · Due ${new Date(candidate.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-semibold">{formatCurrency(candidate.remaining, candidate.currency)}</p>
                        <p className="text-[9px] text-muted-foreground/60">remaining</p>
                      </div>
                    </div>
                    {idx === 0 && extracted && (
                      <div className="mt-1.5 ml-6">
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                          Best match
                        </span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {step === "recorded" && recordedResult && (
          <motion.div
            key="recorded"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="space-y-5"
          >
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">Payment Recorded</h3>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(recordedResult.amount, "TTD")} was recorded against the invoice.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white/[0.02] border border-border/40 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatCurrency(recordedResult.amount, "TTD")}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Invoice status</span>
                <span className={`font-medium ${recordedResult.invoiceStatus === "PAID" ? "text-emerald-400" : "text-amber-400"}`}>
                  {recordedResult.invoiceStatus}
                </span>
              </div>
              {selectedInvoice && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Invoice</span>
                  <span className="font-medium">#{selectedInvoice.invoiceNumber ?? selectedInvoice.id.slice(0, 8)}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Google Drive Picker Modal */}
      <AnimatePresence>
        {showDrivePicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            onClick={() => setShowDrivePicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[80vh] bg-card rounded-2xl border border-border/60 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
                <h3 className="text-sm font-semibold">Select Payment Evidence</h3>
                <button
                  onClick={() => setShowDrivePicker(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-muted rounded-xl transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <DrivePickerLazy
                  businessId={businessId}
                  onSelect={handleDriveSelect}
                  allowedMimeTypes={["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SideSheet>
  );
}

function DetailItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.03] border border-border/20">
      <Icon className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
      <div>
        <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{label}</p>
        <p className="text-xs font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

// Lazy wrapper for GoogleDriveBrowser
function DrivePickerLazy({
  businessId,
  onSelect,
  allowedMimeTypes,
}: {
  businessId: string;
  onSelect: (file: { id: string; name: string; mimeType: string }) => void;
  allowedMimeTypes?: string[];
}) {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);

  React.useEffect(() => {
    import("../../profile/components/google-drive-browser").then((mod) => {
      setComponent(() => mod.default);
    });
  }, []);

  if (!Component) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Component
      businessId={businessId}
      onSelect={onSelect}
      allowedMimeTypes={allowedMimeTypes}
      pickerTitle="Select a PDF or image file"
    />
  );
}
