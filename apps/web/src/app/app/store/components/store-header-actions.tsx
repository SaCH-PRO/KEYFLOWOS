"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  ExternalLink,
  CheckCircle2,
  Share2,
  MessageCircle,
  ChevronDown,
  Download,
  Power,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import Image from "next/image";
import { Surface } from "@/components/ui-v2/surface";
import { Button } from "@/components/ui-v2/button";

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
      <Button
        variant={storeEnabled ? "soft" : "primary"}
        onClick={onToggleEnabled}
        leftIcon={<Power className="w-4 h-4" />}
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
              className="absolute right-0 top-full mt-2 w-80 z-50"
            >
              <Surface variant="glass" className="overflow-hidden py-1">
                <div className="px-4 pt-3 pb-2">
                  <p className="text-caption font-bold uppercase tracking-wider mb-1.5 text-muted-foreground/50">
                    Store Link
                  </p>
                  <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-mono truncate bg-muted/20 border border-border/40 text-foreground">
                    <span className="truncate flex-1">{publicUrl}</span>
                  </div>
                </div>

                {qrDataUrl && (
                  <div className="flex flex-col items-center px-4 py-3 gap-2">
                    <div className="rounded-xl p-3 bg-white shadow-md">
                      <Image src={qrDataUrl} alt="Store QR Code" className="w-[160px] h-[160px]" width={160} height={160} unoptimized />
                    </div>
                    <p className="text-caption text-center text-muted-foreground/50">
                      Scan to visit your store
                    </p>
                  </div>
                )}

                <div className="border-t border-border/40">
                  <button
                    onClick={copyPublicLink}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors text-left min-h-[44px]"
                  >
                    <Copy className="w-4 h-4 text-muted-foreground" />
                    <span>Copy Link</span>
                  </button>
                  {qrDataUrl && (
                    <button
                      onClick={downloadQr}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors text-left min-h-[44px]"
                    >
                      <Download className="w-4 h-4 text-muted-foreground" />
                      <span>Download QR Code</span>
                    </button>
                  )}
                  <button
                    onClick={handleWhatsAppShare}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors text-left min-h-[44px]"
                  >
                    <MessageCircle className="w-4 h-4 text-mint" />
                    <span>WhatsApp</span>
                  </button>
                  <a
                    href={publicUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors min-h-[44px]"
                    onClick={() => setShareOpen(false)}
                  >
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                    <span>Open Store</span>
                  </a>
                </div>
              </Surface>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
