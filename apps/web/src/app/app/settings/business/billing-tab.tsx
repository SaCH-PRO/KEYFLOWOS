"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  Crown,
  Zap,
  Check,
  Sparkles,
  ArrowUpRight,
  Clock,
  AlertTriangle,
  CreditCard,
} from "lucide-react";

interface SubscriptionInfo {
  plan: string;
  status: string;
  limits: Record<string, unknown>;
  subscription: {
    id: string;
    plan: string;
    status: string;
    currency: string;
    priceMonthly: number;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    gateway: string | null;
    createdAt: string;
  } | null;
  trialExpired?: boolean;
}

const planDetails: Record<string, { icon: typeof Zap; color: string; gradient: string }> = {
  FREE: { icon: Zap, color: "text-gray-400", gradient: "from-gray-500/20 to-gray-600/20" },
  FLOW: { icon: Sparkles, color: "text-orange-400", gradient: "from-orange-500/20 to-teal-500/20" },
  KEYFLOW: { icon: Crown, color: "text-amber-400", gradient: "from-amber-500/20 to-orange-500/20" },
};

const planFeatures: Record<string, string[]> = {
  FREE: ["50 contacts", "5 invoices/month", "10 bookings/month", "1 staff", "Basic CRM"],
  FLOW: [
    "500 contacts", "Unlimited invoices", "100 bookings/month", "5 staff",
    "Quotes & proposals", "5 automations", "Online store", "Custom branding",
  ],
  KEYFLOW: [
    "Unlimited everything", "AI Autopilot", "Unlimited automations",
    "Priority support", "Advanced analytics",
  ],
};

const planPricing: Record<string, { ttd: number; usd: number }> = {
  FREE: { ttd: 0, usd: 0 },
  FLOW: { ttd: 99, usd: 15 },
  KEYFLOW: { ttd: 249, usd: 39 },
};

