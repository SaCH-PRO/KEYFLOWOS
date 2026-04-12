"use client";

import { useState, useId, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";

interface AccordionSectionProps {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  accentColor?: string;
}

export function AccordionSection({
  icon: Icon,
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
  accentColor,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const accent = accentColor || "hsl(var(--kf-accent1))";
  const triggerId = useId();
  const panelId = useId();

  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-200"
      style={{
        background: "hsl(var(--kf-card))",
        border: open ? `1px solid color-mix(in srgb, ${accent} 30%, transparent)` : "1px solid hsl(var(--kf-border) / 0.4)",
        boxShadow: open ? `0 4px 16px hsl(var(--kf-background) / 0.3), inset 3px 0 0 ${accent}` : "none",
      }}
    >
      <button
        type="button"
        id={triggerId}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left min-h-[52px] transition-colors hover:bg-[hsl(var(--kf-muted)/0.12)]"
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200"
          style={{
            background: open ? `color-mix(in srgb, ${accent} 20%, transparent)` : "hsl(var(--kf-muted) / 0.15)",
            boxShadow: open ? `0 2px 8px color-mix(in srgb, ${accent} 15%, transparent)` : "none",
          }}
        >
          <Icon
            className="w-4 h-4 transition-colors"
            style={{ color: open ? accent : "hsl(var(--kf-muted-foreground))" }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-semibold transition-colors"
              style={{ color: open ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-foreground) / 0.85)" }}
            >
              {title}
            </span>
            {badge}
          </div>
          {subtitle && (
            <p className="text-[11px] mt-0.5 truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {subtitle}
            </p>
          )}
        </div>
        <ChevronRight
          className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
          style={{
            color: open ? accent : "hsl(var(--kf-muted-foreground))",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              className="px-4 pb-4 pt-1"
              style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.2)" }}
            >
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface AccordionGroupProps {
  title: string;
  children: ReactNode;
  brandColor?: string;
}

export function AccordionGroup({ title, children, brandColor }: AccordionGroupProps) {
  const lineColor = brandColor ? `${brandColor}35` : "hsl(var(--kf-accent1) / 0.2)";
  return (
    <div className="space-y-2">
      <h3
        className="text-[10px] font-bold uppercase tracking-widest px-1 flex items-center gap-2"
        style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}
      >
        <span className="w-5 h-px" style={{ background: lineColor }} />
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
