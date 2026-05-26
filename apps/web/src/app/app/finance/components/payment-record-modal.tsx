"use client";

import React, { useState, useMemo } from "react";
import {
  DollarSign,
  CreditCard,
  Banknote,
  Wallet,
  FileText,
  Upload,
  HardDrive,
  ScanLine,
  FileImage,
  X,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { SideSheet } from "../../commerce/components/side-sheet";
import { formatCurrency } from "@/lib/currency";
import type { Invoice } from "@/lib/client";
import { recordPaymentFromEvidence } from "@/lib/client";
import { useUpload } from "@/hooks/use-upload";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const METHODS = [
  { key: "CASH", label: "Cash", icon: Banknote },
  { key: "BANK_TRANSFER", label: "Bank Transfer", icon: CreditCard },
  { key: "WIPAY", label: "WiPay", icon: Wallet },
  { key: "PAYPAL", label: "PayPal", icon: CreditCard },
  { key: "OTHER", label: "Other", icon: FileText },
];

const ACCENT = "rgb(16,185,129)";
const ACCENT_BG = "rgba(16,185,129,0.15)";
const ACCENT_BORDER = "rgba(16,185,129,0.3)";

interface PaymentRecordModalProps {
  invoice: Invoice | null;
  businessId: string | null;
  onClose: () => void;
  onSubmit: (invoice: Invoice, form: { amount: string; method: string; reference: string; notes: string }) => void;
  loading?: boolean;
}

export function PaymentRecordModal({ invoice, businessId, onClose, onSubmit, loading }: PaymentRecordModalProps) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  // Evidence import state
  const [evidenceFile, setEvidenceFile] = useState<{
    url: string;
    mimeType: string;
    filename: string;
    source: 'drive' | 'upload';
    driveFileId?: string;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  const { uploadFile, isUploading, progress } = useUpload();

  const paidSoFar = useMemo(() =>
    (invoice?.payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0),
  [invoice]);

  const remaining = useMemo(() =>
    invoice ? Math.max(0, Number(invoice.total) - paidSoFar) : 0,
  [invoice, paidSoFar]);

  const handleClose = () => {
    setAmount("");
    setMethod("CASH");
    setReference("");
    setNotes("");
    setEvidenceFile(null);
    setScanError(null);
    setShowDrivePicker(false);
    onClose();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error("Only PDF and image files are supported");
      return;
    }
    const result = await uploadFile(file);
    if (result) {
      setEvidenceFile({
        url: result.uploadURL,
        mimeType: file.type,
        filename: file.name,
        source: 'upload',
      });
      setScanError(null);
    }
  };

  const handleDriveSelect = (file: { id: string; name: string; mimeType: string }) => {
    setEvidenceFile({
      url: `https://drive.google.com/file/d/${file.id}/view`,
      mimeType: file.mimeType,
      filename: file.name,
      source: 'drive',
      driveFileId: file.id,
    });
    setShowDrivePicker(false);
    setScanError(null);
  };

  const handleScan = async () => {
    if (!evidenceFile || !invoice || !businessId) return;
    setScanning(true);
    setScanError(null);
    try {
      const res = await recordPaymentFromEvidence(businessId, invoice.id, {
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
        toast.success(`Payment recorded from ${evidenceFile.filename}`);
        handleClose();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      setScanError(msg);
      toast.error(msg);
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = () => {
    if (!invoice) return;
    onSubmit(invoice, { amount, method, reference, notes });
  };

  if (!invoice) return null;

  return (
    <SideSheet
      open={!!invoice}
      onClose={handleClose}
      title="Record Payment"
      subtitle={`Invoice ${invoice.invoiceNumber ?? invoice.id.slice(0, 8)} · ${formatCurrency(Number(invoice.total), invoice.currency)}`}
      width="md"
      icon={
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}` }}
        >
          <DollarSign className="w-5 h-5" style={{ color: ACCENT }} />
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            <span className="block">Remaining</span>
            <span className="font-semibold text-amber-400">{formatCurrency(remaining, invoice.currency)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors border border-border/40"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !amount}
              className="px-4 py-2.5 rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
              style={{
                background: ACCENT_BG,
                color: ACCENT,
                border: `1px solid ${ACCENT_BORDER}`,
              }}
            >
              {loading ? "Recording..." : "Record Payment"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Evidence import section */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-border/40 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Import Evidence</p>

          {!evidenceFile ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border border-border/40 hover:border-[hsl(var(--kf-accent1))]/40 hover:bg-[hsl(var(--kf-accent1))]/5 transition-all cursor-pointer text-center">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground">Upload File</span>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} />
              </label>
              <button
                onClick={() => setShowDrivePicker(true)}
                className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border border-border/40 hover:border-[hsl(var(--kf-accent1))]/40 hover:bg-[hsl(var(--kf-accent1))]/5 transition-all text-center"
              >
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground">Google Drive</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.03] border border-border/30">
                {evidenceFile.mimeType.startsWith("image/") ? (
                  <FileImage className="w-4 h-4 text-purple-400 shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span className="text-xs truncate flex-1">{evidenceFile.filename}</span>
                <button
                  onClick={() => { setEvidenceFile(null); setScanError(null); }}
                  className="p-1 rounded hover:bg-white/[0.05] shrink-0"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>

              {!scanError && (
                <button
                  onClick={handleScan}
                  disabled={scanning || isUploading}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors disabled:opacity-50"
                >
                  {scanning || isUploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ScanLine className="w-3.5 h-3.5" />
                  )}
                  {isUploading ? `Uploading ${progress}%` : scanning ? "Scanning document..." : "Scan & Record Payment"}
                </button>
              )}

              {scanError && (
                <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {scanError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Invoice summary */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-border/40 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Invoice total</span>
            <span className="font-semibold text-foreground">{formatCurrency(Number(invoice.total), invoice.currency)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Already paid</span>
            <span className="text-emerald-400">{formatCurrency(paidSoFar, invoice.currency)}</span>
          </div>
          <div className="flex items-center justify-between text-xs border-t border-border/30 pt-1">
            <span className="text-muted-foreground">Remaining</span>
            <span className="font-semibold text-amber-400">{formatCurrency(remaining, invoice.currency)}</span>
          </div>
        </div>

        {/* Form fields */}
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Amount</label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(remaining)}
            className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Method</label>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const active = method === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMethod(m.key)}
                  className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-[10px] font-medium transition-all ${
                    active
                      ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                      : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border/60"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Reference (optional)</label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Transaction ID, check number..."
            className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Any additional notes..."
            className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40 resize-none"
          />
        </div>
      </div>

      {/* Google Drive Picker Modal */}
      <AnimatePresence>
        {showDrivePicker && businessId && (
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
                {/* Dynamically import GoogleDriveBrowser to avoid bundling issues */}
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

// Lazy wrapper for GoogleDriveBrowser to keep the modal lightweight
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
