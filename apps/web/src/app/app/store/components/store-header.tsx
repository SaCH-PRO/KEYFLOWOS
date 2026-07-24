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
  Power,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Surface } from "@/components/ui-v2/surface";
import { Button } from "@/components/ui-v2/button";
import { Badge } from "@/components/ui-v2/badge";

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
    >
      <Surface variant="accent" className="relative overflow-hidden p-6">
        <div className="absolute inset-0 opacity-[0.04] bg-[radial-gradient(ellipse_at_30%_0%,hsl(var(--kf-primary)),transparent_60%)]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-primary/20 to-secondary/10 text-primary border border-primary/20 shadow-sm">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-display text-title font-bold tracking-tight text-gradient-key">
                Online Store
              </h1>
              <p className="text-body text-muted-foreground mt-0.5">
                Your public storefront and booking page
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Badge color={storeEnabled ? "mint" : "orange"} variant="status">
              {storeEnabled ? "Live" : "Draft"}
            </Badge>

            <Button
              variant={storeEnabled ? "soft" : "primary"}
              leftIcon={<Power className="w-4 h-4" />}
              onClick={onToggleEnabled}
            >
              {storeEnabled ? "Take Offline" : "Go Live"}
            </Button>

            <div className="relative" ref={shareRef}>
              <Button
                variant="soft"
                onClick={() => setShareOpen(!shareOpen)}
                disabled={!publicUrl || !storeEnabled}
                leftIcon={linkCopied ? <CheckCircle2 className="w-4 h-4 text-mint" /> : <Share2 className="w-4 h-4" />}
                rightIcon={<ChevronDown className={`w-3 h-3 transition-transform ${shareOpen ? "rotate-180" : ""}`} />}
              >
                {linkCopied ? "Copied!" : "Share"}
              </Button>

              <AnimatePresence>
                {shareOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-52 z-50"
                  >
                    <Surface variant="glass" className="overflow-hidden py-1">
                      <button
                        onClick={copyPublicLink}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 transition-colors text-left"
                      >
                        <Copy className="w-4 h-4 text-muted-foreground" />
                        Copy Link
                      </button>
                      <button
                        onClick={handleWhatsAppShare}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 transition-colors text-left"
                      >
                        <MessageCircle className="w-4 h-4 text-mint" />
                        WhatsApp
                      </button>
                      <a
                        href={publicUrl || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
                        onClick={() => setShareOpen(false)}
                      >
                        <ExternalLink className="w-4 h-4 text-muted-foreground" />
                        Open Store
                      </a>
                    </Surface>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </Surface>
    </motion.div>
  );
}
