"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Copy, ExternalLink, CheckCircle2, Share2,
  MessageCircle, ChevronDown, Download, QrCode,
} from "lucide-react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import QRCode from "qrcode";

type Props = {
  storeEnabled: boolean;
  publicUrl: string;
  onToggleEnabled: () => void;
};

export function StoreHeaderActions({ storeEnabled, publicUrl, onToggleEnabled }: Props) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!publicUrl) return;
    QRCode.toDataURL(publicUrl, {
      width: 200,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then(setQrDataUrl).catch(() => setQrDataUrl(""));
  }, [publicUrl]);

  const copyPublicLink = useCallback(() => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setLinkCopied(true);
    setShareOpen(false);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [publicUrl]);

  const handleWhatsAppShare = useCallback(() => {
    if (!publicUrl) return;
    const text = encodeURIComponent(`Check out our store: ${publicUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
    setShareOpen(false);
  }, [publicUrl]);

  const downloadQr = useCallback(() => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = "store-qr-code.png";
    a.click();
    setShareOpen(false);
  }, [qrDataUrl]);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={onToggleEnabled}
        className="relative h-9 rounded-full px-1 transition-all duration-300 flex items-center"
        style={{
          width: "140px",
          background: storeEnabled
            ? "linear-gradient(135deg, hsl(142 70% 45% / 0.2), hsl(142 70% 45% / 0.1))"
            : "linear-gradient(135deg, hsl(40 90% 50% / 0.2), hsl(40 90% 50% / 0.1))",
          border: storeEnabled
            ? "1px solid hsl(142 70% 45% / 0.3)"
            : "1px solid hsl(40 90% 50% / 0.3)",
        }}
      >
        <motion.div
          layout
          className="absolute h-7 rounded-full flex items-center justify-center px-3 text-xs font-semibold"
          style={{
            width: "68px",
            left: storeEnabled ? "68px" : "2px",
            background: storeEnabled ? "hsl(142 70% 45% / 0.3)" : "hsl(40 90% 50% / 0.3)",
            color: storeEnabled ? "hsl(142 70% 90%)" : "hsl(40 90% 90%)",
          }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
        >
          {storeEnabled ? "Live" : "Draft"}
        </motion.div>
        <span
          className="absolute text-[10px] font-medium"
          style={{
            left: storeEnabled ? "16px" : "auto",
            right: storeEnabled ? "auto" : "16px",
            color: storeEnabled ? "hsl(142 70% 60% / 0.6)" : "hsl(40 90% 60% / 0.6)",
          }}
        >
          {storeEnabled ? "ON" : "OFF"}
        </span>
      </button>

      <div className="relative" ref={shareRef}>
        <button
          onClick={() => setShareOpen(!shareOpen)}
          disabled={!publicUrl || !storeEnabled}
          className="kf-btn-secondary min-h-[44px] inline-flex items-center gap-1.5 text-sm"
          style={{ opacity: !publicUrl || !storeEnabled ? 0.4 : 1 }}
        >
          {linkCopied ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <Share2 className="w-4 h-4" />
          )}
          {linkCopied ? "Copied!" : "Share"}
          <ChevronDown className={`w-3 h-3 transition-transform ${shareOpen ? "rotate-180" : ""}`} />
        </button>

        <AnimatePresence>
          {shareOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden z-50"
              style={{
                background: "hsl(var(--kf-background) / 0.98)",
                backdropFilter: "blur(24px)",
                border: "1px solid hsl(var(--kf-border))",
                boxShadow: "0 12px 40px hsl(0 0% 0% / 0.5)",
              }}
            >
              <div className="px-4 pt-3 pb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }}>
                  Store Link
                </p>
                <div
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-mono truncate"
                  style={{
                    background: "hsl(var(--kf-muted) / 0.2)",
                    border: "1px solid hsl(var(--kf-border) / 0.4)",
                    color: "hsl(var(--kf-foreground))",
                  }}
                >
                  <span className="truncate flex-1">{publicUrl}</span>
                </div>
              </div>

              {qrDataUrl && (
                <div className="flex flex-col items-center px-4 py-3 gap-2">
                  <div
                    className="rounded-xl p-3 bg-white"
                    style={{ boxShadow: "0 2px 12px hsl(0 0% 0% / 0.15)" }}
                  >
                    <img src={qrDataUrl} alt="Store QR Code" className="w-[160px] h-[160px]" />
                  </div>
                  <p className="text-[10px] text-center" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }}>
                    Scan to visit your store
                  </p>
                </div>
              )}

              <div style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.4)" }}>
                <button
                  onClick={copyPublicLink}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[hsl(var(--kf-muted)/0.3)] transition-colors text-left min-h-[44px]"
                >
                  <Copy className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                  <span>Copy Link</span>
                </button>
                {qrDataUrl && (
                  <button
                    onClick={downloadQr}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[hsl(var(--kf-muted)/0.3)] transition-colors text-left min-h-[44px]"
                  >
                    <Download className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                    <span>Download QR Code</span>
                  </button>
                )}
                <button
                  onClick={handleWhatsAppShare}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[hsl(var(--kf-muted)/0.3)] transition-colors text-left min-h-[44px]"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-400" />
                  <span>WhatsApp</span>
                </button>
                <a
                  href={publicUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[hsl(var(--kf-muted)/0.3)] transition-colors min-h-[44px]"
                  onClick={() => setShareOpen(false)}
                >
                  <ExternalLink className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                  <span>Open Store</span>
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
