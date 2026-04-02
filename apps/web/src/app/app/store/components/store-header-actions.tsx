"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  ExternalLink,
  CheckCircle2,
  Share2,
  MessageCircle,
  ChevronDown,
} from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";

function generateQrSvg(data: string, size = 140): string {
  const modules = encodeToQrMatrix(data);
  const n = modules.length;
  const cellSize = size / n;
  let rects = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules[r][c]) {
        rects += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}" fill="hsl(var(--kf-foreground))"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="hsl(var(--kf-card))" rx="4"/>${rects}</svg>`;
}

function encodeToQrMatrix(data: string): boolean[][] {
  const size = 21;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  function addFinderPattern(row: number, col: number) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        if (isOuter || isInner) {
          if (row + r < size && col + c < size) matrix[row + r][col + c] = true;
        }
      }
    }
  }

  addFinderPattern(0, 0);
  addFinderPattern(0, size - 7);
  addFinderPattern(size - 7, 0);

  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }

  for (let r = 8; r < size - 8; r++) {
    for (let c = 8; c < size - 8; c++) {
      const val = ((hash >>> ((r * size + c) % 31)) ^ (r * 7 + c * 13)) & 1;
      matrix[r][c] = val === 1;
    }
  }

  for (let i = 0; i < size; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  return matrix;
}

type Props = {
  storeEnabled: boolean;
  publicUrl: string;
  onToggleEnabled: () => void;
};

export function StoreHeaderActions({ storeEnabled, publicUrl, onToggleEnabled }: Props) {
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

  const qrSvg = useMemo(() => {
    if (!publicUrl) return "";
    return generateQrSvg(publicUrl);
  }, [publicUrl]);

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
          {linkCopied ? "Copied!" : "Share Store"}
          <ChevronDown className={`w-3 h-3 transition-transform ${shareOpen ? "rotate-180" : ""}`} />
        </button>

        <AnimatePresence>
          {shareOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-72 rounded-xl overflow-hidden z-50"
              style={{
                background: "hsl(var(--kf-background) / 0.95)",
                backdropFilter: "blur(20px)",
                border: "1px solid hsl(var(--kf-border))",
                boxShadow: "0 8px 32px hsl(0 0% 0% / 0.4)",
              }}
            >
              <div className="px-4 pt-3 pb-2">
                <p className="text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Store URL</p>
                <div
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-mono truncate"
                  style={{
                    background: "hsl(var(--kf-muted) / 0.3)",
                    border: "1px solid hsl(var(--kf-border) / 0.5)",
                    color: "hsl(var(--kf-foreground))",
                  }}
                >
                  <span className="truncate flex-1">{publicUrl}</span>
                </div>
              </div>

              {qrSvg && (
                <div className="flex justify-center px-4 py-3">
                  <div
                    className="rounded-lg p-2"
                    style={{ background: "hsl(var(--kf-card))" }}
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                </div>
              )}

              <div style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.5)" }}>
                <button
                  onClick={copyPublicLink}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors text-left min-h-[44px]"
                >
                  <Copy className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                  Copy Link
                </button>
                <button
                  onClick={handleWhatsAppShare}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors text-left min-h-[44px]"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-400" />
                  WhatsApp
                </button>
                <a
                  href={publicUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors min-h-[44px]"
                  onClick={() => setShareOpen(false)}
                >
                  <ExternalLink className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                  Open Store
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
