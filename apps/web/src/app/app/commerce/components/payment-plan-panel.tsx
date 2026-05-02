"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  CreditCard,
  Calendar,
  AlertTriangle,
  Loader2,
  Sparkles,
  DollarSign,
  Clock,
  Shield,
} from "lucide-react";
import { commerceAiPaymentPlan, type CommercePaymentPlan } from "@/lib/client";

interface PaymentPlanPanelProps {
  businessId: string | null;
  invoiceId: string;
  invoiceNumber: string;
  invoiceAmount: number;
  currency: string;
  onClose: () => void;
}

const RISK_COLORS: Record<string, string> = {
  low: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  medium: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  high: "text-red-400 bg-red-500/15 border-red-500/30",
};

export function PaymentPlanPanel({ businessId, invoiceId, invoiceNumber, invoiceAmount, currency, onClose }: PaymentPlanPanelProps) {
  const [data, setData] = useState<CommercePaymentPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);

  const generatePlans = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await commerceAiPaymentPlan(invoiceId, businessId);
      if (res.data) setData(res.data);
    } catch {
      setError("Failed to generate payment plans. Please try again.");
    }
    setLoading(false);
  }, [businessId, invoiceId]);

  if (!data && !loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border/50 bg-card/80 p-5"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <CreditCard className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Payment Plan for #{invoiceNumber}</h3>
            <p className="text-xs text-muted-foreground">{currency} {invoiceAmount.toLocaleString()} outstanding</p>
          </div>
        </div>
        {error && <p className="text-xs text-red-400 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{error}</p>}
        <button
          onClick={generatePlans}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", color: "white" }}
        >
          <Sparkles className="w-4 h-4" />
          Generate Payment Plans
        </button>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-8 flex flex-col items-center">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mb-3" />
        <p className="text-sm text-muted-foreground">Analyzing payment options...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card/80 overflow-hidden"
    >
      <div className="p-4 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <CreditCard className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Payment Plan Options</h3>
            <p className="text-xs text-muted-foreground">Invoice #{invoiceNumber} · {currency} {invoiceAmount.toLocaleString()}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {data.customerProfile && (
        <div className="px-4 py-3 border-b border-border/30 bg-cyan-500/5 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Shield className="w-3 h-3" /> Reliability: <span className="font-medium text-foreground">{data.customerProfile.paymentReliability}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" /> Avg delay: <span className="font-medium text-foreground">{data.customerProfile.averagePaymentDelay}d</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <DollarSign className="w-3 h-3" /> LTV: <span className="font-medium text-foreground">${data.customerProfile.totalRelationshipValue.toLocaleString()}</span>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        {data.plans.map((plan, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setSelectedPlan(selectedPlan === idx ? null : idx)}
            className={`w-full text-left p-4 rounded-xl border transition-all ${selectedPlan === idx ? "border-cyan-500/50 bg-cyan-500/5" : "border-border/40 hover:border-border/60"}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{plan.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${RISK_COLORS[plan.riskLevel] ?? RISK_COLORS.medium}`}>
                  {plan.riskLevel} risk
                </span>
              </div>
              <span className="text-sm font-bold">{plan.installments} payments</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span><Calendar className="w-3 h-3 inline mr-1" />{plan.frequency}</span>
              <span><DollarSign className="w-3 h-3 inline mr-1" />{currency} {plan.amounts[0]?.toLocaleString() ?? "—"}/payment</span>
            </div>
            {selectedPlan === idx && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 pt-3 border-t border-border/30">
                <p className="text-xs text-muted-foreground">{plan.reasoning}</p>
                {plan.startDate && (
                  <p className="text-xs text-cyan-300 mt-1">Start: {new Date(plan.startDate).toLocaleDateString()}</p>
                )}
              </motion.div>
            )}
          </button>
        ))}
      </div>

      {data.recommendation && (
        <div className="px-4 py-3 border-t border-border/30 bg-cyan-500/5">
          <p className="text-xs text-cyan-300 flex items-start gap-1.5">
            <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
            {data.recommendation}
          </p>
        </div>
      )}
    </motion.div>
  );
}
