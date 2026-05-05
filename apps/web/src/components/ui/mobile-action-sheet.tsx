"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export interface MobileActionSheetItem {
  key: string;
  label: string;
  description?: string;
  icon?: React.ElementType;
  onSelect: () => void;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
}

interface MobileActionSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  items: MobileActionSheetItem[];
}

const TONE_BG: Record<string, string> = {
  default: "hsl(var(--kf-muted) / 0.15)",
  primary: "hsl(var(--kf-accent1) / 0.12)",
  danger: "hsl(var(--kf-error) / 0.12)",
};
const TONE_FG: Record<string, string> = {
  default: "hsl(var(--kf-foreground))",
  primary: "hsl(var(--kf-accent1))",
  danger: "hsl(var(--kf-error))",
};

export function MobileActionSheet({ open, onClose, title, items }: MobileActionSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0"
            style={{ background: "hsl(var(--kf-foreground) / 0.5)" }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            className="relative w-full rounded-t-2xl border-t flex flex-col"
            style={{
              maxHeight: "80vh",
              background: "hsl(var(--kf-card))",
              borderColor: "hsl(var(--kf-border))",
            }}
          >
            <div className="flex justify-center pt-2 pb-1 shrink-0">
              <div
                className="w-10 h-1 rounded-full"
                style={{ background: "hsl(var(--kf-muted-foreground) / 0.3)" }}
              />
            </div>
            <div
              className="flex items-center justify-between px-4 py-3 border-b shrink-0"
              style={{ borderColor: "hsl(var(--kf-border))" }}
            >
              <h2 className="text-sm font-semibold">{title}</h2>
              <button
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-md"
                style={{ color: "hsl(var(--kf-muted-foreground))" }}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ul className="overflow-y-auto py-1.5">
              {items.map((item) => {
                const Icon = item.icon;
                const tone = item.tone ?? "default";
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      disabled={item.disabled}
                      onClick={() => {
                        item.onSelect();
                        onClose();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left disabled:opacity-50 active:bg-muted/30"
                    >
                      {Icon && (
                        <span
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: TONE_BG[tone], color: TONE_FG[tone] }}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                      )}
                      <span className="flex-1 min-w-0">
                        <span
                          className="block text-sm font-medium truncate"
                          style={{ color: TONE_FG[tone] }}
                        >
                          {item.label}
                        </span>
                        {item.description && (
                          <span className="block text-[11px] text-muted-foreground truncate">
                            {item.description}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
