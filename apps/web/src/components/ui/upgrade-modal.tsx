"use client";

import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Crown, Zap, ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

const PLAN_INFO: Record<string, { name: string; priceTTD: number; priceUSD: number; icon: typeof Zap; color: string; features: string[] }> = {
  FREE: {
    name: "Free",
    priceTTD: 0,
    priceUSD: 0,
    icon: Zap,
    color: "--kf-info",
    features: [],
  },
  FLOW: {
    name: "Flow",
    priceTTD: 99,
    priceUSD: 15,
    icon: Sparkles,
    color: "--kf-accent1",
    features: [
      "Unlimited invoices & quotes",
      "Advanced automations",
      "Priority support",
      "Custom branding",
    ],
  },
  KEYFLOW: {
    name: "KeyFlow",
    priceTTD: 249,
    priceUSD: 39,
    icon: Crown,
    color: "--kf-accent2",
    features: [
      "Everything in Flow",
      "Unlimited team members",
      "Advanced analytics",
      "White-label options",
      "API access",
    ],
  },
};

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  feature: string;
  description?: string;
  requiredPlan?: string;
  currentUsage?: number;
  limit?: number;
}

export function UpgradeModal({
  open,
  onClose,
  feature,
  description,
  requiredPlan = "FLOW",
  currentUsage,
  limit,
}: UpgradeModalProps) {
  const plan = PLAN_INFO[requiredPlan] || PLAN_INFO.FLOW;
  const PlanIcon = plan.icon;

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
          aria-labelledby="upgrade-modal-title"
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
            className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="h-1 w-full"
              style={{ background: `linear-gradient(90deg, hsl(var(${plan.color})), hsl(var(${plan.color}) / 0.4))` }}
            />

            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="px-5 pt-5 pb-4 text-center">
              <div
                className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                style={{ background: `hsl(var(${plan.color}) / 0.1)` }}
              >
                <PlanIcon className="w-7 h-7" style={{ color: `hsl(var(${plan.color}))` }} />
              </div>
              <h2 id="upgrade-modal-title" className="text-base font-semibold mb-1">{feature}</h2>
              <p className="text-xs text-muted-foreground">
                {description || `This feature is available on the ${plan.name} plan and above.`}
              </p>

              {currentUsage !== undefined && limit !== undefined && limit > 0 && (
                <div className="mt-3 px-3 py-2 rounded-xl bg-muted/20 text-xs text-muted-foreground">
                  {currentUsage} of {limit} used
                </div>
              )}
            </div>

            {plan.features.length > 0 && (
              <div className="px-5 pb-4">
                <div className="rounded-xl border border-border/40 bg-muted/10 p-3 space-y-1.5">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: `hsl(var(${plan.color}))` }} />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 pb-5 space-y-2">
              <div className="flex items-baseline justify-center gap-1 mb-3">
                <span className="text-2xl font-bold" style={{ color: `hsl(var(${plan.color}))` }}>
                  TT${plan.priceTTD}
                </span>
                <span className="text-xs text-muted-foreground">/month</span>
                <span className="text-[10px] text-muted-foreground">(US${plan.priceUSD})</span>
              </div>

              <Link
                href="/app/settings/business?tab=billing"
                onClick={onClose}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90 min-h-[44px]"
                style={{ background: `hsl(var(${plan.color}))`, color: "hsl(var(--kf-foreground))" }}
              >
                Upgrade to {plan.name}
                <ArrowRight className="w-4 h-4" />
              </Link>

              <button
                onClick={onClose}
                className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[36px]"
              >
                Maybe later
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
