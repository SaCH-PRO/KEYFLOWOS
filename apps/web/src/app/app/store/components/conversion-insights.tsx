"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Eye,
  ShoppingCart,
  CreditCard,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  ChevronDown,
  Shield,
  Search,
  Lightbulb,
  Loader2,
  RefreshCw,
  MousePointerClick,
  Heart,
} from "lucide-react";
import {
  fetchConversionFunnel,
  fetchProductHealth,
  fetchSeoHealth,
  fetchConversionSuggestions,
  fetchAiConversionAdvice,
  type ConversionFunnel,
  type ProductHealthAudit,
  type SeoHealthReport,
  type ConversionSuggestionsResponse,
  type AiConversionAdvice,
} from "@/lib/client";

type Props = {
  businessId: string;
  onTabChange: (tab: string) => void;
};

const STAGE_CONFIG: Record<string, { label: string; icon: typeof Eye; color: string }> = {
  page_view: { label: "Page Views", icon: Eye, color: "hsl(var(--kf-accent1))" },
  item_view: { label: "Product Views", icon: MousePointerClick, color: "hsl(220 80% 60%)" },
  add_to_cart: { label: "Add to Cart", icon: ShoppingCart, color: "hsl(280 70% 60%)" },
  checkout_start: { label: "Checkout", icon: CreditCard, color: "hsl(30 90% 55%)" },
  checkout_complete: { label: "Completed", icon: CheckCircle, color: "hsl(142 70% 50%)" },
};

function ScoreRing({ score, size = 48, strokeWidth = 4, color }: { score: number; size?: number; strokeWidth?: number; color: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="hsl(var(--kf-muted)/0.2)" strokeWidth={strokeWidth} fill="none" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1, ease: "easeOut" }}
        strokeDasharray={circumference}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="text-xs font-bold fill-current"
        style={{ transform: "rotate(90deg)", transformOrigin: "center" }}
      >
        {score}
      </text>
    </svg>
  );
}

