"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
  AlertTriangle,
  AlertCircle,
  Info,
  ExternalLink,
  Copy,
  PartyPopper,
  Rocket,
  TrendingUp,
  ShieldCheck,
  Megaphone,
} from "lucide-react";
import type { ReadinessItem as ApiReadinessItem, ReadinessScores } from "@/lib/client";

type UnifiedItem = {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: "blocker" | "warning" | "tip";
  resolveLabel: string;
  resolveTab: string;
  resolved: boolean;
};

type Props = {
  readinessItems?: ApiReadinessItem[];
  readinessScores?: ReadinessScores | null;
  onTabChange: (tab: string) => void;
  slug?: string;
  storeName?: string;
};

const SEV_CONFIG = {
  blocker: {
    label: "Blockers",
    color: "hsl(var(--kf-error, 0 84% 60%))",
    bg: "hsl(var(--kf-error, 0 84% 60%) / 0.1)",
    icon: AlertCircle,
  },
  warning: {
    label: "Warnings",
    color: "hsl(var(--kf-warning))",
    bg: "hsl(var(--kf-warning) / 0.1)",
    icon: AlertTriangle,
  },
  tip: {
    label: "Tips",
    color: "hsl(var(--kf-accent1))",
    bg: "hsl(var(--kf-accent1) / 0.1)",
    icon: Info,
  },
};

const CATEGORY_CONFIG: Record<string, { label: string; weight: number }> = {
  launch: { label: "Launch", weight: 35 },
  conversion: { label: "Conversion", weight: 30 },
  merchandising: { label: "Merchandising", weight: 20 },
  promotion: { label: "Promotion", weight: 15 },
};

function mapApiItems(apiItems: ApiReadinessItem[]): UnifiedItem[] {
  return apiItems.map((item) => ({
    id: item.id,
    category: item.category,
    title: item.title,
    description: item.detail,
    severity: item.severity,
    resolveLabel: item.actionLabel,
    resolveTab: item.actionTab,
    resolved: item.resolved,
  }));
}

type DimensionScore = {
  id: string;
  label: string;
  score: number;
  weight: number;
};

function buildDimensionScores(items: UnifiedItem[], apiScores?: ReadinessScores | null): DimensionScore[] {
  if (apiScores) {
    return [
      { id: "launch", label: "Launch", score: apiScores.launch, weight: 35 },
      { id: "conversion", label: "Conversion", score: apiScores.conversion, weight: 30 },
      { id: "merchandising", label: "Merchandising", score: apiScores.merchandising, weight: 20 },
      { id: "promotion", label: "Promotion", score: apiScores.promotion, weight: 15 },
    ];
  }

  return Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => {
    const catItems = items.filter((i) => i.category === cat);
    const total = catItems.length;
    const done = catItems.filter((i) => i.resolved).length;
    return {
      id: cat,
      label: cfg.label,
      score: total === 0 ? 100 : Math.round((done / total) * 100),
      weight: cfg.weight,
    };
  });
}

function computeOverallScore(dims: DimensionScore[], apiScores?: ReadinessScores | null): number {
  if (apiScores) return apiScores.overall;
  const totalWeight = dims.reduce((a, d) => a + d.weight, 0);
  const weighted = dims.reduce((a, d) => a + (d.score * d.weight) / 100, 0);
  return Math.round((weighted / totalWeight) * 100);
}

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const color =
    score >= 80 ? "hsl(var(--kf-success))" : score >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error, 0 84% 60%))";
  const r = (size / 2) * 0.75;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--kf-muted)/0.2)" strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fontSize={size * 0.22} fontWeight="bold" fill={color}>
        {score}
      </text>
    </svg>
  );
}

