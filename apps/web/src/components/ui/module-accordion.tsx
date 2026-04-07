"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, type LucideIcon } from "lucide-react";

export interface AccordionSection {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: string | number;
  content: ReactNode;
}

interface ModuleAccordionProps {
  sections: AccordionSection[];
  defaultOpen?: string[];
  openKeys?: string[];
  onOpenChange?: (keys: string[]) => void;
  allowMultiple?: boolean;
}

export function ModuleAccordion({ sections, defaultOpen, openKeys: controlledKeys, onOpenChange, allowMultiple = true }: ModuleAccordionProps) {
  const [internalKeys, setInternalKeys] = useState<Set<string>>(new Set(defaultOpen ?? (sections[0] ? [sections[0].key] : [])));

  const isControlled = controlledKeys !== undefined;
  const currentKeys = isControlled ? new Set(controlledKeys) : internalKeys;

  useEffect(() => {
    if (isControlled) {
      setInternalKeys(new Set(controlledKeys));
    }
  }, [isControlled, controlledKeys]);

  const toggle = useCallback((key: string) => {
    const next = new Set(currentKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      if (!allowMultiple) next.clear();
      next.add(key);
    }
    if (isControlled && onOpenChange) {
      onOpenChange(Array.from(next));
    } else {
      setInternalKeys(next);
    }
  }, [currentKeys, allowMultiple, isControlled, onOpenChange]);

  return (
    <div className="space-y-1.5">
      {sections.map((section) => {
        const isOpen = currentKeys.has(section.key);
        const Icon = section.icon;
        return (
          <div key={section.key} className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <button
              onClick={() => toggle(section.key)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
              aria-expanded={isOpen}
            >
              <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
                <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
              </motion.div>
              <Icon className="w-4 h-4 text-muted-foreground/80" />
              <span className="text-sm font-medium flex-1">{section.label}</span>
              {section.badge != null && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-white/[0.06] text-muted-foreground">
                  {section.badge}
                </span>
              )}
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-1">
                    {section.content}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