function WeeklyReportCard({ funnel }: { funnel: ConversionFunnel }) {
  const trend = funnel.weekOverWeekChange;
  const isPositive = trend > 0;
  const isNeutral = trend === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1)/0.1)" }}>
              <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Weekly Conversion Report</h3>
              <p className="text-[10px] text-muted-foreground">This week vs. last week</p>
            </div>
          </div>
          {!isNeutral && (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold"
              style={{
                background: isPositive ? "hsl(142 70% 50%/0.1)" : "hsl(0 70% 50%/0.1)",
                color: isPositive ? "hsl(142 70% 55%)" : "hsl(0 70% 55%)",
              }}
            >
              {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {isPositive ? "+" : ""}{trend}%
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed mb-4" style={{ background: "hsl(var(--kf-muted)/0.08)", borderRadius: "0.75rem", padding: "0.75rem 1rem" }}>
          {funnel.summary}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { label: "Visitors", value: String(funnel.thisWeek.totalVisitors), changeColor: undefined },
            { label: "Completed", value: String(funnel.thisWeek.totalCompleted), changeColor: undefined },
            { label: "Conv. Rate", value: `${funnel.thisWeek.overallConversionRate}%`, changeColor: undefined },
            { label: "WoW Change", value: `${trend > 0 ? "+" : ""}${trend}%`, changeColor: isPositive ? "hsl(142 70% 55%)" : trend < 0 ? "hsl(0 70% 55%)" : undefined },
          ] as Array<{ label: string; value: string; changeColor: string | undefined }>).map((metric) => (
            <div
              key={metric.label}
              className="rounded-xl px-3 py-2.5"
              style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)" }}
            >
              <p className="text-[10px] text-muted-foreground mb-1">{metric.label}</p>
              <p
                className="text-base font-bold"
                style={{ color: metric.changeColor }}
              >
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function FunnelVisualization({ funnel }: { funnel: ConversionFunnel }) {
  const [open, setOpen] = useState(true);
  const stages = funnel.thisWeek.funnel;
  const maxCount = Math.max(...stages.map(s => s.count), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3.5 flex items-center justify-between transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)]"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1)/0.1)" }}>
            <TrendingUp className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <span className="text-sm font-semibold">Conversion Funnel</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] text-muted-foreground hidden sm:block">
            {funnel.thisWeek.totalCompleted}/{funnel.thisWeek.totalVisitors} converted
          </span>
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.25)" }}>
              <div className="space-y-2.5 mt-2.5">
                {stages.map((stage, i) => {
                  const config = STAGE_CONFIG[stage.stage] ?? { label: stage.stage, icon: Eye, color: "hsl(var(--kf-accent1))" };
                  const Icon = config.icon;
                  const pct = maxCount > 0 ? Math.round((stage.count / maxCount) * 100) : 0;

                  return (
                    <div key={stage.stage} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                          <span className="text-xs font-medium">{config.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold tabular-nums">{stage.count}</span>
                          {i > 0 && stage.dropOff > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: "hsl(0 70% 50%/0.1)", color: "hsl(0 70% 55%)" }}>
                              -{stage.dropOff}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.15)" }}>
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: config.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: "easeOut", delay: i * 0.1 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function HealthScoreCard({
  title,
  icon: Icon,
  score,
  summary,
  details,
  onFix,
  color,
}: {
  title: string;
  icon: typeof Shield;
  score: number;
  summary: string;
  details?: { message: string; status?: string; severity?: string; fix?: { action: string; target: string } }[];
  onFix: (action: string, target: string) => void;
  color: string;
}) {
  const [open, setOpen] = useState(false);
  const scoreColor = score >= 80 ? "hsl(142 70% 50%)" : score >= 60 ? "hsl(40 90% 55%)" : "hsl(0 70% 55%)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3.5 flex items-center gap-3 transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)]"
      >
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}12` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold">{title}</span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: `${scoreColor}15`, color: scoreColor }}
            >
              {score}/100
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{summary}</p>
        </div>
        <ScoreRing score={score} size={40} strokeWidth={3} color={scoreColor} />
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex-shrink-0">
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && details && details.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-1" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.25)" }}>
              {details.slice(0, 8).map((item, i) => {
                const status = item.status ?? item.severity ?? "info";
                const statusColor = status === "pass" ? "hsl(142 70% 50%)" :
                  status === "fail" || status === "critical" || status === "high" ? "hsl(0 70% 55%)" :
                  status === "warn" || status === "medium" ? "hsl(40 90% 55%)" : "hsl(var(--kf-muted-foreground))";

                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-start gap-2.5 px-2 py-2 rounded-xl group"
                  >
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: statusColor }} />
                    <p className="text-[11px] text-muted-foreground leading-relaxed flex-1">{item.message}</p>
                    {item.fix && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onFix(item.fix!.action, item.fix!.target); }}
                        className="text-[10px] font-medium px-2 py-1 rounded-lg flex-shrink-0 transition-colors hover:bg-[hsl(var(--kf-accent1)/0.1)]"
                        style={{ color: "hsl(var(--kf-accent1))" }}
                      >
                        Fix it
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SuggestionsPanel({
  suggestions,
  onNavigate,
}: {
  suggestions: ConversionSuggestionsResponse | null;
  onNavigate: (action: string, target: string) => void;
}) {
  if (!suggestions || suggestions.suggestions.length === 0) return null;

  const priorityColor = (p: string) =>
    p === "high" ? "hsl(0 70% 55%)" : p === "medium" ? "hsl(40 90% 55%)" : "hsl(142 70% 50%)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
    >
      <div className="px-4 py-3.5 flex items-center gap-2.5" style={{ borderBottom: "1px solid hsl(var(--kf-border)/0.25)" }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "hsl(40 90% 55%/0.1)" }}>
          <Lightbulb className="w-3.5 h-3.5" style={{ color: "hsl(40 90% 55%)" }} />
        </div>
        <span className="text-sm font-semibold">Improvement Suggestions</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto" style={{ background: "hsl(var(--kf-accent1)/0.1)", color: "hsl(var(--kf-accent1))" }}>
          {suggestions.suggestions.length}
        </span>
      </div>

      <div className="p-3 space-y-1.5">
        {suggestions.suggestions.map((suggestion, i) => (
          <motion.div
            key={suggestion.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.35 + i * 0.05 }}
            className="flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)] group"
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
              style={{ background: priorityColor(suggestion.priority) }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium leading-tight mb-0.5">{suggestion.title}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{suggestion.message}</p>
            </div>
            {suggestion.fix && (
              <button
                onClick={() => onNavigate(suggestion.fix!.action, suggestion.fix!.target)}
                className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg flex-shrink-0 transition-all hover:scale-[1.02]"
                style={{
                  background: "hsl(var(--kf-accent1)/0.1)",
                  color: "hsl(var(--kf-accent1))",
                  border: "1px solid hsl(var(--kf-accent1)/0.2)",
                }}
              >
                Fix it <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function AiAdvicePanel({
  businessId,
}: {
  businessId: string;
  onNavigate: (action: string, target: string) => void;
}) {
  const [advice, setAdvice] = useState<AiConversionAdvice | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);

  const loadAdvice = useCallback(async () => {
    setLoading(true);
    const res = await fetchAiConversionAdvice(businessId);
    if (res.data) setAdvice(res.data);
    setLoading(false);
    setHasRequested(true);
  }, [businessId]);

  if (!hasRequested) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="rounded-2xl overflow-hidden"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
      >
        <div className="p-5 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto" style={{ background: "hsl(280 70% 60%/0.1)" }}>
            <Sparkles className="w-5 h-5" style={{ color: "hsl(280 70% 60%)" }} />
          </div>
          <div>
            <p className="text-sm font-semibold mb-1">AI Conversion Advisor</p>
            <p className="text-[11px] text-muted-foreground">Get personalized recommendations to improve your storefront conversions</p>
          </div>
          <button
            onClick={loadAdvice}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-white transition-all hover:scale-[1.02]"
            style={{ background: "hsl(280 70% 60%)" }}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Get AI Recommendations
          </button>
        </div>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <motion.div className="rounded-2xl p-6 text-center" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: "hsl(280 70% 60%)" }} />
        <p className="text-xs text-muted-foreground">Analyzing your storefront...</p>
      </motion.div>
    );
  }

  if (!advice || advice.recommendations.length === 0) {
    return null;
  }

  const categoryIcon = (cat: string) => {
    switch (cat) {
      case "listing": return Heart;
      case "seo": return Search;
      case "conversion": return TrendingUp;
      case "marketing": return Sparkles;
      case "trust": return Shield;
      default: return Lightbulb;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
    >
      <div className="px-4 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid hsl(var(--kf-border)/0.25)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "hsl(280 70% 60%/0.1)" }}>
            <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(280 70% 60%)" }} />
          </div>
          <span className="text-sm font-semibold">AI Recommendations</span>
        </div>
        <button
          onClick={loadAdvice}
          disabled={loading}
          className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)]"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="p-3 space-y-2">
        {advice.recommendations.map((rec, i) => {
          const CatIcon = categoryIcon(rec.category);
          const pColor = rec.priority === "high" ? "hsl(0 70% 55%)" : rec.priority === "medium" ? "hsl(40 90% 55%)" : "hsl(142 70% 50%)";

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="rounded-xl px-3.5 py-3 space-y-1.5"
              style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.3)" }}
            >
              <div className="flex items-center gap-2">
                <CatIcon className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold flex-1">{rec.title}</span>
                <span
                  className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                  style={{ background: `${pColor}15`, color: pColor }}
                >
                  {rec.priority}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.description}</p>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

export function ConversionInsightsPanel({ businessId, onTabChange }: Props) {
  const [funnel, setFunnel] = useState<ConversionFunnel | null>(null);
  const [health, setHealth] = useState<ProductHealthAudit | null>(null);
  const [seo, setSeo] = useState<SeoHealthReport | null>(null);
  const [suggestions, setSuggestions] = useState<ConversionSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [funnelRes, healthRes, seoRes, suggestionsRes] = await Promise.all([
        fetchConversionFunnel(businessId).catch(() => ({ data: null, error: null })),
        fetchProductHealth(businessId).catch(() => ({ data: null, error: null })),
        fetchSeoHealth(businessId).catch(() => ({ data: null, error: null })),
        fetchConversionSuggestions(businessId).catch(() => ({ data: null, error: null })),
      ]);
      if (funnelRes.data) setFunnel(funnelRes.data);
      if (healthRes.data) setHealth(healthRes.data);
      if (seoRes.data) setSeo(seoRes.data);
      if (suggestionsRes.data) setSuggestions(suggestionsRes.data);
      setLoading(false);
    };
    load();
  }, [businessId]);

  const handleFix = useCallback((action: string, target: string) => {
    const validTabs = ["overview", "products", "hours", "settings", "customize"];
    if (action === "navigate" && validTabs.includes(target)) {
      onTabChange(target);
    } else if (action === "edit_product") {
      onTabChange("products");
    } else if (validTabs.includes(target)) {
      onTabChange(target);
    } else {
      onTabChange("products");
    }
  }, [onTabChange]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="rounded-2xl p-5 animate-pulse"
            style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.3)" }}
          >
            <div className="h-4 w-32 rounded mb-3" style={{ background: "hsl(var(--kf-muted)/0.3)" }} />
            <div className="h-3 w-full rounded mb-2" style={{ background: "hsl(var(--kf-muted)/0.2)" }} />
            <div className="h-3 w-3/4 rounded" style={{ background: "hsl(var(--kf-muted)/0.15)" }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {funnel && <WeeklyReportCard funnel={funnel} />}

      {funnel && funnel.thisWeek.totalVisitors > 0 && <FunnelVisualization funnel={funnel} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {health && (
          <HealthScoreCard
            title="Listing Health"
            icon={AlertTriangle}
            score={health.score}
            summary={health.summary}
            details={health.issues.map(i => ({
              message: i.message,
              severity: i.severity,
              fix: i.fix,
            }))}
            onFix={handleFix}
            color="hsl(40 90% 55%)"
          />
        )}

        {seo && (
          <HealthScoreCard
            title="SEO Health"
            icon={Search}
            score={seo.score}
            summary={seo.summary}
            details={seo.checks.map(c => ({
              message: c.message,
              status: c.status,
              fix: c.fix,
            }))}
            onFix={handleFix}
            color="hsl(220 80% 60%)"
          />
        )}
      </div>

      <SuggestionsPanel suggestions={suggestions} onNavigate={handleFix} />

      <AiAdvicePanel businessId={businessId} onNavigate={handleFix} />
    </div>
  );
}
