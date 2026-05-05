"use client";

import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";

export type RecordDetailEntity = "quote" | "invoice" | "payment" | "recurring";

export interface RecordDetailTimelineItem {
  id: string;
  icon?: React.ElementType;
  label: string;
  detail?: string;
  timestamp?: string;
  tone?: "default" | "success" | "warning" | "error";
}

export interface RecordDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  entity: RecordDetailEntity;
  title: string;
  subtitle?: string;
  status?: { label: string; tone?: "default" | "success" | "warning" | "error" | "info" };
  meta?: { label: string; value: ReactNode }[];
  timeline?: RecordDetailTimelineItem[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  children?: ReactNode;
  actions?: ReactNode;
  width?: "sm" | "md" | "lg";
}

const WIDTH_MAP: Record<"sm" | "md" | "lg", string> = {
  sm: "360px",
  md: "480px",
  lg: "640px",
};

const TONE_BG: Record<string, string> = {
  default: "hsl(var(--kf-muted) / 0.15)",
  success: "hsl(var(--kf-success) / 0.12)",
  warning: "hsl(var(--kf-warning) / 0.12)",
  error: "hsl(var(--kf-error) / 0.12)",
  info: "hsl(var(--kf-accent2) / 0.12)",
};
const TONE_FG: Record<string, string> = {
  default: "hsl(var(--kf-muted-foreground))",
  success: "hsl(var(--kf-success))",
  warning: "hsl(var(--kf-warning))",
  error: "hsl(var(--kf-error))",
  info: "hsl(var(--kf-accent2))",
};

export function RecordDetailDrawer({
  open,
  onClose,
  entity,
  title,
  subtitle,
  status,
  meta,
  timeline,
  loading,
  error,
  emptyMessage,
  children,
  actions,
  width = "md",
}: RecordDetailDrawerProps) {
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `record-detail-${entity}`;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  const renderBody = () => {
    if (loading) {
      return (
        <div className="space-y-3" role="status" aria-label="Loading record">
          <div className="h-3 w-1/3 rounded-md bg-muted/30 animate-pulse" />
          <div className="h-24 w-full rounded-xl bg-muted/20 animate-pulse" />
          <div className="h-3 w-1/2 rounded-md bg-muted/30 animate-pulse" />
          <div className="h-32 w-full rounded-xl bg-muted/20 animate-pulse" />
        </div>
      );
    }
    if (error) {
      return (
        <div
          className="rounded-xl border px-4 py-4 text-sm"
          style={{
            borderColor: "hsl(var(--kf-error) / 0.3)",
            background: "hsl(var(--kf-error) / 0.06)",
            color: "hsl(var(--kf-error))",
          }}
          role="alert"
        >
          {error}
        </div>
      );
    }
    if (!children && (!timeline || timeline.length === 0) && !meta && !emptyMessage) {
      return null;
    }
    return (
      <div className="space-y-5">
        {meta && meta.length > 0 && (
          <dl className="grid grid-cols-2 gap-3">
            {meta.map((m) => (
              <div key={m.label} className="rounded-xl border border-border/40 bg-card/40 p-3">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{m.label}</dt>
                <dd className="text-sm font-semibold mt-1">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {children}

        {timeline && timeline.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
              Activity
            </h3>
            <ol className="space-y-2">
              {timeline.map((item) => {
                const Icon = item.icon;
                const tone = item.tone ?? "default";
                return (
                  <li
                    key={item.id}
                    className="flex items-start gap-3 rounded-lg border border-border/30 bg-card/40 p-3"
                  >
                    {Icon && (
                      <span
                        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                        style={{ background: TONE_BG[tone], color: TONE_FG[tone] }}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.label}</p>
                      {item.detail && <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>}
                      {item.timestamp && (
                        <p className="text-[10px] text-muted-foreground/70 mt-1">{item.timestamp}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {!children && (!timeline || timeline.length === 0) && emptyMessage && (
          <p className="text-sm text-muted-foreground/70 text-center py-8">{emptyMessage}</p>
        )}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className={isMobile ? "fixed inset-0 z-50 flex items-end" : "fixed inset-0 z-50 flex justify-end"}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
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
            initial={isMobile ? { y: "100%" } : { x: "100%" }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: "100%" } : { x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            ref={panelRef}
            tabIndex={-1}
            className={`relative flex flex-col outline-none ${
              isMobile ? "w-full rounded-t-2xl border-t" : "h-full border-l"
            }`}
            style={{
              ...(isMobile
                ? { maxHeight: "92vh" }
                : { width: WIDTH_MAP[width], maxWidth: "100vw" }),
              background: "hsl(var(--kf-card))",
              borderColor: "hsl(var(--kf-border))",
            }}
          >
            <header
              className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0"
              style={{ borderColor: "hsl(var(--kf-border))" }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 id={titleId} className="text-base font-semibold truncate">
                    {title}
                  </h2>
                  {status && (
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md"
                      style={{
                        background: TONE_BG[status.tone ?? "default"],
                        color: TONE_FG[status.tone ?? "default"],
                      }}
                    >
                      {status.label}
                    </span>
                  )}
                </div>
                {subtitle && (
                  <p
                    className="text-xs mt-0.5 truncate"
                    style={{ color: "hsl(var(--kf-muted-foreground))" }}
                  >
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 hover:bg-muted/30 transition-colors"
                style={{ color: "hsl(var(--kf-muted-foreground))" }}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">{renderBody()}</div>

            {actions && (
              <footer
                className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                {actions}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
