"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Store,
  Copy,
  ExternalLink,
  CheckCircle2,
  Share2,
  MessageCircle,
  ChevronDown,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

type Props = {
  storeEnabled: boolean;
  publicUrl: string;
  onToggleEnabled: () => void;
};

export function StoreHeader({ storeEnabled, publicUrl, onToggleEnabled }: Props) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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

  function copyPublicLink() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setLinkCopied(true);
    setShareOpen(false);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  function handleWhatsAppShare() {
    if (!publicUrl) return;
    const text = encodeURIComponent(`Check out our store: ${publicUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
    setShareOpen(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl p-6"
      style={{
        background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.12), hsl(var(--kf-accent2) / 0.08))",
        border: "1px solid hsl(var(--kf-accent1) / 0.15)",
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{ background: "radial-gradient(ellipse at 30% 0%, hsl(var(--kf-accent1)), transparent 60%)" }}
      />
      <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className="h-12 w-12 rounded-2xl flex items-center justify-center shadow-lg"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.25), hsl(var(--kf-accent2) / 0.15))",
              border: "1px solid hsl(var(--kf-accent1) / 0.3)",
            }}
          >
            <Store className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h1
              className="text-2xl md:text-3xl font-bold tracking-tight bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            >
              Online Store
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">Your public storefront and booking page</p>
          </div>
        </div>

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
              className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm"
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
                  className="absolute right-0 top-full mt-2 w-52 rounded-xl overflow-hidden z-50"
                  style={{
                    background: "hsl(var(--kf-background) / 0.95)",
                    backdropFilter: "blur(20px)",
                    border: "1px solid hsl(var(--kf-border))",
                    boxShadow: "0 8px 32px hsl(0 0% 0% / 0.4)",
                  }}
                >
                  <button
                    onClick={copyPublicLink}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors text-left"
                  >
                    <Copy className="w-4 h-4 text-muted-foreground" />
                    Copy Link
                  </button>
                  <button
                    onClick={handleWhatsAppShare}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors text-left"
                  >
                    <MessageCircle className="w-4 h-4 text-emerald-400" />
                    WhatsApp
                  </button>
                  <a
                    href={publicUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors"
                    onClick={() => setShareOpen(false)}
                  >
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                    Open Store
                  </a>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
