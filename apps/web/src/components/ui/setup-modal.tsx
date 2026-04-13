"use client";

import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink } from "lucide-react";
import Link from "next/link";

interface SetupModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  settingsHref?: string;
  settingsLabel?: string;
  icon?: React.ReactNode;
}

export function SetupModal({
  open,
  onClose,
  title,
  description,
  children,
  settingsHref,
  settingsLabel = "Full Settings",
  icon,
}: SetupModalProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-modal-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
            className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
          >
            <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                {icon && (
                  <div className="w-9 h-9 rounded-xl bg-muted/30 flex items-center justify-center flex-shrink-0">
                    {icon}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 id="setup-modal-title" className="text-sm font-semibold truncate">{title}</h2>
                  {description && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0 ml-2"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              {children}
            </div>

            {settingsHref && (
              <div className="px-5 pb-4 pt-0 flex justify-end">
                <Link
                  href={settingsHref}
                  onClick={onClose}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  {settingsLabel}
                </Link>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
