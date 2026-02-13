"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Globe,
  Link as LinkIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  MessageCircle,
  QrCode,
  ExternalLink,
} from "lucide-react";
import { apiGet } from "@/lib/api";

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

  function handleWhatsAppShare() {
    if (!publicUrl) return;
    const text = encodeURIComponent(`Check out my online store! Book services and shop here: ${publicUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }

  const domain = typeof window !== "undefined" ? window.location.origin : "";
  const livePreviewUrl = slug.trim()
    ? `${domain}/book/${slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")}`
    : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        boxShadow: "0 4px 24px hsl(var(--kf-accent1) / 0.05)",
      }}
    >
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{
          borderBottom: "1px solid hsl(var(--kf-accent1) / 0.1)",
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), transparent)",
        }}
      >
        <div
          className="h-10 w-10 rounded-xl flex items-center justify-center"
          style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
        >
          <Globe className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Public Booking Link</h3>
          <p className="text-xs text-muted-foreground">Share this so customers can browse and book</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {livePreviewUrl && (
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{
              background: "hsl(var(--kf-muted) / 0.3)",
              border: "1px solid hsl(var(--kf-border) / 0.5)",
            }}
          >
            <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground truncate flex-1 font-mono">{livePreviewUrl}</span>
            <a
              href={livePreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        <div className="flex items-center gap-2">
          <div
            className="flex-1 flex items-center overflow-hidden rounded-xl"
            style={{
              background: "hsl(var(--kf-muted) / 0.2)",
              border: slugStatus === "available"
                ? "1px solid hsl(142 70% 45% / 0.4)"
                : slugStatus === "taken"
                ? "1px solid hsl(0 70% 50% / 0.4)"
                : "1px solid hsl(var(--kf-border))",
              transition: "border-color 0.2s ease",
            }}
          >
            <span
              className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap"
              style={{ borderRight: "1px solid hsl(var(--kf-border))" }}
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
              <div className="px-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              </div>
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
            className="kf-btn-primary text-xs"
            style={{ opacity: slugSaving || !slug.trim() || slugStatus === "taken" ? 0.5 : 1 }}
          >
            {slugSaving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleWhatsAppShare}
            disabled={!publicUrl}
            className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
            style={{ opacity: !publicUrl ? 0.4 : 1 }}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Share on WhatsApp
          </button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <QrCode className="w-3.5 h-3.5" />
            Share your booking link easily
          </div>
        </div>
      </div>
    </motion.div>
  );
}