export function BillingTab() {
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<"TTD" | "USD">("TTD");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const businessId = getStoredBusinessId();

  const loadSubscription = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await apiGet<SubscriptionInfo>(`/subscriptions/businesses/${businessId}/current`);
    if (res.data) setSub(res.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  const handleStartTrial = async (plan: string) => {
    if (!businessId) return;
    setUpgrading(true);
    setMessage(null);
    const res = await apiPost<unknown>({
      path: `/subscriptions/businesses/${businessId}/trial`,
      body: { plan, currency: selectedCurrency },
    });
    if (res.error) {
      setMessage({ type: "error", text: res.error });
    } else {
      setMessage({ type: "success", text: `${plan} trial started! You have 1 day to explore.` });
      await loadSubscription();
    }
    setUpgrading(false);
    setSelectedPlan(null);
  };

  const handleActivate = async (plan: string) => {
    if (!businessId) return;
    setUpgrading(true);
    setMessage(null);
    const res = await apiPost<unknown>({
      path: `/subscriptions/businesses/${businessId}/activate`,
      body: { plan, currency: selectedCurrency, gateway: "manual" },
    });
    if (res.error) {
      setMessage({ type: "error", text: res.error });
    } else {
      setMessage({ type: "success", text: `${plan} plan activated!` });
      await loadSubscription();
    }
    setUpgrading(false);
    setSelectedPlan(null);
  };

  const handleCancel = async () => {
    if (!businessId || !confirm("Are you sure you want to cancel your subscription? You will revert to the Free plan.")) return;
    setCancelling(true);
    setMessage(null);
    const res = await apiPost<{ message: string }>({
      path: `/subscriptions/businesses/${businessId}/cancel`,
      body: {},
    });
    if (res.error) {
      setMessage({ type: "error", text: res.error });
    } else {
      setMessage({ type: "success", text: res.data?.message || "Subscription cancelled." });
      await loadSubscription();
    }
    setCancelling(false);
  };

  if (loading) return <div className="text-muted-foreground text-sm py-8">Loading subscription...</div>;

  const currentPlan = sub?.plan || "FREE";
  const currentStatus = sub?.status || "ACTIVE";
  const detail = planDetails[currentPlan] || planDetails.FREE;
  const Icon = detail.icon;

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
            message.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/30 text-emerald-200"
              : "border border-red-400/40 bg-red-900/30 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className={`rounded-2xl border border-border/40 bg-gradient-to-br ${detail.gradient} p-6`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-background/50 flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${detail.color}`} />
            </div>
            <div>
              <h3 className="font-semibold text-lg">{currentPlan} Plan</h3>
              <p className="text-xs text-muted-foreground">
                {currentStatus === "TRIALING" ? (
                  <span className="flex items-center gap-1 text-orange-400">
                    <Clock className="w-3 h-3" />
                    Trial ends {sub?.subscription?.trialEndsAt
                      ? new Date(sub.subscription.trialEndsAt).toLocaleDateString()
                      : "soon"}
                  </span>
                ) : currentStatus === "ACTIVE" && currentPlan !== "FREE" ? (
                  <span className="text-emerald-400">Active</span>
                ) : (
                  <span>Free tier</span>
                )}
              </p>
            </div>
          </div>
          {currentPlan !== "FREE" && (
            <div className="text-right">
              <p className="text-2xl font-bold">
                {sub?.subscription?.currency === "USD" ? "US" : "TT"}$
                {sub?.subscription?.priceMonthly || 0}
              </p>
              <p className="text-xs text-muted-foreground">/month</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {planFeatures[currentPlan]?.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-background/30 text-xs">
              <Check className="w-3 h-3 text-emerald-400" />
              {f}
            </span>
          ))}
        </div>
      </div>

      {sub?.trialExpired && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="w-4 h-4" />
          Your trial has expired. Upgrade to continue using premium features.
        </div>
      )}

      {currentPlan !== "KEYFLOW" && (
        <div>
          <h4 className="text-sm font-semibold mb-3">Upgrade Your Plan</h4>

          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-muted-foreground">Currency:</span>
            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-muted/30 border border-border/40">
              <button
                onClick={() => setSelectedCurrency("TTD")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  selectedCurrency === "TTD" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                TTD
              </button>
              <button
                onClick={() => setSelectedCurrency("USD")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  selectedCurrency === "USD" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                USD
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(["FLOW", "KEYFLOW"] as const)
              .filter((p) => {
                const order = { FREE: 0, FLOW: 1, KEYFLOW: 2 };
                return order[p] > order[currentPlan as keyof typeof order];
              })
              .map((planId) => {
                const price = selectedCurrency === "TTD" ? planPricing[planId].ttd : planPricing[planId].usd;
                const pd = planDetails[planId];
                const PIcon = pd.icon;

                return (
                  <div
                    key={planId}
                    className={`rounded-xl border border-border/40 p-5 transition-all ${
                      selectedPlan === planId ? "ring-2 ring-primary bg-primary/5" : "hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <PIcon className={`w-4 h-4 ${pd.color}`} />
                      <span className="font-semibold">{planId}</span>
                      {planId === "FLOW" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-medium">
                          Popular
                        </span>
                      )}
                    </div>
                    <p className="text-2xl font-bold mb-1">
                      {selectedCurrency === "TTD" ? "TT" : "US"}${price}
                      <span className="text-xs font-normal text-muted-foreground">/mo</span>
                    </p>
                    <p className="text-xs text-orange-400 mb-3">1-day free trial</p>

                    <ul className="space-y-1.5 mb-4">
                      {planFeatures[planId].slice(0, 5).map((f) => (
                        <li key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Check className="w-3 h-3 text-emerald-400" />
                          {f}
                        </li>
                      ))}
                    </ul>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleStartTrial(planId)}
                        disabled={upgrading}
                        className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
                      >
                        {upgrading ? "..." : "Start Trial"}
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleActivate(planId)}
                        disabled={upgrading}
                        className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-border/40 text-xs font-medium hover:bg-muted/20 disabled:opacity-50 transition-all"
                      >
                        <CreditCard className="w-3 h-3" />
                        Pay Now
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {currentPlan !== "FREE" && (
        <div className="border-t border-border/40 pt-4">
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            {cancelling ? "Cancelling..." : "Cancel subscription"}
          </button>
        </div>
      )}
    </div>
  );
}
