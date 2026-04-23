"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CreditCard, Crown, CheckCircle2, AlertCircle } from "lucide-react";
import { useBusinessSettings } from "./use-business-settings";
import { PaymentsTab } from "./payments-tab";
import { BillingTab } from "./billing-tab";

const tabs = [
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "billing", label: "Billing", icon: Crown },
] as const;

type TabKey = (typeof tabs)[number]["key"];

function SkeletonBusiness() {
  return (
    <div className="space-y-6 max-w-3xl animate-pulse">
      <div className="flex gap-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-10 w-24 bg-muted/30 rounded-xl" />
        ))}
      </div>
      <div className="kf-card p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-muted/20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function BusinessSettingsPage() {
  const { loading, business, status } = useBusinessSettings();
  const [activeTab, setActiveTab] = useState<TabKey>("payments");

  if (loading) return <SkeletonBusiness />;

  if (!business) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="kf-card p-8 text-center max-w-md mx-auto">
        <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <h3 className="text-lg font-semibold mb-1">No Business Found</h3>
        <p className="text-sm text-muted-foreground">Please set up your workspace first through the onboarding wizard.</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-3xl"
    >
      {status && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm ${
            status.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/20 text-emerald-200"
              : "border border-red-400/40 bg-red-900/20 text-red-200"
          }`}
        >
          {status.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {status.message}
        </motion.div>
      )}

      <div className="flex gap-1 p-1 rounded-2xl bg-muted/30 backdrop-blur-sm border border-border/40 overflow-x-auto scrollbar-none" role="tablist">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-all shrink-0 ${
              activeTab === key
                ? "text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/80"
            }`}
            role="tab"
            aria-selected={activeTab === key}
          >
            {activeTab === key && (
              <motion.div
                layoutId="business-tab-bg"
                className="absolute inset-0 rounded-xl bg-background border border-border/60 shadow-sm"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </span>
          </button>
        ))}
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="kf-card p-6"
      >
        {activeTab === "payments" && <PaymentsTab />}
        {activeTab === "billing" && <BillingTab />}
      </motion.div>
    </motion.div>
  );
}
