"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  ScanLine,
  Image as ImageIcon,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { scanContactImage } from "@/lib/client";
import { toast } from "sonner";

interface ContactScanButtonProps {
  businessId?: string;
  onScanSuccess?: () => void;
}

export function ContactScanButton({ businessId, onScanSuccess }: ContactScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const reset = useCallback(() => {
    setImage(null);
    setPreview(null);
    setResult(null);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const handleCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImage(f);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  const handleProcess = async () => {
    if (!image || !businessId) return;
    setProcessing(true);
    try {
      const r = await scanContactImage(image, businessId);
      const name = [r.extracted?.firstName, r.extracted?.lastName].filter(Boolean).join(" ") || "Contact";
      setResult(`${name} added!`);
      toast.success(`${name} created from scan`);
      onScanSuccess?.();
      setTimeout(() => { handleClose(); }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not process this image";
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  const modal = open && mounted ? createPortal(
    <AnimatePresence>
      <motion.div
        key="scan-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div
        key="scan-wrap"
        className="fixed inset-0 z-[101] flex items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto pointer-events-none"
      >
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          role="dialog"
          aria-label="Scan contact"
          aria-modal="true"
          className="pointer-events-auto w-full max-w-[440px] mt-[10vh] sm:mt-0 rounded-2xl bg-popover/95 backdrop-blur-xl border border-border/60 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-4 flex items-center justify-between border-b border-border/40 bg-purple-500/5">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/15">
                <ScanLine className="w-4 h-4 text-purple-500" />
              </div>
              <div>
                <h2 className="text-sm font-semibold leading-tight">Scan contact</h2>
                <p className="text-[11px] text-muted-foreground/70 leading-tight mt-0.5">
                  Business card, name tag, or contact info on screen
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="p-5 space-y-3">
            {!preview ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/5 transition-all"
                  >
                    <Camera className="w-6 h-6 text-purple-500" />
                    <span className="text-xs font-medium">Take Photo</span>
                  </button>
                  <button
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/5 transition-all"
                  >
                    <ImageIcon className="w-6 h-6 text-purple-500" />
                    <span className="text-xs font-medium">From Gallery</span>
                  </button>
                </div>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleCapture}
                  className="hidden"
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCapture}
                  className="hidden"
                />
                <div className="p-2.5 rounded-xl bg-purple-500/5 border border-purple-500/10">
                  <p className="text-[11px] text-purple-400 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    Works best with business cards, name tags, flyers, or contact info on screen
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="relative rounded-xl overflow-hidden border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied image preview */}
                  <img
                    src={preview}
                    alt="Scan preview"
                    className="w-full max-h-48 object-contain bg-black/20"
                  />
                  <button
                    onClick={reset}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
                    aria-label="Clear image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {result ? (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="text-sm text-green-500 font-medium">{result}</span>
                  </div>
                ) : (
                  <button
                    onClick={handleProcess}
                    disabled={processing || !businessId}
                    className="kf-btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {processing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Extracting contact info...
                      </>
                    ) : (
                      <>
                        <ScanLine className="w-4 h-4" />
                        Extract Contact
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  ) : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!businessId}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/50 bg-white/[0.03] text-foreground hover:bg-white/[0.06] hover:border-purple-500/40 hover:text-purple-400 text-xs font-medium transition-all flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/[0.03] disabled:hover:border-border/50 disabled:hover:text-foreground"
        aria-label="Scan contact"
        title={businessId ? "Scan business card or contact" : "Select a workspace first"}
      >
        <ScanLine className="w-4 h-4" />
        <span className="hidden sm:inline">Scan</span>
      </button>
      {modal}
    </>
  );
}
