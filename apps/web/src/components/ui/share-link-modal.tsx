"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Copy,
  Check,
  Share2,
  MessageCircle,
  QrCode,
  ExternalLink,
  Facebook,
  Twitter,
} from "lucide-react";

interface ShareLinkModalProps {
  open: boolean;
  onClose: () => void;
  url: string;
  title?: string;
  description?: string;
}

export function ShareLinkModal({
  open,
  onClose,
  url,
  title = "Share Link",
  description,
}: ShareLinkModalProps) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      inputRef.current?.select();
      document.execCommand("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [url]);

  const shareWhatsApp = useCallback(() => {
    const text = description
      ? `${description}\n\n${url}`
      : url;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }, [url, description]);

  const shareFacebook = useCallback(() => {
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }, [url]);

  const shareTwitter = useCallback(() => {
    const text = description || title;
    window.open(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }, [url, title, description]);

  const qrImageUrl = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(url)}&choe=UTF-8`;

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setShowQr(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div
            className="absolute inset-0"
            style={{ background: "hsl(var(--kf-bg) / 0.7)", backdropFilter: "blur(8px)" }}
            onClick={onClose}
          />

          <motion.div
            className="relative w-full max-w-md kf-card kf-radius-lg p-6 space-y-5"
            style={{
              borderColor: "hsl(var(--border))",
              background: "hsl(var(--card))",
            }}
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 kf-radius-md flex items-center justify-center"
                  style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                >
                  <Share2 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <h3 className="kf-text-heading font-semibold">{title}</h3>
                  {description && (
                    <p className="kf-text-caption" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {description}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 kf-radius-sm hover:bg-muted/30 transition-colors"
              >
                <X className="w-4 h-4" style={{ color: "hsl(var(--muted-foreground))" }} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div
                className="flex-1 flex items-center gap-2 px-3 py-2.5 kf-radius-md overflow-hidden"
                style={{
                  background: "hsl(var(--muted) / 0.2)",
                  border: "1px solid hsl(var(--border))",
                }}
              >
                <ExternalLink
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                />
                <input
                  ref={inputRef}
                  readOnly
                  value={url}
                  className="flex-1 bg-transparent kf-text-caption truncate outline-none"
                  style={{ color: "hsl(var(--foreground))" }}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3.5 py-2.5 kf-radius-md kf-text-caption font-medium transition-all duration-200"
                style={{
                  background: copied
                    ? "hsl(var(--kf-success) / 0.15)"
                    : "hsl(var(--kf-accent1))",
                  color: copied
                    ? "hsl(var(--kf-success))"
                    : "hsl(var(--kf-bg))",
                }}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="space-y-2.5">
              <p
                className="kf-text-micro font-medium uppercase tracking-wider"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Share via
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={shareWhatsApp}
                  className="flex items-center gap-2.5 px-3.5 py-3 kf-radius-md transition-all duration-200 hover:scale-[1.01] active:scale-[0.98]"
                  style={{
                    background: "hsl(142 70% 45% / 0.08)",
                    border: "1px solid hsl(142 70% 45% / 0.15)",
                    color: "hsl(142 70% 49%)",
                  }}
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="kf-text-caption font-medium">WhatsApp</span>
                </button>

                <button
                  onClick={shareFacebook}
                  className="flex items-center gap-2.5 px-3.5 py-3 kf-radius-md transition-all duration-200 hover:scale-[1.01] active:scale-[0.98]"
                  style={{
                    background: "hsl(220 70% 55% / 0.08)",
                    border: "1px solid hsl(220 70% 55% / 0.15)",
                    color: "hsl(220 70% 55%)",
                  }}
                >
                  <Facebook className="w-4 h-4" />
                  <span className="kf-text-caption font-medium">Facebook</span>
                </button>

                <button
                  onClick={shareTwitter}
                  className="flex items-center gap-2.5 px-3.5 py-3 kf-radius-md transition-all duration-200 hover:scale-[1.01] active:scale-[0.98]"
                  style={{
                    background: "hsl(203 89% 53% / 0.08)",
                    border: "1px solid hsl(203 89% 53% / 0.15)",
                    color: "hsl(203 89% 53%)",
                  }}
                >
                  <Twitter className="w-4 h-4" />
                  <span className="kf-text-caption font-medium">Twitter</span>
                </button>

                <button
                  onClick={() => setShowQr(!showQr)}
                  className="flex items-center gap-2.5 px-3.5 py-3 kf-radius-md transition-all duration-200 hover:scale-[1.01] active:scale-[0.98]"
                  style={{
                    background: showQr
                      ? "hsl(var(--kf-accent1) / 0.12)"
                      : "hsl(var(--muted) / 0.15)",
                    border: showQr
                      ? "1px solid hsl(var(--kf-accent1) / 0.25)"
                      : "1px solid hsl(var(--border))",
                    color: showQr
                      ? "hsl(var(--kf-accent1))"
                      : "hsl(var(--muted-foreground))",
                  }}
                >
                  <QrCode className="w-4 h-4" />
                  <span className="kf-text-caption font-medium">QR Code</span>
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showQr && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div
                    className="flex flex-col items-center gap-3 py-4 kf-radius-md"
                    style={{
                      background: "hsl(var(--muted) / 0.1)",
                      border: "1px solid hsl(var(--border))",
                    }}
                  >
                    <img
                      src={qrImageUrl}
                      alt="QR code for booking link"
                      width={180}
                      height={180}
                      className="kf-radius-sm"
                    />
                    <p
                      className="kf-text-micro"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Scan to open booking page
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
