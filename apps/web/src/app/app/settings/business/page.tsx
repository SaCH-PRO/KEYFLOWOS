"use client";

import { motion } from "framer-motion";
import { CreditCard, CheckCircle2, AlertCircle } from "lucide-react";
import { useBusinessSettings } from "./use-business-settings";
import { PaymentsTab } from "./payments-tab";

function SkeletonBusiness() {
  return (
    <div className="space-y-6 max-w-3xl animate-pulse">
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
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Business Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Payments, branding, and workspace configuration.</p>
      </div>
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

      <div className="kf-card p-6">
        <PaymentsTab />
      </div>
    </motion.div>
  );
}
