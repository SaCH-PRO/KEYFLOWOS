"use client";

import { ArrowRight } from "lucide-react";
import { PlanLimitBanner } from "@/components/ui/upgrade-prompt";

interface LimitCheck {
  current: number;
  limit: number;
  isUnlimited: boolean;
  nearLimit: boolean;
  atLimit: boolean;
  percent: number;
  upgradeTo: string | null;
}

interface CommerceBannersProps {
  showCrossModuleBanner: boolean;
  returnLabel: string;
  onNavigateBack: () => void;
  crossModuleAction: string;
  crossModuleOrigin: string;
  limitCheck: LimitCheck;
  shellError: string | null;
}

/** Commerce banner queue — renders at most ONE banner at a time.
 *  Priority (highest → lowest): error > plan limit critical > plan limit warning > cross-module > finance info
 */
export function CommerceBanners({
  showCrossModuleBanner,
  returnLabel,
  onNavigateBack,
  crossModuleAction,
  crossModuleOrigin,
  limitCheck,
  shellError,
}: CommerceBannersProps) {
  // P1 — Shell error (always wins)
  if (shellError) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
        <span className="text-amber-400">!</span> {shellError}
      </div>
    );
  }

  // P2 — Plan limit at capacity (critical)
  if (!limitCheck.isUnlimited && limitCheck.atLimit) {
    return (
      <PlanLimitBanner
        resourceKey="invoices"
        label="invoices"
        currentUsage={limitCheck.current}
        limit={limitCheck.limit}
        isUnlimited={limitCheck.isUnlimited}
        nearLimit={limitCheck.nearLimit}
        atLimit={limitCheck.atLimit}
        upgradeTo={limitCheck.upgradeTo}
      />
    );
  }

  // P3 — Plan limit near capacity (warning)
  if (!limitCheck.isUnlimited && limitCheck.nearLimit) {
    return (
      <PlanLimitBanner
        resourceKey="invoices"
        label="invoices"
        currentUsage={limitCheck.current}
        limit={limitCheck.limit}
        isUnlimited={limitCheck.isUnlimited}
        nearLimit={limitCheck.nearLimit}
        atLimit={limitCheck.atLimit}
        upgradeTo={limitCheck.upgradeTo}
      />
    );
  }

  // P4 — Cross-module return banner
  if (showCrossModuleBanner) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
        <button
          onClick={onNavigateBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 group"
          title={returnLabel}
        >
          <ArrowRight className="w-3.5 h-3.5 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
          <span className="max-w-[180px] truncate hidden sm:inline">{returnLabel}</span>
        </button>
        <div className="w-px h-4 bg-border/60 shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">
          {crossModuleAction} for client from {crossModuleOrigin}
        </span>
      </div>
    );
  }

  // P5 — no more banners
  return null;
}
