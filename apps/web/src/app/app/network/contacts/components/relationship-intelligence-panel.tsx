"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Users,
  TrendingUp,
  AlertTriangle,
  Zap,
  Sparkles,
  Heart,
  MessageSquare,
  Clock,
  Target,
  ArrowRight,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface RelationshipInsight {
  id: string;
  type: "opportunity" | "risk" | "pattern" | "action";
  title: string;
  description: string;
  contactCount?: number;
  impact: string;
  actionRoute?: string;
}

interface SegmentHealth {
  segment: string;
  count: number;
  health: number;
  trend: number;
  avgValue: string;
}

export function RelationshipIntelligencePanel() {
  const router = useRouter();

  const insights: RelationshipInsight[] = useMemo(() => [
    { id: "1", type: "risk", title: "Churn Risk Detected", description: "12 high-value contacts haven't engaged in 60+ days. 3 show strong churn signals.", contactCount: 12, impact: "-$4,200 MRR", actionRoute: "/app/network/contacts" },
    { id: "2", type: "opportunity", title: "Upsell Window", description: "8 clients are ready for Service B based on usage patterns. Expected value: $1,600.", contactCount: 8, impact: "+$1,600", actionRoute: "/app/network/contacts" },
    { id: "3", type: "pattern", title: "Referral Source", description: "Your top 5 clients referred 18 new contacts. Consider a formal referral program.", contactCount: 18, impact: "+18 leads", actionRoute: "/app/network/contacts" },
    { id: "4", type: "action", title: "Follow-up Queue", description: "7 contacts need follow-up today. 2 are high-priority based on deal stage.", contactCount: 7, impact: "Today", actionRoute: "/app/network/contacts" },
  ], []);

  const segments: SegmentHealth[] = useMemo(() => [
    { segment: "VIP Clients", count: 24, health: 92, trend: 5, avgValue: "$2,400" },
    { segment: "Active Prospects", count: 47, health: 76, trend: 12, avgValue: "$890" },
    { segment: "At Risk", count: 12, health: 34, trend: -8, avgValue: "$1,200" },
    { segment: "New Leads", count: 89, health: 68, trend: 24, avgValue: "$0" },
    { segment: "Dormant", count: 156, health: 22, trend: -3, avgValue: "$340" },
  ], []);

  return (
    <div className="space-y-4">
      {/* Segment Health */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          Segment Health
        </h3>
        <div className="space-y-3">
          {segments.map((seg, i) => (
            <motion.div
              key={seg.segment}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{seg.segment}</span>
                  <span className="text-[10px] text-muted-foreground">({seg.count})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium ${seg.trend >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    {seg.trend >= 0 ? "+" : ""}{seg.trend}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">{seg.avgValue}</span>
                </div>
              </div>
              <div className="w-full h-1.5 rounded-full bg-muted/20 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${seg.health}%` }}
                  transition={{ delay: i * 0.1 + 0.2, duration: 0.6, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{
                    backgroundColor: seg.health >= 70 ? "#10b981" : seg.health >= 40 ? "#f59e0b" : "#ef4444",
                  }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Insights */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Relationship Intelligence
          </h3>
        </div>
        <div className="space-y-2">
          {insights.map((insight, i) => {
            const config = {
              opportunity: { bg: "bg-emerald-500/5", border: "border-emerald-500/20", icon: Zap },
              risk: { bg: "bg-rose-500/5", border: "border-rose-500/20", icon: AlertTriangle },
              pattern: { bg: "bg-amber-500/5", border: "border-amber-500/20", icon: TrendingUp },
              action: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: Target },
            }[insight.type];
            const Icon = config.icon;
            return (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
                className={`rounded-xl border ${config.border} ${config.bg} p-3.5 cursor-pointer hover:shadow-md transition-all`}
                onClick={() => insight.actionRoute && router.push(insight.actionRoute)}
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold text-foreground">{insight.title}</span>
                      {insight.contactCount && (
                        <span className="text-[10px] text-muted-foreground shrink-0">{insight.contactCount} contacts</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">{insight.impact}</span>
                      {insight.actionRoute && (
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Quick Stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Heart className="w-4 h-4 text-rose-500" />
          Connection Health
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Avg. Response Time", value: "4.2 hrs", icon: Clock },
            { label: "Engagement Rate", value: "68%", icon: MessageSquare },
            { label: "NPS Score", value: "72", icon: TrendingUp },
            { label: "Relationships", value: "1,247", icon: Users },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-card/40 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <stat.icon className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{stat.label}</span>
              </div>
              <div className="text-sm font-bold">{stat.value}</div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