export function LaunchAdvisor({
  readinessItems,
  readinessScores,
  onTabChange,
  slug,
  storeName,
}: Props) {
  const items: UnifiedItem[] = readinessItems ? mapApiItems(readinessItems) : [];
  const dims = buildDimensionScores(items, readinessScores);
  const score = computeOverallScore(dims, readinessScores);
  const incomplete = items.filter((i) => !i.resolved);
  const blockers = incomplete.filter((i) => i.severity === "blocker");
  const warnings = incomplete.filter((i) => i.severity === "warning");
  const tips = incomplete.filter((i) => i.severity === "tip");
  const allComplete = incomplete.length === 0;

  const [open, setOpen] = useState(true);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPostLaunch, setShowPostLaunch] = useState(false);

  const storeUrl = slug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/book/${slug}`
    : "";

  const scoreColor =
    score >= 80 ? "hsl(var(--kf-success))" : score >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error, 0 84% 60%))";

  const postLaunchSuggestions = [
    { icon: Megaphone, title: "Launch campaign", description: "Share your store link on social media with a launch announcement to drive initial traffic." },
    { icon: TrendingUp, title: "Promote bestsellers", description: "Feature your top-selling or most popular items prominently in your catalog." },
    { icon: ShieldCheck, title: "Enable review collection", description: "Ask your first customers to leave testimonials to build social proof quickly." },
    { icon: Sparkles, title: "Improve hero copy", description: "Use AI to generate a compelling headline and call-to-action for your hero section." },
    { icon: Rocket, title: "Add urgency", description: "Consider adding a limited-time offer or promotional banner to your storefront." },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="space-y-3"
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="w-full text-left px-4 py-4 flex items-center gap-4 transition-colors hover:bg-[hsl(var(--kf-muted)/0.05)]"
        >
          <ScoreRing score={score} size={52} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-bold">
                {allComplete ? "Store Ready to Launch!" : "Launch Readiness"}
              </span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${scoreColor}15`, color: scoreColor }}
              >
                {score}/100
              </span>
              {blockers.length > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-error, 0 84% 60%) / 0.12)", color: "hsl(var(--kf-error, 0 84% 60%))" }}>
                  {blockers.length} blocker{blockers.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {dims.map((d) => (
                <div key={d.id} className="space-y-0.5">
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.2)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${d.score}%`,
                        background: d.score >= 80 ? "hsl(var(--kf-success))" : d.score >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error, 0 84% 60%))",
                      }}
                    />
                  </div>
                  <p className="text-[8px]" style={{ color: "hsl(var(--kf-muted-foreground)/0.5)" }}>{d.label}</p>
                </div>
              ))}
            </div>
          </div>
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex-shrink-0">
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-2" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.2)" }}>
                {allComplete ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="pt-3 flex items-start gap-3 px-3 py-3 rounded-xl"
                    style={{ background: "hsl(var(--kf-success)/0.08)", border: "1px solid hsl(var(--kf-success)/0.2)" }}
                  >
                    <PartyPopper className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-success))" }} />
                    <div>
                      <p className="text-sm font-bold" style={{ color: "hsl(var(--kf-success))" }}>All checks complete!</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Your store meets all readiness criteria. Share it with the world.</p>
                    </div>
                  </motion.div>
                ) : items.length === 0 ? (
                  <div className="pt-3 flex items-center justify-center py-6">
                    <p className="text-xs text-muted-foreground">Loading readiness checks...</p>
                  </div>
                ) : (
                  <div className="pt-2 space-y-1">
                    {([
                      ["blocker", blockers],
                      ["warning", warnings],
                      ["tip", tips],
                    ] as const).map(([sev, list]) => {
                      if (!list.length) return null;
                      const cfg = SEV_CONFIG[sev];
                      const SevIcon = cfg.icon;
                      return (
                        <div key={sev}>
                          <div className="flex items-center gap-1.5 mb-1 px-1">
                            <SevIcon className="w-3 h-3 flex-shrink-0" style={{ color: cfg.color }} />
                            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: cfg.color }}>
                              {cfg.label} ({list.length})
                            </span>
                          </div>
                          {list.map((item) => {
                            const isExpanded = expandedItem === item.id;
                            return (
                              <motion.div
                                key={item.id}
                                layout
                                className="rounded-xl overflow-hidden mb-1"
                                style={{ background: cfg.bg, border: `1px solid ${cfg.color}25` }}
                              >
                                <button
                                  type="button"
                                  onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                                  className="w-full flex items-start gap-3 px-3 py-2.5 text-left group"
                                >
                                  <SevIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: cfg.color }} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold leading-tight">{item.title}</p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
                                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                    </motion.div>
                                  </div>
                                </button>
                                <AnimatePresence initial={false}>
                                  {isExpanded && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.15 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="px-3 pb-3 pt-2" style={{ borderTop: `1px solid ${cfg.color}15` }}>
                                        <button
                                          type="button"
                                          onClick={() => onTabChange(item.resolveTab)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors min-h-[36px]"
                                          style={{ background: cfg.color, color: "white" }}
                                        >
                                          {item.resolveLabel}
                                          <ArrowRight className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}

                {storeUrl && (
                  <div className="pt-1 flex gap-2">
                    <a
                      href={`/book/${slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium min-h-[40px] transition-colors"
                      style={{ background: "hsl(var(--kf-accent1)/0.1)", color: "hsl(var(--kf-accent1))" }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Preview Store
                    </a>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(storeUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium min-h-[40px] transition-colors"
                      style={{ background: "hsl(var(--kf-muted)/0.12)", color: "hsl(var(--kf-foreground)/0.7)" }}
                    >
                      {copied ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
      >
        <button
          type="button"
          onClick={() => setShowPostLaunch(!showPostLaunch)}
          aria-expanded={showPostLaunch}
          className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-[hsl(var(--kf-muted)/0.05)] transition-colors"
        >
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-success)/0.1)" }}>
            <Rocket className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Post-Launch Playbook</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">What to do after going live to maximize momentum</p>
          </div>
          <motion.div animate={{ rotate: showPostLaunch ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </button>
        <AnimatePresence initial={false}>
          {showPostLaunch && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-1.5" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.2)" }}>
                {postLaunchSuggestions.map((s, i) => {
                  const Icon = s.icon;
                  return (
                    <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl" style={{ background: "hsl(var(--kf-muted)/0.04)", border: "1px solid hsl(var(--kf-border)/0.15)" }}>
                      <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold">{s.title}</p>
                        <p className="text-[10px] text-muted-foreground">{s.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
