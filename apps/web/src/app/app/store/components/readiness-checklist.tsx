"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
  PartyPopper,
  ExternalLink,
  Copy,
  Link2,
  ShoppingBag,
  Palette,
  Clock,
  Power,
  Share2,
} from "lucide-react";

interface ReadinessChecklistProps {
  hasLogo: boolean;
  hasHeroImage: boolean;
  hoursConfigured: boolean;
  hasTestimonials: boolean;
  hasSlug: boolean;
  servicesCount: number;
  productsCount: number;
  storeEnabled?: boolean;
  onTabChange: (tab: string) => void;
  slug?: string;
}

const WIZARD_STEPS = [
  {
    key: "url",
    icon: Link2,
    title: "Set Your Store URL",
    description: "Choose a memorable, shareable URL slug for your storefront",
    action: "Set URL",
    tab: "launch",
  },
  {
    key: "catalog",
    icon: ShoppingBag,
    title: "Add Products or Services",
    description: "List at least one product or service for customers to browse",
    action: "Add Items",
    tab: "catalog",
  },
  {
    key: "design",
    icon: Palette,
    title: "Customize Your Theme",
    description: "Pick your colors, fonts, and storefront theme to match your brand",
    action: "Customize",
    tab: "design",
  },
  {
    key: "hours",
    icon: Clock,
    title: "Set Business Hours",
    description: "Let customers know when you're available for bookings or orders",
    action: "Set Hours",
    tab: "operations",
  },
  {
    key: "golive",
    icon: Power,
    title: "Go Live",
    description: "Enable your store and start accepting orders from customers",
    action: "Enable Store",
    tab: "operations",
  },
];

export function ReadinessChecklist({
  hasLogo,
  hasHeroImage,
  hoursConfigured,
  hasTestimonials,
  hasSlug,
  servicesCount,
  productsCount,
  storeEnabled,
  onTabChange,
  slug,
}: ReadinessChecklistProps) {
  const stepStatus: Record<string, boolean> = {
    url: hasSlug,
    catalog: servicesCount > 0 || productsCount > 0,
    design: hasLogo || hasHeroImage,
    hours: hoursConfigured,
    golive: !!storeEnabled,
  };

  const completedCount = Object.values(stepStatus).filter(Boolean).length;
  const total = WIZARD_STEPS.length;
  const allComplete = completedCount === total;
  const [open, setOpen] = useState(completedCount < total);
  const [copied, setCopied] = useState(false);

  const pct = Math.round((completedCount / total) * 100);
  const storeUrl = slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/book/${slug}` : "";

  const color =
    pct >= 80
      ? "hsl(var(--kf-success))"
      : pct >= 50
      ? "hsl(var(--kf-accent1))"
      : "hsl(var(--kf-warning))";

  const firstIncompleteIdx = WIZARD_STEPS.findIndex((s) => !stepStatus[s.key]);

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
            <span className="text-sm font-semibold">
              {allComplete ? "Store Ready!" : "Setup Wizard"}
            </span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: `${color}15`, color }}
            >
              {completedCount}/{total}
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
              className="px-4 pb-4 space-y-1"
              style={{ borderTop: "1px solid hsl(var(--kf-border)/0.25)" }}
            >
              {WIZARD_STEPS.map((step, i) => {
                const done = stepStatus[step.key];
                const isCurrent = i === firstIncompleteIdx;
                const Icon = step.icon;

                return (
                  <motion.div
                    key={step.key}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="relative"
                  >
                    <button
                      type="button"
                      onClick={() => onTabChange(step.tab)}
                      className={`w-full flex items-start gap-3 px-3 py-3 rounded-xl text-left transition-all group min-h-[44px] ${
                        isCurrent ? "bg-[hsl(var(--kf-accent1)/0.06)]" : "hover:bg-[hsl(var(--kf-muted)/0.08)]"
                      }`}
                      style={isCurrent ? { border: "1px solid hsl(var(--kf-accent1)/0.15)" } : undefined}
                    >
                      <div className="flex flex-col items-center mt-0.5">
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{
                            background: done
                              ? "hsl(var(--kf-success)/0.12)"
                              : isCurrent
                              ? "hsl(var(--kf-accent1)/0.12)"
                              : "hsl(var(--kf-muted)/0.15)",
                          }}
                        >
                          {done ? (
                            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} />
                          ) : (
                            <Icon
                              className="w-3.5 h-3.5"
                              style={{
                                color: isCurrent ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground)/0.4)",
                              }}
                            />
                          )}
                        </div>
                        {i < WIZARD_STEPS.length - 1 && (
                          <div
                            className="w-px h-3 mt-1"
                            style={{
                              background: done
                                ? "hsl(var(--kf-success)/0.3)"
                                : "hsl(var(--kf-border)/0.3)",
                            }}
                          />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs font-semibold block leading-tight"
                            style={{
                              color: done
                                ? "hsl(var(--kf-muted-foreground))"
                                : isCurrent
                                ? "hsl(var(--kf-foreground))"
                                : "hsl(var(--kf-foreground)/0.7)",
                              textDecoration: done ? "line-through" : "none",
                              textDecorationColor: "hsl(var(--kf-muted-foreground)/0.3)",
                            }}
                          >
                            {step.title}
                          </span>
                          {done && (
                            <span
                              className="text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase"
                              style={{
                                background: "hsl(var(--kf-success)/0.1)",
                                color: "hsl(var(--kf-success))",
                              }}
                            >
                              Done
                            </span>
                          )}
                          {!done && (
                            <span
                              className="text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase"
                              style={{
                                background: isCurrent ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.15)",
                                color: isCurrent ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground)/0.5)",
                              }}
                            >
                              {isCurrent ? "Next" : "Pending"}
                            </span>
                          )}
                        </div>
                        <span
                          className="text-[10px] leading-tight block mt-0.5"
                          style={{ color: "hsl(var(--kf-muted-foreground)/0.5)" }}
                        >
                          {step.description}
                        </span>
                      </div>

                      {!done && (
                        <div className="flex items-center gap-1 flex-shrink-0 mt-1">
                          <span
                            className="text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ color: "hsl(var(--kf-accent1))" }}
                          >
                            {step.action}
                          </span>
                          <ArrowRight
                            className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
                            style={{ color: "hsl(var(--kf-muted-foreground))" }}
                          />
                        </div>
                      )}
                    </button>
                  </motion.div>
                );
              })}

              {allComplete && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="mt-3 pt-3 space-y-3"
                  style={{ borderTop: "1px solid hsl(var(--kf-border)/0.25)" }}
                >
                  <div className="flex items-center gap-2 px-3">
                    <PartyPopper className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
                    <div>
                      <span className="text-sm font-bold" style={{ color: "hsl(var(--kf-success))" }}>
                        Your store is live!
                      </span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Share your store link and start earning
                      </p>
                    </div>
                  </div>
                  {storeUrl && (
                    <div className="flex gap-2 px-3">
                      <a
                        href={`/book/${slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors min-h-[44px]"
                        style={{
                          background: "hsl(var(--kf-accent1)/0.1)",
                          color: "hsl(var(--kf-accent1))",
                        }}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View Live
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(storeUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors min-h-[44px]"
                        style={{
                          background: "hsl(var(--kf-muted)/0.12)",
                          color: "hsl(var(--kf-foreground)/0.7)",
                        }}
                      >
                        {copied ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? "Copied!" : "Share Link"}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
