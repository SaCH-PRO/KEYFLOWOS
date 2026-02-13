"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { apiGet, apiPost } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  Crown, Zap, Check, Sparkles, ArrowUpRight, Clock,
  AlertTriangle, CreditCard, Shield, Star,
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

const planDetails: Record<string, { icon: typeof Zap; color: string; gradient: string; glow: string }> = {
  FREE: { icon: Zap, color: "text-gray-400", gradient: "from-gray-500/10 to-gray-600/10", glow: "shadow-gray-500/5" },
  FLOW: { icon: Sparkles, color: "text-orange-400", gradient: "from-orange-500/15 to-teal-500/15", glow: "shadow-orange-500/10" },
  KEYFLOW: { icon: Crown, color: "text-amber-400", gradient: "from-amber-500/15 to-orange-500/15", glow: "shadow-amber-500/10" },
};

const planFeatures: Record<string, string[]> = {
  FREE: ["50 contacts", "5 invoices/month", "10 bookings/month", "1 staff member", "Basic CRM"],
  FLOW: [
    "500 contacts", "Unlimited invoices", "100 bookings/month", "5 staff members",
    "Quotes & proposals", "5 automations", "Online store", "Custom branding",
  ],
  KEYFLOW: [
    "Unlimited everything", "AI Autopilot", "Unlimited automations",
    "Priority support", "Advanced analytics", "Custom integrations",
  ],
};

const planPricing: Record<string, { ttd: number; usd: number }> = {
  FREE: { ttd: 0, usd: 0 },
  FLOW: { ttd: 99, usd: 15 },
  KEYFLOW: { ttd: 249, usd: 39 },
};

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

export function BillingTab() {
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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

  useEffect(() => { loadSubscription(); }, [loadSubscription]);

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

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-40 rounded-2xl bg-muted/20" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-64 rounded-xl bg-muted/20" />
          <div className="h-64 rounded-xl bg-muted/20" />
        </div>
      </div>
    );
  }

  const currentPlan = sub?.plan || "FREE";
  const currentStatus = sub?.status || "ACTIVE";
  const detail = planDetails[currentPlan] || planDetails.FREE;
  const Icon = detail.icon;

  return (
    <motion.div variants={{ show: { transition: { staggerChildren: 0.06 } } }} initial="hidden" animate="show" className="space-y-6">
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm ${
            message.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/20 text-emerald-200"
              : "border border-red-400/40 bg-red-900/20 text-red-200"
          }`}
        >
          {message.text}
        </motion.div>
      )}

      <motion.div variants={fadeUp} className={`rounded-2xl border border-border/40 bg-gradient-to-br ${detail.gradient} p-6 shadow-lg ${detail.glow}`}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-background/60 backdrop-blur-sm flex items-center justify-center border border-border/30">
              <Icon className={`w-6 h-6 ${detail.color}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-xl">{currentPlan}</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-background/40 text-muted-foreground">Plan</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {currentStatus === "TRIALING" ? (
                  <span className="flex items-center gap-1 text-orange-400">
                    <Clock className="w-3 h-3" />
                    Trial ends {sub?.subscription?.trialEndsAt
                      ? new Date(sub.subscription.trialEndsAt).toLocaleDateString()
                      : "soon"}
                  </span>
                ) : currentStatus === "ACTIVE" && currentPlan !== "FREE" ? (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Check className="w-3 h-3" /> Active subscription
                  </span>
                ) : (
                  <span>Free tier - limited features</span>
                )}
              </p>
            </div>
          </div>
          {currentPlan !== "FREE" && (
            <div className="text-right">
              <p className="text-3xl font-bold">
                {sub?.subscription?.currency === "USD" ? "US" : "TT"}$
                {sub?.subscription?.priceMonthly || 0}
              </p>
              <p className="text-xs text-muted-foreground">per month</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {planFeatures[currentPlan]?.map((f) => (
            <span key={f} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-background/40 backdrop-blur-sm text-xs border border-border/20">
              <Check className="w-3 h-3 text-emerald-400" />
              {f}
            </span>
          ))}
        </div>
      </motion.div>

      {sub?.trialExpired && (
        <motion.div variants={fadeUp} className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Your trial has expired. Upgrade to continue using premium features.
        </motion.div>
      )}

      {currentPlan !== "KEYFLOW" && (
        <motion.div variants={fadeUp}>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Star className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              Upgrade Your Plan
            </h4>
            <div className="inline-flex items-center gap-1 p-0.5 rounded-xl bg-muted/30 border border-border/40">
              {(["TTD", "USD"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCurrency(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedCurrency === c
                      ? "bg-background text-foreground shadow-sm border border-border/60"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
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
                const isPopular = planId === "FLOW";

                return (
                  <div
                    key={planId}
                    className={`relative rounded-xl border p-5 transition-all hover:shadow-md ${
                      isPopular ? "border-[hsl(var(--kf-accent1))]/40 ring-1 ring-[hsl(var(--kf-accent1))]/20" : "border-border/40"
                    }`}
                  >
                    {isPopular && (
                      <div className="absolute -top-2.5 left-4 px-2.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))] text-white text-[10px] font-semibold">
                        Most Popular
                      </div>
                    )}

                    <div className="flex items-center gap-2 mb-3">
                      <PIcon className={`w-5 h-5 ${pd.color}`} />
                      <span className="font-bold text-lg">{planId}</span>
                    </div>

                    <div className="mb-4">
                      <span className="text-3xl font-bold">
                        {selectedCurrency === "TTD" ? "TT" : "US"}${price}
                      </span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                      <p className="text-xs text-orange-400 mt-1 flex items-center gap-1">
                        <Zap className="w-3 h-3" /> 1-day free trial included
                      </p>
                    </div>

                    <ul className="space-y-2 mb-5">
                      {planFeatures[planId].slice(0, 6).map((f) => (
                        <li key={f} className="flex items-center gap-2 text-xs">
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-muted-foreground">{f}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleStartTrial(planId)}
                        disabled={upgrading}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[hsl(var(--kf-accent1))] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
                      >
                        {upgrading ? "..." : "Start Trial"}
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleActivate(planId)}
                        disabled={upgrading}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-border/60 text-xs font-medium hover:bg-muted/20 disabled:opacity-50 transition-all"
                      >
                        <CreditCard className="w-3 h-3" />
                        Pay Now
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </motion.div>
      )}

      {currentPlan !== "FREE" && (
        <motion.div variants={fadeUp} className="flex items-center justify-between border-t border-border/40 pt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="w-4 h-4" />
            <span>Cancel anytime, no questions asked</span>
          </div>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            {cancelling ? "Cancelling..." : "Cancel subscription"}
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
