"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { apiGet, apiPost } from "@/lib/api";
import { fetchAiUsageHistory, type AiUsageHistoryResponse } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  Crown, Zap, Check, Sparkles, ArrowUpRight, Clock,
  AlertTriangle, CreditCard, Shield, Star, Brain,
  TrendingUp, BarChart3, Activity, ChevronDown, ChevronUp,
  Receipt, Lock, Users, Calendar, Globe, Megaphone,
  FolderKanban, X, Eye, EyeOff, Wallet, Banknote,
  Loader2, CheckCircle2, DollarSign, FileText,
} from "lucide-react";

interface BillingDashboard {
  plan: {
    id: string;
    name: string;
    tagline: string;
    status: string;
    trialExpired: boolean;
    subscription: {
      id: string;
      currency: string;
      priceMonthly: number;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      gateway: string | null;
      createdAt: string;
    } | null;
  };
  billing: {
    totalMonthlyCost: number;
    currency: string;
    breakdown: Array<{ item: string; amount: number; type: string }>;
    periodStart: string;
    periodEnd: string;
    nextBillingDate: string | null;
  };
  aiUsage: {
    creditsUsed: number;
    creditsLimit: number;
    creditsRemaining: number;
    isUnlimited: boolean;
    overageCredits: number;
    overageCost: number;
    overageCurrency: string;
    estimatedApiCost: number;
    byFeature: Array<{ feature: string; credits: number; calls: number; cost: number }>;
  };
  resourceUsage: Array<{
    key: string;
    label: string;
    description: string;
    category: string;
    current: number;
    limit: number;
    isUnlimited: boolean;
    percent: number;
    atLimit: boolean;
    nearLimit: boolean;
  }>;
  featureAccess: Array<{
    key: string;
    label: string;
    description: string;
    category: string;
    hasAccess: boolean;
    availableFrom: string;
  }>;
  featureMatrix: Array<{
    key: string;
    label: string;
    description: string;
    category: string;
    type: string;
    FREE: number | boolean | string;
    FLOW: number | boolean | string;
    KEYFLOW: number | boolean | string;
  }>;
  categories: Record<string, { label: string; icon: string }>;
}

interface SubscriptionPaymentRecord {
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  reference: string | null;
  notes: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  subscription: { plan: string; status: string };
}

const methodLabels: Record<string, string> = {
  wipay: "Card (WiPay)",
  paypal: "PayPal",
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  manual: "Manual",
};

const methodIcons: Record<string, typeof CreditCard> = {
  wipay: CreditCard,
  paypal: Wallet,
  bank_transfer: Banknote,
  cash: DollarSign,
  manual: FileText,
};

const planDetails: Record<string, { icon: typeof Zap; color: string; gradient: string; glow: string; badge: string }> = {
  FREE: { icon: Zap, color: "text-gray-400", gradient: "from-gray-500/10 to-gray-600/10", glow: "shadow-gray-500/5", badge: "bg-gray-500/20 text-gray-300" },
  FLOW: { icon: Sparkles, color: "text-orange-400", gradient: "from-orange-500/15 to-teal-500/15", glow: "shadow-orange-500/10", badge: "bg-orange-500/20 text-orange-300" },
  KEYFLOW: { icon: Crown, color: "text-amber-400", gradient: "from-amber-500/15 to-orange-500/15", glow: "shadow-amber-500/10", badge: "bg-amber-500/20 text-amber-300" },
};

const planPricing: Record<string, { ttd: number; usd: number }> = {
  FREE: { ttd: 0, usd: 0 },
  FLOW: { ttd: 99, usd: 15 },
  KEYFLOW: { ttd: 249, usd: 39 },
};

const planFeatures: Record<string, string[]> = {
  FREE: ["50 contacts", "5 invoices/month", "10 bookings/month", "10 AI credits/month", "Basic CRM"],
  FLOW: [
    "500 contacts", "Unlimited invoices", "100 bookings/month", "100 AI credits/month",
    "AI business advisor", "Quotes & proposals", "5 automations", "Online store", "Custom branding",
  ],
  KEYFLOW: [
    "Unlimited everything", "Unlimited AI credits", "AI Autopilot",
    "Priority support", "Advanced analytics", "All AI features",
  ],
};

const featureLabels: Record<string, string> = {
  chat: "AI Chat",
  briefing: "Daily Briefing",
  forecast: "Cash Flow Forecast",
  simulation: "What-If Simulator",
  report_narrative: "Report AI Narratives",
  seo_analysis: "SEO Analysis",
  email_draft: "Email Drafts",
  social_caption: "Social Captions",
};

