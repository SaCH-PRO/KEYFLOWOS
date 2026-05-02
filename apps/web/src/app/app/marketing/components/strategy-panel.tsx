"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
  DollarSign,
  Users,
  BarChart3,
  Zap,
  Calendar,
  Download,
  Copy,
  Check,
  X,
  Building2,
  Megaphone,
  LineChart,
  PieChart,
} from "lucide-react";
import { toast } from "sonner";
import { moduleEvents } from "@/lib/module-events";

const INDUSTRIES = [
  "E-commerce",
  "SaaS / Software",
  "Professional Services",
  "Health & Wellness",
  "Education",
  "Real Estate",
  "Food & Beverage",
  "Fashion & Beauty",
  "Finance & Insurance",
  "Travel & Hospitality",
  "Construction",
  "Media & Entertainment",
  "Nonprofit",
  "Other",
];

const BUSINESS_STAGES = [
  "Pre-launch",
  "Launch / Early Stage",
  "Growth",
  "Scaling",
  "Mature / Established",
  "Pivoting",
];

const MARKETING_CHANNELS = [
  "Social Media",
  "Email Marketing",
  "SEO / Content",
  "Paid Ads (Google)",
  "Paid Ads (Social)",
  "Influencer Marketing",
  "Referral / Word of Mouth",
  "Events / Webinars",
  "PR / Media",
  "Partnerships",
  "Direct Mail",
  "SMS Marketing",
];

interface StrategyMetrics {
  industry: string;
  monthlyRevenue: string;
  targetAudience: string;
  currentChannels: string[];
  budget: string;
  goals: string;
  competitiveLandscape: string;
  businessStage: string;
}

interface StrategySection {
  title: string;
  icon: React.ElementType;
  color: string;
  items: string[];
}

interface GeneratedStrategy {
  summary: string;
  sections: StrategySection[];
  generatedAt: string;
}

const INITIAL_METRICS: StrategyMetrics = {
  industry: "",
  monthlyRevenue: "",
  targetAudience: "",
  currentChannels: [],
  budget: "",
  goals: "",
  competitiveLandscape: "",
  businessStage: "",
};

