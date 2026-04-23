"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Users,
  FileText,
  CreditCard,
  DollarSign,
  ArrowRight,
  TrendingDown,
  Loader2,
  Sparkles,
  Lightbulb,
  Target,
  AlertTriangle,
} from "lucide-react";
import { commerceAiRevenueJourney, type CommerceRevenueJourney } from "@/lib/client";

interface RevenueJourneyPanelProps {
  businessId: string | null;
}

const STAGE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  contact_to_quote: { label: "Contact → Quote", icon: Users, color: "text-blue-400" },
  quote_to_invoice: { label: "Quote → Invoice", icon: FileText, color: "text-violet-400" },
  invoice_to_payment: { label: "Invoice → Payment", icon: CreditCard, color: "text-emerald-400" },
};

export function RevenueJourneyPanel({ businessId }: RevenueJourneyPanelProps) {
  const [data, setData] = useState<CommerceRevenueJourney | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await commerceAiRevenueJourney(businessId);
      if (res.data) setData(res.data);
    } catch {
      setError("Failed to analyze revenue journey. Please try again.");
    }
    setLoading(false);
  }, [businessId]);

  if (!data && !loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-indigo-500/10">
            <Target className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Revenue Journey</h3>
            <p className="text-xs text-muted-foreground">CRM Contact → Quote → Invoice → Payment funnel</p>
          </div>
        </div>
        {error && <p className="text-xs text-red-400 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{error}</p>}
        <button
          onClick={analyze}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", color: "white" }}
        >
          <Sparkles className="w-4 h-4" />
          Analyze Revenue Funnel
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-8 flex flex-col items-center">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400 mb-3" />
        <p className="text-sm text-muted-foreground">Analyzing revenue journey...</p>
      </div>
    );
  }

  if (!data) return null;

  const { funnel } = data;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card/80 overflow-hidden"
    >
      <div className="p-4 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/10">
            <Target className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Revenue Journey</h3>
            <p className="text-xs text-muted-foreground">{funnel.overallConversionRate}% end-to-end conversion</p>
          </div>
        </div>
        <button onClick={analyze} className="text-xs text-muted-foreground hover:text-foreground">Refresh</button>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
          {[
            { label: "Contacts", value: funnel.totalContacts, icon: Users, color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
            { label: "Quoted", value: funnel.contactsWithQuotes, icon: FileText, color: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
            { label: "Invoiced", value: funnel.quotesToInvoices, icon: CreditCard, color: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
            { label: "Paid", value: funnel.invoicesToPayments, icon: DollarSign, color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
          ].map((step, idx, arr) => {
            const Icon = step.icon;
            return (
              <div key={step.label} className="flex items-center gap-2 shrink-0">
                <div className={`flex flex-col items-center p-3 rounded-xl border ${step.color} min-w-[80px]`}>
                  <Icon className="w-5 h-5 mb-1" />
                  <span className="text-xl font-bold">{step.value}</span>
                  <span className="text-[10px] opacity-70">{step.label}</span>
                </div>
                {idx < arr.length - 1 && (
                  <div className="flex flex-col items-center">
                    <ArrowRight className="w-4 h-4 text-muted-foreground/30" />
                    <span className="text-[9px] text-muted-foreground/50">
                      {idx === 0 ? `${funnel.contactToQuoteRate}%` : idx === 1 ? `${funnel.quoteToInvoiceRate}%` : `${funnel.invoiceToPaymentRate}%`}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {data.dropOffPoints.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs font-medium mb-2 text-muted-foreground">Drop-Off Points</p>
          <div className="space-y-2">
            {data.dropOffPoints.map((drop, idx) => {
              const config = STAGE_CONFIG[drop.stage] ?? { label: drop.stage, icon: TrendingDown, color: "text-muted-foreground" };
              const StageIcon = config.icon;
              return (
                <div key={idx} className="p-3 rounded-lg bg-muted/20 border border-border/30">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <StageIcon className={`w-3.5 h-3.5 ${config.color}`} />
                      <span className="text-xs font-medium">{config.label}</span>
                    </div>
                    <span className="text-xs font-bold text-red-400">{drop.dropOffRate}% drop-off</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{drop.reason}</p>
                  {drop.estimatedLostRevenue > 0 && (
                    <p className="text-[10px] text-red-300 mt-0.5">~${drop.estimatedLostRevenue.toLocaleString()} estimated lost revenue</p>
                  )}
                  <p className="text-[10px] text-emerald-300 mt-0.5">{drop.improvement}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.insights.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs font-medium mb-2 text-muted-foreground">Insights</p>
          <div className="space-y-1.5">
            {data.insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Lightbulb className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{insight}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recommendations.length > 0 && (
        <div className="px-4 py-3 border-t border-border/30 bg-indigo-500/5 space-y-2">
          {data.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium mt-0.5 shrink-0 ${rec.priority === "high" ? "text-red-400 bg-red-500/15 border-red-500/30" : rec.priority === "medium" ? "text-amber-400 bg-amber-500/15 border-amber-500/30" : "text-emerald-400 bg-emerald-500/15 border-emerald-500/30"}`}>
                {rec.priority}
              </span>
              <div>
                <p className="text-xs font-medium">{rec.title}</p>
                <p className="text-[10px] text-muted-foreground">{rec.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