const categoryIcons: Record<string, typeof Users> = {
  crm: Users,
  commerce: CreditCard,
  marketplace: Globe,
  bookings: Calendar,
  marketing: Megaphone,
  ai: Brain,
  operations: FolderKanban,
  analytics: BarChart3,
  platform: Shield,
};

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

type BillingSubTab = "overview" | "usage" | "features" | "history" | "payments";

export function BillingTab() {
  const [dashboard, setDashboard] = useState<BillingDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<"TTD" | "USD">("TTD");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [usageHistory, setUsageHistory] = useState<AiUsageHistoryResponse | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<BillingSubTab>("overview");
  const [showMatrix, setShowMatrix] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<{open: boolean; action: () => void}>({open: false, action: () => {}});
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [checkoutMethod, setCheckoutMethod] = useState<string>("manual");
  const [checkoutRef, setCheckoutRef] = useState("");
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [checkoutProcessing, setCheckoutProcessing] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<SubscriptionPaymentRecord[]>([]);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);

  const businessId = getStoredBusinessId();

  const loadAll = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await apiGet<BillingDashboard>(`/subscriptions/businesses/${businessId}/billing-dashboard`);
    if (res.data) setDashboard(res.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadHistory = async () => {
    if (!businessId) return;
    const res = await fetchAiUsageHistory(businessId, 20, 0);
    if (res.data) setUsageHistory(res.data);
    setShowHistory(true);
  };

  const loadPayments = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<SubscriptionPaymentRecord[]>(`/subscriptions/businesses/${businessId}/payments`);
    if (res.data) setPaymentHistory(Array.isArray(res.data) ? res.data : []);
    setPaymentsLoaded(true);
  }, [businessId]);

  const handleCheckoutPay = async () => {
    if (!businessId || !checkoutPlan) return;
    setCheckoutProcessing(true);
    setMessage(null);

    const res = await apiPost<unknown>({
      path: `/subscriptions/businesses/${businessId}/record-payment`,
      body: {
        plan: checkoutPlan,
        currency: selectedCurrency,
        method: checkoutMethod,
        reference: checkoutRef || undefined,
        notes: checkoutNotes || undefined,
      },
    });

    if (res.error) {
      setMessage({ type: "error", text: res.error });
      toast.error(res.error);
    } else {
      setMessage({ type: "success", text: `${checkoutPlan} plan activated!` });
      toast.success(`${checkoutPlan} plan activated with ${methodLabels[checkoutMethod] || checkoutMethod} payment!`);
      setCheckoutPlan(null);
      setCheckoutMethod("manual");
      setCheckoutRef("");
      setCheckoutNotes("");
      await loadAll();
      await loadPayments();
    }
    setCheckoutProcessing(false);
  };

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
      toast.error(res.error);
    } else {
      setMessage({ type: "success", text: `${plan} trial started! You have 1 day to explore.` });
      toast.success(`${plan} trial started!`);
      await loadAll();
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
      toast.error(res.error);
    } else {
      setMessage({ type: "success", text: `${plan} plan activated!` });
      toast.success(`${plan} plan activated!`);
      await loadAll();
    }
    setUpgrading(false);
  };

  const handleCancel = async () => {
    if (!businessId) return;
    setConfirmState({
      open: true,
      action: async () => {
        setCancelling(true);
        setMessage(null);
        const res = await apiPost<{ message: string }>({
          path: `/subscriptions/businesses/${businessId}/cancel`,
          body: {},
        });
        if (res.error) {
          setMessage({ type: "error", text: res.error });
          toast.error(res.error);
        } else {
          setMessage({ type: "success", text: res.data?.message || "Subscription cancelled." });
          toast.success("Subscription cancelled");
          await loadAll();
        }
        setCancelling(false);
      },
    });
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-40 rounded-2xl bg-muted/20" />
        <div className="h-12 rounded-xl bg-muted/20" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-64 rounded-xl bg-muted/20" />
          <div className="h-64 rounded-xl bg-muted/20" />
        </div>
      </div>
    );
  }

  if (!dashboard) return null;

  const currentPlan = dashboard.plan.id;
  const detail = planDetails[currentPlan] || planDetails.FREE;
  const Icon = detail.icon;
  const cur = dashboard.billing.currency === "USD" ? "US" : "TT";

  const creditPercent = dashboard.aiUsage && !dashboard.aiUsage.isUnlimited && dashboard.aiUsage.creditsLimit > 0
    ? Math.min(100, Math.round((dashboard.aiUsage.creditsUsed / dashboard.aiUsage.creditsLimit) * 100))
    : 0;

  const atLimitCount = dashboard.resourceUsage.filter(r => r.atLimit).length;
  const nearLimitCount = dashboard.resourceUsage.filter(r => r.nearLimit && !r.atLimit).length;
  const lockedCount = dashboard.featureAccess.filter(f => !f.hasAccess).length;

  const subTabs: { key: BillingSubTab; label: string; icon: typeof Receipt }[] = [
    { key: "overview", label: "Overview", icon: Receipt },
    { key: "payments", label: "Payments", icon: CreditCard },
    { key: "usage", label: "Usage & Limits", icon: BarChart3 },
    { key: "features", label: "Feature Access", icon: Shield },
    { key: "history", label: "AI History", icon: Activity },
  ];

  const groupedUsage: Record<string, typeof dashboard.resourceUsage> = {};
  dashboard.resourceUsage.forEach(r => {
    if (!groupedUsage[r.category]) groupedUsage[r.category] = [];
    groupedUsage[r.category].push(r);
  });

  const groupedAccess: Record<string, typeof dashboard.featureAccess> = {};
  dashboard.featureAccess.forEach(f => {
    if (!groupedAccess[f.category]) groupedAccess[f.category] = [];
    groupedAccess[f.category].push(f);
  });

  return (
    <motion.div variants={{ show: { transition: { staggerChildren: 0.06 } } }} initial="hidden" animate="show" className="space-y-5">
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
          <button onClick={() => setMessage(null)} className="ml-auto"><X className="w-3 h-3" /></button>
        </motion.div>
      )}

      {/* Current Plan Header */}
      <motion.div variants={fadeUp} className={`rounded-2xl border border-border/40 bg-gradient-to-br ${detail.gradient} p-5 shadow-lg ${detail.glow}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-background/60 backdrop-blur-sm flex items-center justify-center border border-border/30">
              <Icon className={`w-5 h-5 ${detail.color}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg">{dashboard.plan.name}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${detail.badge}`}>
                  {dashboard.plan.status === "TRIALING" ? "Trial" : "Active"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {dashboard.plan.status === "TRIALING" && dashboard.plan.subscription?.trialEndsAt ? (
                  <span className="flex items-center gap-1 text-orange-400">
                    <Clock className="w-3 h-3" />
                    Trial ends {new Date(dashboard.plan.subscription.trialEndsAt).toLocaleDateString()}
                  </span>
                ) : currentPlan !== "FREE" ? (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Check className="w-3 h-3" /> Active subscription
                  </span>
                ) : (
                  <span>{dashboard.plan.tagline}</span>
                )}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">
              {cur}${dashboard.billing.totalMonthlyCost.toFixed(2)}
            </p>
            <p className="text-[10px] text-muted-foreground">total this month</p>
          </div>
        </div>

        {/* Quick Stats Row */}
        <div className="flex flex-wrap gap-2">
          {atLimitCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-900/30 text-xs text-red-300 border border-red-400/20">
              <AlertTriangle className="w-3 h-3" /> {atLimitCount} at limit
            </span>
          )}
          {nearLimitCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-900/30 text-xs text-amber-300 border border-amber-400/20">
              <AlertTriangle className="w-3 h-3" /> {nearLimitCount} near limit
            </span>
          )}
          {lockedCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-background/40 text-xs text-muted-foreground border border-border/20">
              <Lock className="w-3 h-3" /> {lockedCount} locked features
            </span>
          )}
          {atLimitCount === 0 && nearLimitCount === 0 && lockedCount === 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-900/30 text-xs text-emerald-300 border border-emerald-400/20">
              <Check className="w-3 h-3" /> All features available
            </span>
          )}
        </div>
      </motion.div>

      {/* Sub-tab Navigation */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/20 border border-border/30 overflow-x-auto scrollbar-none">
        {subTabs.map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            onClick={() => setActiveSubTab(key)}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all shrink-0 ${
              activeSubTab === key ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
            }`}
          >
            {activeSubTab === key && (
              <motion.div
                layoutId="billing-sub-tab"
                className="absolute inset-0 rounded-lg bg-background border border-border/60 shadow-sm"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <TabIcon className="w-3.5 h-3.5" />
              {label}
            </span>
          </button>
        ))}
      </div>

      {dashboard.plan.trialExpired && (
        <motion.div variants={fadeUp} className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Your trial has expired. Upgrade to continue using premium features.
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={activeSubTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="space-y-5"
        >
          {/* ========== OVERVIEW TAB ========== */}
          {activeSubTab === "overview" && (
            <>
              {/* Monthly Bill Summary */}
              <motion.div variants={fadeUp} className="rounded-2xl border border-border/40 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Receipt className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                    Monthly Bill Breakdown
                  </h4>
                  <span className="text-[10px] px-2 py-1 rounded-lg bg-background/40 text-muted-foreground">
                    {new Date(dashboard.billing.periodStart).toLocaleDateString()} - {new Date(dashboard.billing.periodEnd).toLocaleDateString()}
                  </span>
                </div>

                <div className="space-y-2 mb-4">
                  {dashboard.billing.breakdown.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-muted/10">
                      <div className="flex items-center gap-2">
                        {item.type === "subscription" ? (
                          <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        )}
                        <span className="text-sm">{item.item}</span>
                      </div>
                      <span className="text-sm font-semibold">{cur}${item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-3 px-3 rounded-lg bg-muted/20 border-t border-border/40">
                    <span className="text-sm font-bold">Total Due</span>
                    <span className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
                      {cur}${dashboard.billing.totalMonthlyCost.toFixed(2)}
                    </span>
                  </div>
                </div>

                {dashboard.billing.nextBillingDate && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Next billing: {new Date(dashboard.billing.nextBillingDate).toLocaleDateString()}
                  </p>
                )}
              </motion.div>

              {/* AI Credits Card */}
              <motion.div variants={fadeUp} className="rounded-2xl border border-border/40 bg-gradient-to-br from-violet-500/10 to-indigo-500/10 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Brain className="w-4 h-4 text-violet-400" />
                    AI Credits
                  </h4>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-background/40 text-muted-foreground">
                    {dashboard.aiUsage.isUnlimited ? "Unlimited" : `${dashboard.aiUsage.creditsRemaining} remaining`}
                  </span>
                </div>

                <div className="flex items-end justify-between mb-2">
                  <div>
                    <span className="text-2xl font-bold">{dashboard.aiUsage.creditsUsed}</span>
                    <span className="text-sm text-muted-foreground">
                      {dashboard.aiUsage.isUnlimited ? " used" : ` / ${dashboard.aiUsage.creditsLimit}`}
                    </span>
                  </div>
                  {dashboard.aiUsage.isUnlimited && (
                    <span className="text-xs text-violet-400 font-medium flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Unlimited
                    </span>
                  )}
                </div>

                {!dashboard.aiUsage.isUnlimited && (
                  <div className="h-2.5 bg-background/40 rounded-full overflow-hidden border border-border/20 mb-3">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${creditPercent}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className={`h-full rounded-full ${
                        creditPercent >= 90 ? "bg-gradient-to-r from-red-500 to-red-400" :
                        creditPercent >= 70 ? "bg-gradient-to-r from-amber-500 to-amber-400" :
                        "bg-gradient-to-r from-violet-500 to-indigo-400"
                      }`}
                    />
                  </div>
                )}

                {dashboard.aiUsage.overageCredits > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 mb-3">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {dashboard.aiUsage.overageCredits} overage credits ({cur}${dashboard.aiUsage.overageCost.toFixed(2)} extra)
                  </div>
                )}

                {dashboard.aiUsage.byFeature.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    {dashboard.aiUsage.byFeature.map((f) => (
                      <div key={f.feature} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-background/30 border border-border/20">
                        <span className="text-[11px]">{featureLabels[f.feature] || f.feature}</span>
                        <span className="text-[11px] font-semibold">{f.credits} cr</span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>

              {/* Quick Resource Usage Summary */}
              <motion.div variants={fadeUp} className="rounded-2xl border border-border/40 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                    Resource Usage Snapshot
                  </h4>
                  <button
                    onClick={() => setActiveSubTab("usage")}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    View all <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {dashboard.resourceUsage.slice(0, 6).map(r => (
                    <div key={r.key} className={`px-3 py-2.5 rounded-xl border ${
                      r.atLimit ? "border-red-400/30 bg-red-900/10" :
                      r.nearLimit ? "border-amber-400/30 bg-amber-900/10" :
                      "border-border/20 bg-muted/10"
                    }`}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{r.label}</p>
                      <div className="flex items-baseline gap-1 mt-1">
                        <span className="text-lg font-bold">{r.current}</span>
                        <span className="text-xs text-muted-foreground">
                          / {r.isUnlimited ? "∞" : r.limit}
                        </span>
                      </div>
                      {!r.isUnlimited && r.limit > 0 && (
                        <div className="h-1 bg-background/40 rounded-full overflow-hidden mt-1.5">
                          <div
                            className={`h-full rounded-full transition-all ${
                              r.atLimit ? "bg-red-400" : r.nearLimit ? "bg-amber-400" : "bg-emerald-400"
                            }`}
                            style={{ width: `${r.percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Upgrade Section */}
              {currentPlan !== "KEYFLOW" && (
                <motion.div variants={fadeUp}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Star className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                      Upgrade Your Plan
                    </h4>
                    <div className="inline-flex items-center gap-1 p-0.5 rounded-xl bg-muted/30 border border-border/40">
                      {(["TTD", "USD"] as const).map((c) => (
                        <button
                          key={c}
                          onClick={() => setSelectedCurrency(c)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                            className={`relative rounded-xl border p-4 transition-all hover:shadow-md ${
                              isPopular ? "border-[hsl(var(--kf-accent1))]/40 ring-1 ring-[hsl(var(--kf-accent1))]/20" : "border-border/40"
                            }`}
                          >
                            {isPopular && (
                              <div className="absolute -top-2.5 left-4 px-2.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))] text-white text-[10px] font-semibold">
                                Most Popular
                              </div>
                            )}
                            <div className="flex items-center gap-2 mb-2">
                              <PIcon className={`w-5 h-5 ${pd.color}`} />
                              <span className="font-bold text-lg">{planId}</span>
                            </div>
                            <div className="mb-3">
                              <span className="text-2xl font-bold">
                                {selectedCurrency === "TTD" ? "TT" : "US"}${price}
                              </span>
                              <span className="text-sm text-muted-foreground">/mo</span>
                              <p className="text-xs text-orange-400 mt-1 flex items-center gap-1">
                                <Zap className="w-3 h-3" /> 1-day free trial
                              </p>
                            </div>
                            <ul className="space-y-1.5 mb-4">
                              {planFeatures[planId].slice(0, 5).map((f) => (
                                <li key={f} className="flex items-center gap-2 text-xs">
                                  <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                                  <span className="text-muted-foreground">{f}</span>
                                </li>
                              ))}
                            </ul>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleStartTrial(planId)}
                                disabled={upgrading}
                                className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl bg-[hsl(var(--kf-accent1))] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
                              >
                                {upgrading ? "..." : "Start Trial"}
                                <ArrowUpRight className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => { setCheckoutPlan(planId); setCheckoutMethod("manual"); setCheckoutRef(""); setCheckoutNotes(""); }}
                                disabled={upgrading}
                                className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl border border-border/60 text-xs font-medium hover:bg-muted/20 disabled:opacity-50 transition-all"
                              >
                                <CreditCard className="w-3 h-3" /> Pay
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </motion.div>
              )}

              {currentPlan !== "FREE" && (
                <div className="flex items-center justify-between border-t border-border/40 pt-4">
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
                </div>
              )}
            </>
          )}

          {/* ========== USAGE & LIMITS TAB ========== */}
          {activeSubTab === "usage" && (
            <div className="space-y-4">
              {Object.entries(groupedUsage).map(([cat, resources]) => {
                const catInfo = dashboard.categories[cat];
                const CatIcon = categoryIcons[cat] || Shield;
                return (
                  <motion.div key={cat} variants={fadeUp} className="rounded-2xl border border-border/40 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CatIcon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                      <h4 className="text-sm font-semibold">{catInfo?.label || cat}</h4>
                    </div>
                    <div className="space-y-3">
                      {resources.map(r => (
                        <div key={r.key} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium">{r.label}</span>
                              <span className="text-[10px] text-muted-foreground ml-2">{r.description}</span>
                            </div>
                            <div className="text-right">
                              <span className={`text-sm font-bold ${r.atLimit ? "text-red-400" : r.nearLimit ? "text-amber-400" : ""}`}>
                                {r.current}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {" / "}{r.isUnlimited ? "∞" : r.limit}
                              </span>
                              {r.atLimit && (
                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300">LIMIT</span>
                              )}
                            </div>
                          </div>
                          <div className="h-2 bg-background/40 rounded-full overflow-hidden border border-border/20">
                            {r.isUnlimited ? (
                              <div className="h-full w-full bg-gradient-to-r from-emerald-500/30 to-emerald-400/30 rounded-full" />
                            ) : (
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${r.percent}%` }}
                                transition={{ duration: 0.6, ease: "easeOut" }}
                                className={`h-full rounded-full ${
                                  r.atLimit ? "bg-red-400" : r.nearLimit ? "bg-amber-400" : "bg-emerald-400"
                                }`}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* ========== FEATURE ACCESS TAB ========== */}
          {activeSubTab === "features" && (
            <div className="space-y-4">
              {/* Toggle matrix view */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Features available on your <span className={`font-semibold ${detail.color}`}>{dashboard.plan.name}</span> plan
                </p>
                <button
                  onClick={() => setShowMatrix(!showMatrix)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  {showMatrix ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showMatrix ? "Hide" : "Show"} comparison
                </button>
              </div>

              {showMatrix && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="rounded-2xl border border-border/40 overflow-hidden"
                >
                  <div className="grid grid-cols-[1fr_70px_70px_70px] text-center text-[10px] font-semibold uppercase tracking-wider bg-muted/20 py-2 px-3 border-b border-border/30">
                    <span className="text-left">Feature</span>
                    <span className="text-gray-400">Free</span>
                    <span className="text-orange-400">Flow</span>
                    <span className="text-amber-400">KeyFlow</span>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {dashboard.featureMatrix.map((f, i) => (
                      <div key={f.key} className={`grid grid-cols-[1fr_70px_70px_70px] text-center text-xs py-2 px-3 ${i % 2 ? "bg-muted/5" : ""}`}>
                        <span className="text-left text-muted-foreground">{f.label}</span>
                        {(["FREE", "FLOW", "KEYFLOW"] as const).map(tier => {
                          const val = f[tier];
                          if (typeof val === "boolean") {
                            return val ? (
                              <Check key={tier} className="w-3.5 h-3.5 text-emerald-400 mx-auto" />
                            ) : (
                              <X key={tier} className="w-3.5 h-3.5 text-red-400/40 mx-auto" />
                            );
                          }
                          if (val === "Unlimited") {
                            return <span key={tier} className="text-emerald-400 text-[10px] font-semibold">∞</span>;
                          }
                          if (val === 0) {
                            return <X key={tier} className="w-3.5 h-3.5 text-red-400/40 mx-auto" />;
                          }
                          return <span key={tier} className="font-medium">{String(val)}</span>;
                        })}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Grouped feature access */}
              {Object.entries(groupedAccess).map(([cat, features]) => {
                const catInfo = dashboard.categories[cat];
                const CatIcon = categoryIcons[cat] || Shield;
                const isExpanded = expandedCategories.has(cat);

                return (
                  <motion.div key={cat} variants={fadeUp} className="rounded-2xl border border-border/40">
                    <button
                      onClick={() => toggleCategory(cat)}
                      className="w-full flex items-center justify-between p-4 hover:bg-muted/10 transition-colors rounded-2xl"
                    >
                      <div className="flex items-center gap-2">
                        <CatIcon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                        <h4 className="text-sm font-semibold">{catInfo?.label || cat}</h4>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground">
                          {features.filter(f => f.hasAccess).length}/{features.length}
                        </span>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="px-4 pb-4 space-y-2"
                        >
                          {features.map(f => (
                            <div key={f.key} className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                              f.hasAccess ? "bg-emerald-900/10 border border-emerald-400/20" : "bg-muted/10 border border-border/20"
                            }`}>
                              <div className="flex items-center gap-2">
                                {f.hasAccess ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                                )}
                                <div>
                                  <span className="text-sm">{f.label}</span>
                                  <p className="text-[10px] text-muted-foreground">{f.description}</p>
                                </div>
                              </div>
                              {!f.hasAccess && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                  f.availableFrom === "FLOW" ? "bg-orange-500/20 text-orange-300" : "bg-amber-500/20 text-amber-300"
                                }`}>
                                  {f.availableFrom}+
                                </span>
                              )}
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}

              {/* Limit-based features also shown here grouped */}
              <motion.div variants={fadeUp} className="rounded-2xl border border-border/40 p-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  Resource Limits by Plan
                </h4>
                <div className="space-y-2">
                  {dashboard.resourceUsage.map(r => {
                    const matrixItem = dashboard.featureMatrix.find(f => f.key === r.key);
                    return (
                      <div key={r.key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/10 border border-border/20">
                        <span className="text-xs">{r.label}</span>
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="text-gray-400">{matrixItem?.FREE === "Unlimited" ? "∞" : String(matrixItem?.FREE ?? 0)}</span>
                          <span className="text-orange-400">{matrixItem?.FLOW === "Unlimited" ? "∞" : String(matrixItem?.FLOW ?? 0)}</span>
                          <span className="text-amber-400">{matrixItem?.KEYFLOW === "Unlimited" ? "∞" : String(matrixItem?.KEYFLOW ?? 0)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400" /> Free</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" /> Flow</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> KeyFlow</span>
                </div>
              </motion.div>
            </div>
          )}

          {/* ========== AI HISTORY TAB ========== */}
          {activeSubTab === "history" && (
            <div className="space-y-4">
              <motion.div variants={fadeUp} className="rounded-2xl border border-border/40 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-violet-400" />
                    AI Usage Activity Log
                  </h4>
                  {!showHistory && (
                    <button
                      onClick={loadHistory}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    >
                      Load history <ArrowUpRight className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* AI Credit Costs Reference */}
                <div className="mb-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Credit Costs per Feature</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {Object.entries(featureLabels).map(([key, label]) => {
                      const creditCosts: Record<string, number> = { chat: 1, briefing: 2, forecast: 1, simulation: 3, report_narrative: 2, seo_analysis: 1, email_draft: 1, social_caption: 1 };
                      return (
                        <div key={key} className="px-2.5 py-1.5 rounded-lg bg-muted/10 border border-border/20 text-center">
                          <p className="text-[10px] text-muted-foreground">{label}</p>
                          <p className="text-xs font-bold mt-0.5">{creditCosts[key] || 1} cr</p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Overage: TT$2.50 / US$0.35 per extra credit beyond your plan limit.
                  </p>
                </div>

                {/* This month's AI breakdown */}
                {dashboard.aiUsage.byFeature.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">This Month's Breakdown</p>
                    <div className="space-y-1.5">
                      {dashboard.aiUsage.byFeature.map(f => (
                        <div key={f.feature} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/10 border border-border/20">
                          <div className="flex items-center gap-2">
                            <Brain className="w-3 h-3 text-violet-400" />
                            <span className="text-xs">{featureLabels[f.feature] || f.feature}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-muted-foreground">{f.calls}x calls</span>
                            <span className="font-semibold">{f.credits} credits</span>
                            <span className="text-muted-foreground">${f.cost.toFixed(4)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detailed history */}
                {showHistory && usageHistory && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Recent Activity</p>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {usageHistory.logs.map((log) => (
                        <div key={log.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/10 text-xs">
                          <div className="flex items-center gap-2">
                            <Brain className="w-3 h-3 text-violet-400" />
                            <span>{featureLabels[log.feature] || log.feature}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">{log.totalTokens} tok</span>
                            <span className="font-medium">{log.creditsUsed} cr</span>
                            <span className="text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                      {usageHistory.logs.length === 0 && (
                        <p className="text-center text-muted-foreground py-4 text-sm">No usage history yet</p>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 text-right">
                      Showing {usageHistory.logs.length} of {usageHistory.total} entries
                    </p>
                  </motion.div>
                )}

                {!showHistory && (
                  <div className="text-center py-4">
                    <button
                      onClick={loadHistory}
                      className="text-sm text-[hsl(var(--kf-accent1))] hover:opacity-80 transition-opacity flex items-center gap-1 mx-auto"
                    >
                      <Activity className="w-4 h-4" /> Load Activity Log
                    </button>
                  </div>
                )}
              </motion.div>
            </div>
          )}
          {/* ========== PAYMENTS TAB ========== */}
          {activeSubTab === "payments" && (
            <div className="space-y-4">
              <motion.div variants={fadeUp} className="rounded-2xl border border-border/40 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Receipt className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                    Payment History
                  </h4>
                  {!paymentsLoaded ? (
                    <button
                      onClick={loadPayments}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    >
                      Load payments <ArrowUpRight className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      onClick={loadPayments}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Refresh
                    </button>
                  )}
                </div>

                {paymentsLoaded ? (
                  paymentHistory.length > 0 ? (
                    <div className="space-y-2">
                      {paymentHistory.map((p) => {
                        const MIcon = methodIcons[p.method] || FileText;
                        return (
                          <div key={p.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-muted/10 border border-border/20">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[hsl(var(--kf-accent1))]/10">
                                <MIcon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">{p.subscription.plan} Plan</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                    p.status === "COMPLETED"
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : p.status === "PENDING"
                                      ? "bg-amber-500/20 text-amber-300"
                                      : "bg-red-500/20 text-red-300"
                                  }`}>
                                    {p.status}
                                  </span>
                                </div>
                                <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                                  <span>{methodLabels[p.method] || p.method}</span>
                                  {p.reference && <span>Ref: {p.reference}</span>}
                                  <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-bold">
                                {p.currency === "USD" ? "US" : "TT"}${p.amount.toFixed(2)}
                              </span>
                              {p.periodStart && p.periodEnd && (
                                <p className="text-[10px] text-muted-foreground">
                                  {new Date(p.periodStart).toLocaleDateString()} - {new Date(p.periodEnd).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Receipt className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No payments recorded yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Payments will appear here when you subscribe to a plan</p>
                    </div>
                  )
                ) : (
                  <div className="text-center py-8">
                    <button
                      onClick={loadPayments}
                      className="text-sm flex items-center gap-1 mx-auto hover:opacity-80 transition-opacity"
                      style={{ color: "hsl(var(--kf-accent1))" }}
                    >
                      <CreditCard className="w-4 h-4" /> Load Payment History
                    </button>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ========== CHECKOUT MODAL ========== */}
      <AnimatePresence>
        {checkoutPlan && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md rounded-2xl border border-border/60 bg-[hsl(var(--kf-surface))] p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Wallet className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  Subscribe to {checkoutPlan}
                </h3>
                <button onClick={() => setCheckoutPlan(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 mb-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{checkoutPlan} Plan</p>
                    <p className="text-xs text-muted-foreground">Monthly subscription</p>
                  </div>
                  <p className="text-xl font-bold">
                    {selectedCurrency === "TTD" ? "TT" : "US"}${planPricing[checkoutPlan]?.[selectedCurrency === "TTD" ? "ttd" : "usd"] || 0}/mo
                  </p>
                </div>
              </div>

              <div className="space-y-3 mb-5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "manual", label: "Manual Activation", icon: CheckCircle2, desc: "Activate immediately" },
                    { id: "bank_transfer", label: "Bank Transfer", icon: Banknote, desc: "Send proof of payment" },
                    { id: "cash", label: "Cash", icon: DollarSign, desc: "In-person payment" },
                    { id: "wipay", label: "Card (WiPay)", icon: CreditCard, desc: "Coming soon", disabled: true },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => !("disabled" in m && m.disabled) && setCheckoutMethod(m.id)}
                      disabled={"disabled" in m && m.disabled}
                      className={`relative p-3 rounded-xl border text-left transition-all ${
                        checkoutMethod === m.id
                          ? "border-[hsl(var(--kf-accent1))]/60 bg-[hsl(var(--kf-accent1))]/5"
                          : "border-border/30 hover:border-border/60"
                      } ${"disabled" in m && m.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <m.icon className="w-4 h-4 mb-1" style={checkoutMethod === m.id ? { color: "hsl(var(--kf-accent1))" } : {}} />
                      <p className="text-xs font-medium">{m.label}</p>
                      <p className="text-[10px] text-muted-foreground">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {(checkoutMethod === "bank_transfer" || checkoutMethod === "cash") && (
                <div className="space-y-3 mb-5">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Reference / Receipt #</label>
                    <input
                      value={checkoutRef}
                      onChange={(e) => setCheckoutRef(e.target.value)}
                      placeholder="e.g. TXN-12345"
                      className="w-full px-3 py-2 rounded-xl bg-muted/20 border border-border/40 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/60"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                    <textarea
                      value={checkoutNotes}
                      onChange={(e) => setCheckoutNotes(e.target.value)}
                      placeholder="Optional payment notes..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl bg-muted/20 border border-border/40 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/60 resize-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setCheckoutPlan(null)}
                  className="flex-1 py-2.5 rounded-xl border border-border/60 text-sm font-medium hover:bg-muted/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCheckoutPay}
                  disabled={checkoutProcessing}
                  className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                  style={{ backgroundColor: "hsl(var(--kf-accent1))" }}
                >
                  {checkoutProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Activate {checkoutPlan}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmState.open}
        title="Cancel Subscription"
        message="Are you sure you want to cancel your subscription? You will revert to the Free plan."
        confirmLabel="Cancel Subscription"
        variant="danger"
        onConfirm={() => { confirmState.action(); setConfirmState({open: false, action: () => {}}); }}
        onCancel={() => setConfirmState({open: false, action: () => {}})}
      />
    </motion.div>
  );
}
