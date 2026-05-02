"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  ChevronRight,
  DollarSign,
  Users,
  Calendar,
  Megaphone,
  CheckCircle2,
  TrendingUp,
  Zap,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { fetchAiNextActions, type AiNextAction } from "@/lib/client";

type CrossModuleAction = {
  id: string;
  module: "crm" | "commerce" | "bookings" | "marketing" | "expenses";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  type: "revenue" | "retention" | "efficiency" | "growth";
  link: string;
  estimatedValue?: string;
};

const MODULE_ICONS: Record<string, typeof Users> = {
  crm: Users,
  commerce: DollarSign,
  bookings: Calendar,
  marketing: Megaphone,
  expenses: TrendingUp,
};

const MODULE_COLORS: Record<string, string> = {
  crm: "--kf-accent2",
  commerce: "--kf-accent1",
  bookings: "--kf-info",
  marketing: "--kf-success",
  expenses: "--kf-warning",
};

const IMPACT_STYLES: Record<string, { bg: string; text: string }> = {
  high: { bg: "hsl(var(--kf-error) / 0.1)", text: "hsl(var(--kf-error))" },
  medium: { bg: "hsl(var(--kf-warning) / 0.1)", text: "hsl(var(--kf-warning))" },
  low: { bg: "hsl(var(--kf-info) / 0.1)", text: "hsl(var(--kf-info))" },
};

function deriveActions(aiActions: AiNextAction[]): CrossModuleAction[] {
  return aiActions.slice(0, 6).map((a, i) => {
    const moduleName = inferModule(a);
    const typeLabel = a.type.replace(/_/g, " ");
    return {
      id: `nba-${i}`,
      module: moduleName,
      title: `${typeLabel}: ${a.contactName}`,
      description: a.reason ?? "",
      impact: a.priority === "high" ? "high" : a.priority === "low" ? "low" : "medium",
      type: inferType(a),
      link: moduleLink(moduleName),
    };
  });
}

function inferModule(a: AiNextAction): CrossModuleAction["module"] {
  const text = `${a.type} ${a.reason} ${a.contactName}`.toLowerCase();
  if (text.includes("invoice") || text.includes("payment") || text.includes("revenue")) return "commerce";
  if (text.includes("booking") || text.includes("appointment") || text.includes("schedule")) return "bookings";
  if (text.includes("campaign") || text.includes("email") || text.includes("marketing")) return "marketing";
  if (text.includes("expense") || text.includes("spending") || text.includes("budget")) return "expenses";
  return "crm";
}

function inferType(a: AiNextAction): CrossModuleAction["type"] {
  const text = `${a.type} ${a.reason} ${a.contactName}`.toLowerCase();
  if (text.includes("revenue") || text.includes("upsell") || text.includes("invoice")) return "revenue";
  if (text.includes("churn") || text.includes("retain") || text.includes("follow")) return "retention";
  if (text.includes("growth") || text.includes("campaign") || text.includes("lead")) return "growth";
  return "efficiency";
}

function moduleLink(m: string): string {
  const links: Record<string, string> = {
    crm: "/app/crm",
    commerce: "/app/commerce",
    bookings: "/app/bookings",
    marketing: "/app/marketing",
    expenses: "/app/expenses",
  };
  return links[m] ?? "/app";
}

interface NextBestActionWidgetProps {
  businessId: string | null;
  compact?: boolean;
}

export function NextBestActionWidget({ businessId, compact = false }: NextBestActionWidgetProps) {
  const [actions, setActions] = useState<CrossModuleAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchAiNextActions(businessId);
      if (res.data) setActions(deriveActions(res.data));
    } catch {
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const dismiss = (id: string) => setDismissed((s) => new Set([...s, id]));
  const visible = actions.filter((a) => !dismissed.has(a.id));

  if (compact && visible.length === 0 && !loading) return null;

  return (
    <div className="kf-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
          >
            <Brain className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Next Best Actions</h3>
            {!compact && (
              <p className="text-[10px] text-muted-foreground">AI-recommended actions across your business</p>
            )}
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loading && visible.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-4">
          <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">All caught up! No immediate actions needed.</p>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-2">
            {visible.map((action) => {
              const ModuleIcon = MODULE_ICONS[action.module] ?? Zap;
              const impact = IMPACT_STYLES[action.impact];
              const colorVar = MODULE_COLORS[action.module] ?? "--kf-accent1";
              return (
                <motion.div
                  key={action.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20, height: 0 }}
                >
                  <Link
                    href={action.link}
                    className="group flex items-start gap-3 p-3 rounded-xl border border-border/40 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.3)] hover:bg-muted/10"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: `hsl(var(${colorVar}) / 0.1)` }}
                    >
                      <ModuleIcon className="w-4 h-4" style={{ color: `hsl(var(${colorVar}))` }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium truncate">{action.title}</span>
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                          style={{ background: impact.bg, color: impact.text }}
                        >
                          {action.impact}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{action.description}</p>
                      {action.estimatedValue && (
                        <p className="text-[10px] mt-1 font-medium" style={{ color: `hsl(var(${colorVar}))` }}>
                          Est. impact: {action.estimatedValue}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 mt-2">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(action.id); }}
                        className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground min-w-[44px] min-h-[44px] flex items-center justify-center"
                      >
                        ✕
                      </button>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
