"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Globe, Link as LinkIcon, Loader2, CheckCircle2, XCircle,
  MessageCircle, ExternalLink, Copy, QrCode, Download,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import QRCode from "qrcode";

type Props = {
  businessId: string;
  slug: string;
  currentSlug: string | null;
  publicUrl: string;
  onSlugChange: (slug: string) => void;
  onSaveSlug: () => Promise<void>;
  slugSaving: boolean;
};

export function StoreSettings({
  businessId,
  slug,
  currentSlug,
  publicUrl,
  onSlugChange,
  onSaveSlug,
  slugSaving,
}: Props) {
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!slug.trim()) {
      setSlugStatus("idle");
      return;
    }
    setSlugStatus("checking");
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    slugCheckTimer.current = setTimeout(async () => {
      const cleaned = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
      if (cleaned === currentSlug) {
        setSlugStatus("available");
        return;
      }
      const res = await apiGet<{ available: boolean }>(`/identity/businesses/slug-check/${encodeURIComponent(cleaned)}`);
      setSlugStatus(res.data?.available ? "available" : "taken");
    }, 500);
    return () => {
      if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    };
  }, [slug, currentSlug]);

  useEffect(() => {
    if (!publicUrl) return;
    QRCode.toDataURL(publicUrl, {
      width: 180,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then(setQrDataUrl).catch(() => setQrDataUrl(""));
  }, [publicUrl]);

  const handleCopy = useCallback(() => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [publicUrl]);

  const handleWhatsAppShare = useCallback(() => {
    if (!publicUrl) return;
    const text = encodeURIComponent(`Check out my online store! Book services and shop here: ${publicUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }, [publicUrl]);

  const downloadQr = useCallback(() => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = "store-qr-code.png";
    a.click();
  }, [qrDataUrl]);

  const domain = typeof window !== "undefined" ? window.location.origin : "";
  const livePreviewUrl = slug.trim()
    ? `${domain}/book/${slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")}`
    : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div
          className="flex-1 flex items-center overflow-hidden rounded-xl"
          style={{
            background: "hsl(var(--kf-muted) / 0.15)",
            border: slugStatus === "available"
              ? "1px solid hsl(142 70% 45% / 0.4)"
              : slugStatus === "taken"
              ? "1px solid hsl(0 70% 50% / 0.4)"
              : "1px solid hsl(var(--kf-border))",
            transition: "border-color 0.2s ease",
          }}
        >
          <span
            className="px-3 py-2.5 text-xs whitespace-nowrap"
            style={{ color: "hsl(var(--kf-muted-foreground))", borderRight: "1px solid hsl(var(--kf-border))" }}
          >
            /book/
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => onSlugChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            placeholder="your-business-name"
            className="flex-1 px-3 py-2.5 bg-transparent text-sm focus:outline-none"
          />
          {slugStatus === "checking" && (
            <div className="px-2"><Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "hsl(var(--kf-muted-foreground))" }} /></div>
          )}
          {slugStatus === "available" && (
            <div className="px-2 flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> Available
            </div>
          )}
          {slugStatus === "taken" && (
            <div className="px-2 flex items-center gap-1 text-xs text-red-400">
              <XCircle className="w-3.5 h-3.5" /> Taken
            </div>
          )}
        </div>
        <button
          onClick={onSaveSlug}
          disabled={slugSaving || !slug.trim() || slugStatus === "taken"}
          className="kf-btn-primary text-xs min-h-[44px]"
          style={{ opacity: slugSaving || !slug.trim() || slugStatus === "taken" ? 0.5 : 1 }}
        >
          {slugSaving ? "Saving..." : "Save"}
        </button>
      </div>

      {livePreviewUrl && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: "hsl(var(--kf-muted) / 0.1)", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
        >
          <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
          <span className="text-xs truncate flex-1 font-mono" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{livePreviewUrl}</span>
          <button onClick={handleCopy} className="p-1 rounded-md transition-colors" title="Copy">
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />}
          </button>
          <a href={livePreviewUrl} target="_blank" rel="noopener noreferrer" className="p-1 rounded-md transition-colors" title="Open">
            <ExternalLink className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
          </a>
        </div>
      )}

      {publicUrl && (
        <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[36px]"
              style={{ background: "hsl(var(--kf-muted) / 0.15)", border: "1px solid hsl(var(--kf-border) / 0.3)", color: "hsl(var(--kf-foreground))" }}
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button
              onClick={handleWhatsAppShare}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[36px]"
              style={{ background: "hsl(var(--kf-muted) / 0.15)", border: "1px solid hsl(var(--kf-border) / 0.3)", color: "hsl(var(--kf-foreground))" }}
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
              WhatsApp
            </button>
            {qrDataUrl && (
              <button
                onClick={downloadQr}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[36px]"
                style={{ background: "hsl(var(--kf-muted) / 0.15)", border: "1px solid hsl(var(--kf-border) / 0.3)", color: "hsl(var(--kf-foreground))" }}
              >
                <Download className="w-3.5 h-3.5" />
                Download QR
              </button>
            )}
          </div>
          {qrDataUrl && (
            <div className="flex flex-col items-center gap-1">
              <div className="rounded-lg p-1.5 bg-white" style={{ boxShadow: "0 2px 8px hsl(0 0% 0% / 0.15)" }}>
                <img src={qrDataUrl} alt="Store QR Code" className="w-[72px] h-[72px]" />
              </div>
              <span className="text-[9px]" style={{ color: "hsl(var(--kf-muted-foreground) / 0.4)" }}>Scan to visit</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
