"use client";

import { useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface InspectorSection {
  id: string;
  title: string;
  icon?: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

interface InspectorPanelProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ElementType;
  };
  headerExtra?: React.ReactNode;
  sections: InspectorSection[];
  footer?: React.ReactNode;
  className?: string;
}

export function InspectorPanel({
  title,
  subtitle,
  onClose,
  primaryAction,
  headerExtra,
  sections,
  footer,
  className = "",
}: InspectorPanelProps) {
  return (
    <div
      className={`flex flex-col h-full border-l ${className}`}
      style={{
        background: "hsl(var(--kf-card))",
        borderColor: "hsl(var(--kf-border))",
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
        style={{ borderColor: "hsl(var(--kf-border))" }}
      >
        <div className="min-w-0 flex-1">
          <h2 className="kf-text-emphasis font-semibold truncate">{title}</h2>
          {subtitle && (
            <p
              className="kf-text-micro mt-0.5 truncate"
              style={{ color: "hsl(var(--kf-muted-foreground))" }}
            >
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {headerExtra}
          {primaryAction && (
            <button
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-1 px-2.5 py-1 kf-radius-sm kf-text-micro font-medium"
              style={{
                background: "hsl(var(--kf-accent1))",
                color: "hsl(var(--kf-primary-foreground))",
              }}
            >
              {primaryAction.icon && <primaryAction.icon className="w-3 h-3" />}
              {primaryAction.label}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-6 h-6 kf-radius-sm flex items-center justify-center transition-colors"
            style={{ color: "hsl(var(--kf-muted-foreground))" }}
            aria-label="Close panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sections.map((section) => (
          <CollapsibleSection key={section.id} section={section} />
        ))}
      </div>

      {footer && (
        <div
          className="flex items-center justify-end gap-2 px-4 py-3 flex-shrink-0 border-t"
          style={{ borderColor: "hsl(var(--kf-border))" }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({ section }: { section: InspectorSection }) {
  const [open, setOpen] = useState(section.defaultOpen ?? true);
  const SectionIcon = section.icon;

  return (
    <div
      className="border-b last:border-b-0"
      style={{ borderColor: "hsl(var(--kf-border))" }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors"
        aria-expanded={open}
      >
        {SectionIcon && (
          <SectionIcon
            className="w-3.5 h-3.5 flex-shrink-0"
            style={{ color: "hsl(var(--kf-muted-foreground))" }}
          />
        )}
        <span className="kf-text-caption font-semibold flex-1">{section.title}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? "rotate-0" : "-rotate-90"}`}
          style={{ color: "hsl(var(--kf-muted-foreground))" }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">{section.children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type { InspectorSection };
