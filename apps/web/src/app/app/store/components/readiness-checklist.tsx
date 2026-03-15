"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
} from "lucide-react";

interface ReadinessChecklistProps {
  hasLogo: boolean;
  hasHeroImage: boolean;
  hoursConfigured: boolean;
  hasTestimonials: boolean;
  hasSlug: boolean;
  servicesCount: number;
  productsCount: number;
  onTabChange: (tab: string) => void;
}

export function ReadinessChecklist({
  hasLogo,
  hasHeroImage,
  hoursConfigured,
  hasTestimonials,
  hasSlug,
  servicesCount,
  productsCount,
  onTabChange,
}: ReadinessChecklistProps) {
  const [open, setOpen] = useState(false);

  const checks = [
    { label: "Custom URL", hint: "Set a memorable slug for your store", done: hasSlug, tab: "storefront" },
    { label: "Logo uploaded", hint: "Add your brand logo in Storefront", done: hasLogo, tab: "storefront" },
    { label: "Cover image", hint: "Upload a hero image for your storefront", done: hasHeroImage, tab: "storefront" },
    { label: "Business hours", hint: "Set your operating hours", done: hoursConfigured, tab: "products" },
    { label: "Products listed", hint: "Add services or products to your catalog", done: servicesCount > 0 || productsCount > 0, tab: "products" },
    { label: "Testimonials", hint: "Add social proof from your clients", done: hasTestimonials, tab: "storefront" },
  ];

  const completed = checks.filter((c) => c.done).length;
  const total = checks.length;
  const pct = Math.round((completed / total) * 100);

  const color =
    pct >= 80
      ? "hsl(var(--kf-success))"
      : pct >= 50
      ? "hsl(var(--kf-accent1))"
      : "hsl(var(--kf-warning))";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border)/0.5)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full text-left px-4 py-3.5 flex items-center gap-3 transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)]"
      >
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}12` }}
        >
          <Sparkles className="w-4 h-4" style={{ color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold">Storefront Readiness</span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: `${color}15`, color }}
            >
              {completed}/{total}
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.25)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: color }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>

        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0"
        >
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-3 space-y-0.5"
              style={{ borderTop: "1px solid hsl(var(--kf-border)/0.25)" }}
            >
              {checks.map((check, i) => (
                <motion.button
                  key={check.label}
                  type="button"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => onTabChange(check.tab)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-[hsl(var(--kf-muted)/0.12)] group"
                >
                  {check.done ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
                  ) : (
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ border: "1.5px solid hsl(var(--kf-muted-foreground)/0.25)" }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-xs font-medium block leading-tight"
                      style={{
                        color: check.done ? "hsl(var(--kf-muted-foreground))" : "hsl(var(--kf-foreground))",
                        textDecoration: check.done ? "line-through" : "none",
                        textDecorationColor: "hsl(var(--kf-muted-foreground)/0.3)",
                      }}
                    >
                      {check.label}
                    </span>
                    {!check.done && (
                      <span className="text-[10px] leading-tight block mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground)/0.5)" }}>
                        {check.hint}
                      </span>
                    )}
                  </div>
                  {!check.done && (
                    <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                  )}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
