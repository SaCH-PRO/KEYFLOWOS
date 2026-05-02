"use client";

import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GripVertical,
  ChevronUp,
  ChevronDown,
  Save,
  Loader2,
  Layout,
  Image,
  Star,
  Grid3X3,
  ShoppingBag,
  MessageSquareQuote,
  HelpCircle,
  FileText,
  Phone,
} from "lucide-react";
import type { StorefrontConfig, StorefrontSection, StorefrontSectionType } from "@/lib/client";
import { DEFAULT_SECTIONS, SECTION_LABELS } from "./store-types";

type Props = {
  config: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
};

const SECTION_ICONS: Record<StorefrontSectionType, React.ElementType> = {
  hero: Image,
  featured: Star,
  categories: Grid3X3,
  catalog: ShoppingBag,
  testimonials: MessageSquareQuote,
  faq: HelpCircle,
  policies: FileText,
  contact: Phone,
  trust: Star,
};

export function SectionLayoutManager({ config, onConfigChange, onSave, saving }: Props) {
  const sections: StorefrontSection[] = config.sections?.length ? config.sections : DEFAULT_SECTIONS;

  const toggleSection = useCallback(
    (idx: number) => {
      const updated = sections.map((s, i) => (i === idx ? { ...s, enabled: !s.enabled } : s));
      onConfigChange("sections", updated as any);
    },
    [sections, onConfigChange]
  );

  const moveSection = useCallback(
    (idx: number, direction: "up" | "down") => {
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= sections.length) return;
      const updated = [...sections];
      [updated[idx], updated[swap]] = [updated[swap], updated[idx]];
      onConfigChange("sections", updated as any);
    },
    [sections, onConfigChange]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        boxShadow: "0 4px 24px hsl(var(--kf-accent1) / 0.05)",
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: "1px solid hsl(var(--kf-accent1) / 0.1)",
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), transparent)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
          >
            <Layout className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Section Layout</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Toggle and reorder your storefront sections
            </p>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving..." : "Save Layout"}
        </button>
      </div>

      <div className="p-5 space-y-2">
        <AnimatePresence>
          {sections.map((section, idx) => {
            const sType = section.type ?? "hero";
            const meta = SECTION_LABELS[sType];
            const Icon = SECTION_ICONS[sType];
            return (
              <motion.div
                key={section.type}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                style={{
                  background: section.enabled
                    ? "hsl(var(--kf-accent1) / 0.06)"
                    : "hsl(var(--kf-muted) / 0.2)",
                  border: section.enabled
                    ? "1px solid hsl(var(--kf-accent1) / 0.15)"
                    : "1px solid hsl(var(--kf-border) / 0.3)",
                  opacity: section.enabled ? 1 : 0.6,
                }}
              >
                <GripVertical
                  className="w-4 h-4 text-muted-foreground cursor-grab flex-shrink-0"
                  style={{ opacity: 0.4 }}
                />

                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: section.enabled
                      ? "hsl(var(--kf-accent1) / 0.12)"
                      : "hsl(var(--kf-muted) / 0.3)",
                  }}
                >
                  <Icon
                    className="w-4 h-4"
                    style={{
                      color: section.enabled
                        ? "hsl(var(--kf-accent1))"
                        : "hsl(var(--kf-muted-foreground))",
                    }}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{meta.label}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{meta.description}</p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => moveSection(idx, "up")}
                    disabled={idx === 0}
                    className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors disabled:opacity-30"
                  >
                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => moveSection(idx, "down")}
                    disabled={idx === sections.length - 1}
                    className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors disabled:opacity-30"
                  >
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={section.enabled}
                  onClick={() => toggleSection(idx)}
                  className="flex-shrink-0"
                >
                  <div
                    className="w-10 h-5 rounded-full transition-colors relative"
                    style={{
                      background: section.enabled
                        ? "hsl(var(--kf-accent1))"
                        : "hsl(var(--kf-muted-foreground) / 0.3)",
                    }}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        section.enabled ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </div>
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>

        <p className="text-[10px] text-muted-foreground pt-2">
          Reorder sections using the arrows. Toggle sections on/off to show or hide them on your storefront.
        </p>
      </div>
    </motion.div>
  );
}
