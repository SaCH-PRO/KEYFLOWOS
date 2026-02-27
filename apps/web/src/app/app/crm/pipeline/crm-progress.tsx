"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  UserPlus,
  Users,
  Globe,
  Target,
  Zap,
  Trophy,
  Star,
  TrendingUp,
  MessageCircle,
  ArrowRight,
} from "lucide-react";

interface CrmMilestone {
  id: string;
  title: string;
  description: string;
  icon: typeof UserPlus;
  target: number;
  current: number;
  xp: number;
  color: string;
}

interface CrmProgressProps {
  totalContacts: number;
  leads: number;
  prospects: number;
  clients: number;
  listsCount?: number;
  broadcastsSent?: number;
}

const STATUS_COLORS: Record<string, string> = {
  LEAD: "hsl(var(--kf-accent1))",
  PROSPECT: "hsl(200 70% 50%)",
  CLIENT: "hsl(150 60% 40%)",
};

export function CrmProgress({
  totalContacts,
  leads,
  prospects,
  clients,
  listsCount = 0,
  broadcastsSent = 0,
}: CrmProgressProps) {
  const milestones: CrmMilestone[] = useMemo(() => [
    { id: "first-5", title: "Getting Started", description: "Add 5 contacts", icon: UserPlus, target: 5, current: Math.min(totalContacts, 5), xp: 25, color: "hsl(var(--kf-accent1))" },
    { id: "first-25", title: "Building Network", description: "Reach 25 contacts", icon: Users, target: 25, current: Math.min(totalContacts, 25), xp: 75, color: "hsl(var(--kf-accent2))" },
    { id: "first-100", title: "Community Builder", description: "Reach 100 contacts", icon: Globe, target: 100, current: Math.min(totalContacts, 100), xp: 250, color: "hsl(200 70% 50%)" },
    { id: "first-client", title: "First Client", description: "Convert a lead to client", icon: Trophy, target: 1, current: Math.min(clients, 1), xp: 100, color: "hsl(150 60% 40%)" },
    { id: "five-clients", title: "Client Magnet", description: "Get 5 clients", icon: Star, target: 5, current: Math.min(clients, 5), xp: 200, color: "hsl(45 90% 55%)" },
    { id: "first-list", title: "Organized Pro", description: "Create a contact list", icon: Target, target: 1, current: Math.min(listsCount, 1), xp: 50, color: "hsl(270 60% 55%)" },
  ], [totalContacts, clients, listsCount]);

  const completedCount = milestones.filter((m) => m.current >= m.target).length;
  const totalXp = milestones.filter((m) => m.current >= m.target).reduce((sum, m) => sum + m.xp, 0);
  const overallProgress = milestones.length > 0 ? Math.round((completedCount / milestones.length) * 100) : 0;

  const conversionRate = totalContacts > 0 ? Math.round((clients / totalContacts) * 100) : 0;
  const pipelineHealth = totalContacts > 0 ? Math.round(((leads + prospects) / totalContacts) * 100) : 0;

  return (
    <div className="kf-card overflow-hidden">
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10">
              <Zap className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">CRM Momentum</h3>
              <p className="text-xs text-muted-foreground">{completedCount}/{milestones.length} milestones</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>{totalXp}</span>
              <span className="text-xs text-muted-foreground ml-1">XP</span>
            </div>
          </div>
        </div>

        <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-0.5">Pipeline</div>
            <div className="flex items-center justify-center gap-1">
              <TrendingUp className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-sm font-semibold">{pipelineHealth}%</span>
            </div>
            <div className="text-[10px] text-muted-foreground">active leads</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-0.5">Conversion</div>
            <div className="flex items-center justify-center gap-1">
              <ArrowRight className="w-3 h-3" style={{ color: "hsl(150 60% 40%)" }} />
              <span className="text-sm font-semibold">{conversionRate}%</span>
            </div>
            <div className="text-[10px] text-muted-foreground">to client</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-0.5">Reach</div>
            <div className="flex items-center justify-center gap-1">
              <MessageCircle className="w-3 h-3" style={{ color: "hsl(200 70% 50%)" }} />
              <span className="text-sm font-semibold">{broadcastsSent}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">broadcasts</div>
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {milestones.map((m, i) => {
            const done = m.current >= m.target;
            const progress = Math.min((m.current / m.target) * 100, 100);
            const Icon = m.icon;
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex-shrink-0 w-[120px] p-3 rounded-xl border transition-all ${
                  done
                    ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/5"
                    : "border-border/50 bg-muted/20 hover:border-border"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <div
                    className={`p-1 rounded-md ${done ? "bg-[hsl(var(--kf-accent1))]/20" : "bg-muted/50"}`}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: done ? m.color : "hsl(var(--kf-muted-foreground))" }} />
                  </div>
                  {done && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))]">
                      +{m.xp}
                    </span>
                  )}
                </div>
                <p className={`text-xs font-medium mb-0.5 ${done ? "" : "text-muted-foreground"}`}>{m.title}</p>
                <p className="text-[10px] text-muted-foreground mb-2">{m.description}</p>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${progress}%`, backgroundColor: done ? m.color : "hsl(var(--kf-muted-foreground))" }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{m.current}/{m.target}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
