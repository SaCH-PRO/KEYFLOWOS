"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, Sparkles, Crown, ArrowRight, X, Zap, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { PlanLimitState } from "@/hooks/use-plan";

type PromptVariant = "inline" | "banner" | "card" | "compact";

interface UpgradePromptProps {
  feature: string;
  description?: string;
  requiredPlan?: string;
  variant?: PromptVariant;
  currentUsage?: number;
  limit?: number;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
}

const PLAN_INFO: Record<string, { name: string; priceTTD: number; priceUSD: number; icon: typeof Zap; color: string }> = {
  FREE: { name: "Free", priceTTD: 0, priceUSD: 0, icon: Zap, color: "--kf-info" },
  FLOW: { name: "Flow", priceTTD: 99, priceUSD: 15, icon: Sparkles, color: "--kf-accent1" },
  KEYFLOW: { name: "KeyFlow", priceTTD: 249, priceUSD: 39, icon: Crown, color: "--kf-accent2" },
};

export function UpgradePrompt({
  feature,
  description,
  requiredPlan = "FLOW",
  variant = "inline",
  currentUsage,
  limit,
  dismissible = true,
  onDismiss,
  className = "",
}: UpgradePromptProps) {
  const [dismissed, setDismissed] = useState(false);
  const plan = PLAN_INFO[requiredPlan] || PLAN_INFO.FLOW;
  const PlanIcon = plan.icon;
  const isNearLimit = currentUsage !== undefined && limit !== undefined && limit > 0;
  const usagePercent = isNearLimit ? Math.round((currentUsage / limit) * 100) : 0;
  const atLimit = isNearLimit && currentUsage >= limit;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  if (dismissed) return null;

  if (variant === "compact") {
    return (
      <div
        className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${className}`}
        style={{
          background: `hsl(var(${plan.color}) / 0.06)`,
          border: `1px solid hsl(var(${plan.color}) / 0.15)`,
          color: `hsl(var(${plan.color}))`,
        }}
      >
        <Lock className="w-3 h-3 shrink-0" />
        <span className="truncate">{feature} requires {plan.name}</span>
        <Link
          href="/app/settings/business?tab=billing"
          className="ml-auto font-medium underline-offset-2 hover:underline whitespace-nowrap min-w-[44px] min-h-[44px] flex items-center"
        >
          Upgrade
        </Link>
      </div>
    );
  }

  if (variant === "banner") {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className={`flex items-center gap-3 p-3 rounded-xl ${className}`}
          style={{
            background: atLimit ? "hsl(var(--kf-error) / 0.08)" : "hsl(var(--kf-warning) / 0.08)",
            border: `1px solid ${atLimit ? "hsl(var(--kf-error) / 0.2)" : "hsl(var(--kf-warning) / 0.2)"}`,
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: atLimit ? "hsl(var(--kf-error))" : "hsl(var(--kf-warning))" }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {atLimit
                ? `You've reached your ${feature} limit`
                : `You're approaching your ${feature} limit`}
            </p>
            {isNearLimit && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {currentUsage} of {limit} used ({usagePercent}%) · Upgrade to {plan.name} for more
              </p>
            )}
          </div>
          <Link
            href="/app/settings/business?tab=billing"
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all hover:scale-105 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
            style={{ background: `hsl(var(${plan.color}))`, color: "hsl(var(--kf-foreground))" }}
          >
            Upgrade
          </Link>
          {dismissible && (
            <button onClick={handleDismiss} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </motion.div>
      </AnimatePresence>
    );
  }

  if (variant === "card") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`rounded-xl border p-5 text-center ${className}`}
        style={{
          background: `hsl(var(${plan.color}) / 0.04)`,
          borderColor: `hsl(var(${plan.color}) / 0.15)`,
        }}
      >
        <div
          className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
          style={{ background: `hsl(var(${plan.color}) / 0.1)` }}
        >
          <PlanIcon className="w-6 h-6" style={{ color: `hsl(var(${plan.color}))` }} />
        </div>
        <h3 className="text-sm font-semibold mb-1">{feature}</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {description || `This feature is available on the ${plan.name} plan and above.`}
        </p>
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className="text-lg font-bold" style={{ color: `hsl(var(${plan.color}))` }}>
            TT${plan.priceTTD}
          </span>
          <span className="text-xs text-muted-foreground">/month</span>
          <span className="text-[10px] text-muted-foreground">(US${plan.priceUSD})</span>
        </div>
        <Link
          href="/app/settings/business?tab=billing"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105 min-h-[44px]"
          style={{ background: `hsl(var(${plan.color}))`, color: "hsl(var(--kf-foreground))" }}
        >
          Upgrade to {plan.name}
          <ArrowRight className="w-4 h-4" />
        </Link>
        {dismissible && (
          <button
            onClick={handleDismiss}
            className="block mx-auto mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            Maybe later
          </button>
        )}
      </motion.div>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl ${className}`}
      style={{
        background: `hsl(var(${plan.color}) / 0.04)`,
        border: `1px solid hsl(var(${plan.color}) / 0.15)`,
      }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `hsl(var(${plan.color}) / 0.1)` }}
      >
        <Lock className="w-4 h-4" style={{ color: `hsl(var(${plan.color}))` }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{feature}</p>
        <p className="text-[11px] text-muted-foreground">
          {description || `Available on ${plan.name} · TT$${plan.priceTTD}/mo`}
        </p>
      </div>
      <Link
        href="/app/settings/business?tab=billing"
        className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all hover:scale-105 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
        style={{ background: `hsl(var(${plan.color}))`, color: "hsl(var(--kf-foreground))" }}
      >
        Upgrade
      </Link>
      {dismissible && (
        <button onClick={handleDismiss} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function PlanLimitBanner({
  resourceKey,
  label,
  currentUsage,
  limit,
  isUnlimited,
  nearLimit,
  atLimit,
  upgradeTo,
}: {
  resourceKey: string;
  label: string;
  currentUsage: number;
  limit: number;
  isUnlimited: boolean;
  nearLimit: boolean;
  atLimit: boolean;
  upgradeTo?: string | null;
}) {
  if (isUnlimited || (!nearLimit && !atLimit)) return null;

  return (
    <UpgradePrompt
      feature={label}
      variant="banner"
      requiredPlan={upgradeTo ?? "FLOW"}
      currentUsage={currentUsage}
      limit={limit}
    />
  );
}

export function PlanLimitDialog({
  planLimit,
  onClose,
}: {
  planLimit: PlanLimitState | null;
  onClose: () => void;
}) {
  if (!planLimit) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 w-full max-w-sm mx-4"
        >
          <UpgradePrompt
            feature={planLimit.resource}
            description={planLimit.message}
            variant="card"
            currentUsage={planLimit.current}
            limit={planLimit.limit}
            dismissible={true}
            onDismiss={onClose}
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