interface StrategyPanelProps {
  businessId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function StrategyPanel({ businessId, isOpen, onClose }: StrategyPanelProps) {
  const [metrics, setMetrics] = useState<StrategyMetrics>(INITIAL_METRICS);
  const [generating, setGenerating] = useState(false);
  const [strategy, setStrategy] = useState<GeneratedStrategy | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  interface BusinessSnapshot {
    industry?: string;
    archetype?: string;
    currency?: string;
    totalRevenue?: number;
    totalContacts?: number;
    totalProducts?: number;
    totalBookings?: number;
    totalCampaigns?: number;
  }
  const [snapshot, setSnapshot] = useState<BusinessSnapshot | null>(null);
  const snapshotLoaded = useRef(false);

  useEffect(() => {
    if (!isOpen || !businessId || snapshotLoaded.current) return;
    snapshotLoaded.current = true;
    (async () => {
      try {
        const { fetchBusinessSnapshot } = await import("@/lib/client");
        const res = await fetchBusinessSnapshot(businessId);
        if (res.data) {
          const s = res.data as BusinessSnapshot;
          setSnapshot(s);
          setMetrics(prev => ({
            ...prev,
            industry: prev.industry || s.industry || "",
            businessStage: prev.businessStage || (s.archetype === "LOCAL_SERVICE" ? "Growth" : ""),
            monthlyRevenue: prev.monthlyRevenue || ((s.totalRevenue ?? 0) > 0 ? `${s.currency} ${((s.totalRevenue ?? 0) / 12).toFixed(0)}/mo (est.)` : ""),
          }));
        }
      } catch {
        // silent
      }
    })();
  }, [isOpen, businessId]);

  const toggleChannel = useCallback((channel: string) => {
    setMetrics(prev => ({
      ...prev,
      currentChannels: prev.currentChannels.includes(channel)
        ? prev.currentChannels.filter(c => c !== channel)
        : [...prev.currentChannels, channel],
    }));
  }, []);

  const isFormValid = metrics.industry && metrics.targetAudience && metrics.goals && metrics.businessStage;

  const handleGenerate = useCallback(async () => {
    if (!businessId || !isFormValid) return;
    setGenerating(true);
    try {
      const { generateMarketingStrategy } = await import("@/lib/client");
      const payload = {
        ...metrics,
        goals: metrics.goals.split(/[,\n]+/).map(g => g.trim()).filter(Boolean),
      };
      const res = await generateMarketingStrategy(businessId, payload);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      interface PlanAction { title?: string; description?: string; timeline?: string }
      interface ChannelStrategy { channel?: string; priority?: string; recommendations?: string[] }
      interface BudgetAllocation { category?: string; percentage?: number; justification?: string; amount?: string }
      interface KpiTarget { metric?: string; target30Days?: string; target90Days?: string; target12Months?: string }
      interface FinancialProjection { investment?: string; expectedRevenue?: string; netImpact?: string }
      interface CompetitiveAdvantage { advantage?: string; howToLeverage?: string }
      interface RiskItem { risk?: string; likelihood?: string; mitigation?: string }
      interface StrategyData {
        executiveSummary?: string;
        shortTermPlan?: { actions?: PlanAction[] };
        longTermPlan?: { actions?: PlanAction[] };
        channelStrategy?: ChannelStrategy[];
        budgetModel?: { totalRecommendedBudget?: string; allocation?: BudgetAllocation[]; expectedROI?: string };
        kpiTargets?: KpiTarget[];
        financialProjections?: Record<string, FinancialProjection>;
        competitiveAdvantages?: CompetitiveAdvantage[];
        risks?: RiskItem[];
      }
      const data = res.data as StrategyData;

      const shortTermItems = Array.isArray(data?.shortTermPlan?.actions)
        ? data.shortTermPlan.actions.map((a) => `${a.title}: ${a.description}${a.timeline ? ` (${a.timeline})` : ""}`)
        : ["Focus on quick wins with your existing audience", "Audit current marketing channels", "Set up tracking and analytics"];

      const longTermItems = Array.isArray(data?.longTermPlan?.actions)
        ? data.longTermPlan.actions.map((a) => `${a.title}: ${a.description}${a.timeline ? ` (${a.timeline})` : ""}`)
        : ["Build sustainable content marketing pipeline", "Develop brand authority in your niche", "Scale successful channels"];

      const channelItems = Array.isArray(data?.channelStrategy)
        ? data.channelStrategy.map((c) => `${c.channel} (${c.priority}): ${(c.recommendations ?? []).join("; ")}`)
        : ["Prioritize channels where your target audience is most active", "Test new channels with small budget allocations"];

      const budgetItems = Array.isArray(data?.budgetModel?.allocation)
        ? [
            ...(data.budgetModel.totalRecommendedBudget ? [`Total recommended: ${data.budgetModel.totalRecommendedBudget}`] : []),
            ...data.budgetModel.allocation.map((a) => `${a.category}: ${a.percentage}% — ${a.justification ?? a.amount ?? ""}`),
            ...(data.budgetModel.expectedROI ? [`Expected ROI: ${data.budgetModel.expectedROI}`] : []),
          ]
        : ["Allocate 60% to proven channels", "Reserve 20% for testing", "Keep 20% for content and tools"];

      const kpiItems = Array.isArray(data?.kpiTargets)
        ? data.kpiTargets.map((k) => `${k.metric}: ${k.target30Days ?? "—"} (30d) → ${k.target90Days ?? "—"} (90d) → ${k.target12Months ?? "—"} (12mo)`)
        : ["Define clear conversion metrics", "Set monthly growth targets", "Track CAC and LTV"];

      const financialItems = data?.financialProjections
        ? Object.entries(data.financialProjections).map(([period, vals]) =>
            `${period}: Investment ${vals?.investment ?? "—"}, Revenue ${vals?.expectedRevenue ?? "—"}, Net ${vals?.netImpact ?? "—"}`)
        : ["Project ROI for each channel", "Estimate revenue impact", "Plan for seasonal fluctuations"];

      const sections: StrategySection[] = [
        { title: "Short-Term Actions (0-3 months)", icon: Zap, color: "#f59e0b", items: shortTermItems },
        { title: "Long-Term Strategy (3-12 months)", icon: TrendingUp, color: "#22c55e", items: longTermItems },
        { title: "Channel Recommendations", icon: Megaphone, color: "#3b82f6", items: channelItems },
        { title: "Budget Allocation", icon: PieChart, color: "#8b5cf6", items: budgetItems },
        { title: "KPI Targets", icon: Target, color: "#ec4899", items: kpiItems },
        { title: "Financial Projections", icon: LineChart, color: "#14b8a6", items: financialItems },
      ];

      if (Array.isArray(data?.competitiveAdvantages) && data.competitiveAdvantages.length > 0) {
        sections.push({
          title: "Competitive Advantages",
          icon: Sparkles,
          color: "#f97316",
          items: data.competitiveAdvantages.map((a) => `${a.advantage}: ${a.howToLeverage}`),
        });
      }

      if (Array.isArray(data?.risks) && data.risks.length > 0) {
        sections.push({
          title: "Risks & Mitigations",
          icon: BarChart3,
          color: "#ef4444",
          items: data.risks.map((r) => `${r.risk} (${r.likelihood}): ${r.mitigation}`),
        });
      }

      const generatedAt = new Date().toISOString();
      setStrategy({
        summary: data?.executiveSummary ?? "Based on your business metrics, here is a tailored marketing strategy designed to maximize growth and ROI.",
        sections,
        generatedAt,
      });
      moduleEvents.emit("marketing:strategy_generated", "marketing", { generatedAt, industry: metrics.industry });
      setExpandedSections(new Set([0, 1]));
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    } catch {
      toast.error("Failed to generate strategy");
    } finally {
      setGenerating(false);
    }
  }, [businessId, metrics, isFormValid]);

  const handleCopyStrategy = useCallback(() => {
    if (!strategy) return;
    const text = [
      "AI Marketing Strategy",
      `Generated: ${new Date(strategy.generatedAt).toLocaleDateString()}`,
      "",
      strategy.summary,
      "",
      ...strategy.sections.flatMap(s => [
        `## ${s.title}`,
        ...s.items.map(item => `- ${item}`),
        "",
      ]),
    ].join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Strategy copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, [strategy]);

  const handleExport = useCallback(() => {
    if (!strategy) return;
    const text = [
      "AI MARKETING STRATEGY",
      `Generated: ${new Date(strategy.generatedAt).toLocaleDateString()}`,
      "=".repeat(50),
      "",
      strategy.summary,
      "",
      ...strategy.sections.flatMap(s => [
        `----- ${s.title} -----`,
        ...s.items.map(item => `• ${item}`),
        "",
      ]),
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `marketing-strategy-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Strategy exported");
  }, [strategy]);

  const toggleSection = useCallback((idx: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setMetrics(INITIAL_METRICS);
    setStrategy(null);
    setExpandedSections(new Set());
  }, []);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
          onClick={e => e.stopPropagation()}
          className="relative w-full max-w-2xl kf-card border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-border/40 bg-background/80 backdrop-blur-md rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20">
                <Brain className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">AI Marketing Strategy</h2>
                <p className="text-xs text-muted-foreground">Input your business metrics for a tailored plan</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 space-y-5">
            {snapshot && (
              <div className="bg-muted/20 border border-border/30 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-xs font-medium text-[hsl(var(--kf-accent1))]">Business data loaded — strategy will use real evidence</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-[11px]">
                  {[
                    ["Contacts", snapshot.totalContacts],
                    ["Products", snapshot.totalProducts],
                    ["Revenue", `${snapshot.currency} ${Number(snapshot.totalRevenue || 0).toLocaleString()}`],
                    ["Bookings", snapshot.totalBookings],
                    ["Campaigns", snapshot.totalCampaigns],
                  ].map(([label, val]) => (
                    <div key={String(label)} className="bg-muted/30 rounded-lg p-1.5 text-center">
                      <div className="font-semibold text-xs">{val}</div>
                      <div className="text-muted-foreground text-[10px]">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Industry *</label>
                <select
                  value={metrics.industry}
                  onChange={e => setMetrics(p => ({ ...p, industry: e.target.value }))}
                  className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                >
                  <option value="">Select industry...</option>
                  {INDUSTRIES.map(i => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Business Stage *</label>
                <select
                  value={metrics.businessStage}
                  onChange={e => setMetrics(p => ({ ...p, businessStage: e.target.value }))}
                  className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                >
                  <option value="">Select stage...</option>
                  {BUSINESS_STAGES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  <DollarSign className="w-3 h-3 inline mr-1" />
                  Monthly Revenue
                </label>
                <input
                  value={metrics.monthlyRevenue}
                  onChange={e => setMetrics(p => ({ ...p, monthlyRevenue: e.target.value }))}
                  placeholder={`e.g. 10,000 ${snapshot?.currency || 'TTD'}`}
                  className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  <DollarSign className="w-3 h-3 inline mr-1" />
                  Monthly Marketing Budget
                </label>
                <input
                  value={metrics.budget}
                  onChange={e => setMetrics(p => ({ ...p, budget: e.target.value }))}
                  placeholder={`e.g. 2,000 ${snapshot?.currency || 'TTD'}`}
                  className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                <Users className="w-3 h-3 inline mr-1" />
                Target Audience *
              </label>
              <textarea
                value={metrics.targetAudience}
                onChange={e => setMetrics(p => ({ ...p, targetAudience: e.target.value }))}
                placeholder="Describe your ideal customer: demographics, interests, pain points..."
                rows={2}
                className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                <Target className="w-3 h-3 inline mr-1" />
                Marketing Goals *
              </label>
              <textarea
                value={metrics.goals}
                onChange={e => setMetrics(p => ({ ...p, goals: e.target.value }))}
                placeholder="e.g. Increase brand awareness, generate 50 leads/month, improve retention by 20%..."
                rows={2}
                className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                <Building2 className="w-3 h-3 inline mr-1" />
                Competitive Landscape
              </label>
              <textarea
                value={metrics.competitiveLandscape}
                onChange={e => setMetrics(p => ({ ...p, competitiveLandscape: e.target.value }))}
                placeholder="Key competitors, their strengths, market positioning..."
                rows={2}
                className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-2">Current Marketing Channels</label>
              <div className="flex flex-wrap gap-1.5">
                {MARKETING_CHANNELS.map(channel => (
                  <button
                    key={channel}
                    onClick={() => toggleChannel(channel)}
                    className={
                      metrics.currentChannels.includes(channel)
                        ? "text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                        : "text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all text-muted-foreground hover:text-foreground border border-border/40 hover:bg-muted/40"
                    }
                  >
                    {channel}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleGenerate}
                disabled={generating || !isFormValid}
                className="flex-1 inline-flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating Strategy...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Strategy
                  </>
                )}
              </button>
              {strategy && (
                <button
                  onClick={handleReset}
                  className="text-xs text-muted-foreground hover:text-foreground px-3 py-2.5 rounded-xl border border-border/40 hover:bg-muted/30 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
            {!isFormValid && (
              <p className="text-[11px] text-muted-foreground">* Fill in required fields to generate your strategy</p>
            )}
          </div>

          <AnimatePresence>
            {strategy && (
              <motion.div
                ref={resultRef}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="border-t border-border/40 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                      <h3 className="text-sm font-semibold">Your Marketing Strategy</h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleCopyStrategy}
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                        aria-label="Copy strategy"
                      >
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                      <button
                        onClick={handleExport}
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                        aria-label="Export strategy"
                      >
                        <Download className="w-3 h-3" />
                        Export
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">{strategy.summary}</p>

                  <div className="space-y-2">
                    {strategy.sections.map((section, idx) => (
                      <div key={idx} className="border border-border/30 rounded-xl overflow-hidden">
                        <button
                          onClick={() => toggleSection(idx)}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/20 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${section.color}15` }}>
                              <section.icon className="w-3.5 h-3.5" style={{ color: section.color }} />
                            </div>
                            <span className="text-sm font-medium">{section.title}</span>
                          </div>
                          {expandedSections.has(idx) ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                        <AnimatePresence>
                          {expandedSections.has(idx) && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-3 pb-3 space-y-1.5">
                                {section.items.map((item, i) => (
                                  <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: section.color }} />
                                    <span className="leading-relaxed">{item}</span>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 pt-1">
                    <Calendar className="w-3 h-3" />
                    <span>Generated {new Date(strategy.generatedAt).toLocaleString()}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default StrategyPanel;
