"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { Banner } from "./store-types";

interface StoreBannerProps {
  banner: Banner | null;
  onDismiss: () => void;
}

export function StoreBanner({ banner, onDismiss }: StoreBannerProps) {
  return (
    <AnimatePresence>
      {banner && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          className={`kf-card p-3 text-sm flex items-center gap-2 ${
            banner.type === "success"
              ? "!border-emerald-500/30 !bg-emerald-500/10 text-emerald-300"
              : banner.type === "error"
              ? "!border-red-500/30 !bg-red-500/10 text-red-300"
              : banner.type === "warning"
              ? "!border-yellow-500/30 !bg-yellow-500/10 text-yellow-300"
              : "text-[hsl(var(--kf-accent1))]"
          }`}
        >
          {banner.type === "success" ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {banner.text}
          <button onClick={onDismiss} className="ml-auto text-xs opacity-60 hover:opacity-100">
            Dismiss
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
