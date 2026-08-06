"use client";

import { useState } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import { toast } from "sonner";
import {
  ShoppingCart,
  Star,
  ArrowUpCircle,
  Gift,
  Users,
  CreditCard,
  Magnet,
  ToggleLeft,
  ToggleRight,
  Loader2,
} from "lucide-react";

interface FeatureToggle {
  key: string;
  label: string;
  description: string;
  icon: typeof ShoppingCart;
  enabled: boolean;
  loading: boolean;
}

export default function ConversionSettingsPage() {
  const _businessId = getStoredBusinessId() ?? "";
  const [saving, setSaving] = useState<string | null>(null);
  // `enabled` is presentation only while this screen is unwired. It was
  // hardcoded true for abandoned_cart and review_solicitation, which rendered
  // an "Active" badge asserting a state nothing had read. All false until
  // something actually reports it — an unknown shown as off is a smaller lie
  // than an unknown shown as on.
  const [features, setFeatures] = useState<FeatureToggle[]>([
    {
      key: "abandoned_cart",
      label: "Abandoned Cart Recovery",
      description: "Automatically email customers who add items to cart but don't checkout (24h, 48h, 72h)",
      icon: ShoppingCart,
      enabled: false,
      loading: false,
    },
    {
      key: "review_solicitation",
      label: "Review Solicitation",
      description: "Automatically ask customers for reviews 3 days after a booking or purchase",
      icon: Star,
      enabled: false,
      loading: false,
    },
    {
      key: "upsell_engine",
      label: "Upsell Engine",
      description: "Show related products as order bumps during checkout",
      icon: ArrowUpCircle,
      enabled: false,
      loading: false,
    },
    {
      key: "referral_rewards",
      label: "Referral Rewards",
      description: "Give $10, Get $10 closed-loop referral reward system",
      icon: Gift,
      enabled: false,
      loading: false,
    },
    {
      key: "sales_team",
      label: "Sales Team",
      description: "Commission tracking, deal attribution, and rep dashboards",
      icon: Users,
      enabled: false,
      loading: false,
    },
    {
      key: "merchant_subscriptions",
      label: "Subscription Products",
      description: "Sell recurring services with weekly, monthly, or yearly billing",
      icon: CreditCard,
      enabled: false,
      loading: false,
    },
    {
      key: "lead_magnets",
      label: "Lead Magnets",
      description: "Gated content funnels that capture leads and auto-enroll in sequences",
      icon: Magnet,
      enabled: false,
      loading: false,
    },
  ]);

  /**
   * There is no endpoint behind these switches.
   *
   * This previously flipped local state and called
   * `toast.success("Abandoned Cart Recovery enabled")`. Nothing was written
   * anywhere — the code said so itself ("In production this would call a real
   * settings endpoint") — so a user turned on seven revenue features, was told
   * each one had worked, and found them all off on the next page load.
   *
   * The services exist (conversion/abandoned-cart-recovery.service.ts,
   * site/storefront-conversion.service.ts). What is missing is a settings
   * endpoint keyed on these flags, which is a real piece of work rather than a
   * wiring fix.
   *
   * Until then the honest thing is to say so, not to simulate success. This
   * screen was unreachable behind a broken prefix redirect until 2026-08-06;
   * restoring it must not also restore the lie.
   */
  const toggleFeature = async (_key: string) => {
    toast.error("Not connected yet — these switches do not save. Nothing has changed.");
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Conversion Settings</h1>
        <p className="text-sm text-muted-foreground">
          Turn interest into money. Configure your sales machine.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <p className="text-sm text-amber-700 dark:text-amber-400">
          <strong>Not connected yet.</strong> These controls are not wired to a
          settings endpoint, so changes here are not saved. The underlying
          features are configured elsewhere for now.
        </p>
      </div>

      <div className="space-y-3">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.key}
              className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                feature.enabled
                  ? "border-[hsl(var(--kf-accent1))/0.3] bg-[hsl(var(--kf-accent1))/0.03]"
                  : "border-border/40 bg-background/50"
              }`}
            >
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                  feature.enabled
                    ? "bg-[hsl(var(--kf-accent1))/0.1]"
                    : "bg-muted"
                }`}
              >
                <Icon
                  className={`w-5 h-5 ${
                    feature.enabled ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{feature.label}</h3>
                  {feature.enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{feature.description}</p>
              </div>
              <button
                onClick={() => toggleFeature(feature.key)}
                disabled
                className="shrink-0"
              >
                {saving === feature.key ? (
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                ) : feature.enabled ? (
                  <ToggleRight className="w-8 h-8 text-[hsl(var(--kf-accent1))]" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-muted-foreground" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
