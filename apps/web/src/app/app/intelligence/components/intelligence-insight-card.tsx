"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Lightbulb,
  Shield,
  Briefcase,
  Clock,
  Dna,
  Users,
  Banknote,
  ArrowRight,
  Zap,
} from "lucide-react";
import type { BusinessIntelligenceInsight, IntelligenceDomain, IntelligencePriority } from "@/lib/api/intelligence";

const DOMAIN_CONFIG: Record<
  IntelligenceDomain,
  { label: string; icon: React.ElementType; color: string; bg: string }
> = {
  EXECUTIVE: { label: "Executive", icon: Brain, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.08)" },
  REVENUE: { label: "Revenue", icon: TrendingUp, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.08)" },
  FINANCE: { label: "Finance", icon: Banknote, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.08)" },
  MARKETING: { label: "Marketing", icon: Zap, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.08)" },
  SALES: { label: "Sales", icon: TrendingUp, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.08)" },
  OPERATIONS: { label: "Operations", icon: Clock, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.08)" },
  CLIENTS: { label: "Clients", icon: Users, color: "hsl(var(--kf-violet-accent))", bg: "hsl(var(--kf-violet-accent) / 0.08)" },
  RISK: { label: "Risk", icon: AlertTriangle, color: "hsl(var(--kf-destructive))", bg: "hsl(var(--kf-destructive) / 0.08)" },
  GENOME: { label: "Genome", icon: Dna, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.08)" },
  ASSETS: { label: "Assets", icon: Briefcase, color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.08)" },
  TEMPORAL_FLOW: { label: "Temporal Flow", icon: Clock, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.08)" },
};

const PRIORITY_CONFIG: Record<
  IntelligencePriority,
  { label: string; color: string; bg: string }
> = {
  CRITICAL: { label: "Critical", color: "hsl(var(--kf-destructive))", bg: "hsl(var(--kf-destructive) / 0.08)" },
  HIGH: { label: "High", color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.08)" },
  MEDIUM: { label: "Medium", color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.08)" },
  LOW: { label: "Low", color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.08)" },
};

interface IntelligenceInsightCardProps {
  insight: BusinessIntelligenceInsight;
  index?: number;
  compact?: boolean;
}

export function IntelligenceInsightCard({ insight, index = 0, compact = false }: IntelligenceInsightCardProps) {
  const router = useRouter();
  const domain = DOMAIN_CONFIG[insight.domain];
  const priority = PRIORITY_CONFIG[insight.priority];
  const DomainIcon = domain.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="rounded-xl border p-4 transition-all hover:shadow-sm"
      style={{
        borderColor: "hsl(var(--kf-border) / 0.3)",
        background: "hsl(var(--kf-card) / 0.6)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: domain.bg }}
        >
          <DomainIcon className="w-4 h-4" style={{ color: domain.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <h3 className={`font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}>{insight.title}</h3>
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
              style={{ color: priority.color, background: priority.bg }}
            >
              {priority.label}
            </span>
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
              style={{ color: domain.color, background: domain.bg }}
            >
              {domain.label}
            </span>
          </div>
          <p className={`text-muted-foreground leading-relaxed mb-2 ${compact ? "text-[11px]" : "text-xs"}`}>
            {insight.finding}
          </p>
          {insight.evidence.length > 0 && (
            <ul className="space-y-1 mb-3">
              {insight.evidence.slice(0, 3).map((item, i) => (
                <li key={i} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                  <span className="mt-1 w-1 h-1 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                  <span className="line-clamp-2">{item}</span>
                </li>
              ))}
            </ul>
          )}
          {insight.recommendedAction?.href && (
            <button
              onClick={() => router.push(insight.recommendedAction!.href!)}
              className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
              style={{ color: "hsl(var(--kf-accent1))" }}
            >
              {insight.recommendedAction.label}
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
