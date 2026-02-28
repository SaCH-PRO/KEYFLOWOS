"use client";

import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  X,
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

const STORAGE_KEY = "kf_crm_momentum_expanded";

export function CrmProgress({
  totalContacts,
  leads,
  prospects,
  clients,
  listsCount = 0,
  broadcastsSent = 0,
}: CrmProgressProps) {
  const [open, setOpen] = useState(false);

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
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 group"
        aria-label="Open CRM Momentum missions"
      >
        <div className="relative p-3 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] shadow-lg shadow-[hsl(var(--kf-accent1))]/25 hover:shadow-xl hover:shadow-[hsl(var(--kf-accent1))]/40 hover:scale-110 transition-all duration-200">
          <Zap className="w-5 h-5 text-white" />
          {completedCount > 0 && completedCount < milestones.length && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white text-[10px] font-bold text-[hsl(var(--kf-accent1))] flex items-center justify-center shadow-sm">
              {completedCount}
            </span>
          )}
          {completedCount === milestones.length && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-400 text-[10px] flex items-center justify-center shadow-sm">
              <Star className="w-3 h-3 text-white" />
            </span>
          )}
        </div>
        <div className="absolute bottom-full right-0 mb-2 px-2.5 py-1 rounded-lg bg-card border border-border text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
          {totalXp} XP · {completedCount}/{milestones.length} missions
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="fixed bottom-20 right-6 z-50 w-[340px] max-h-[70vh] overflow-y-auto kf-card border border-border shadow-2xl rounded-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="CRM Momentum"
            >
              <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-md border-b border-border/30 p-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20">
                    <Zap className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">CRM Momentum</h3>
                    <p className="text-[11px] text-muted-foreground">{totalXp} XP earned</p>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">Overall Progress</span>
                    <span className="font-semibold">{overallProgress}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${overallProgress}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 rounded-xl bg-muted/30">
                    <TrendingUp className="w-3.5 h-3.5 mx-auto mb-0.5" style={{ color: "hsl(var(--kf-accent2))" }} />
                    <span className="text-sm font-semibold block">{pipelineHealth}%</span>
                    <span className="text-[10px] text-muted-foreground">Pipeline</span>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-muted/30">
                    <ArrowRight className="w-3.5 h-3.5 mx-auto mb-0.5" style={{ color: "hsl(150 60% 40%)" }} />
                    <span className="text-sm font-semibold block">{conversionRate}%</span>
                    <span className="text-[10px] text-muted-foreground">Conversion</span>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-muted/30">
                    <MessageCircle className="w-3.5 h-3.5 mx-auto mb-0.5" style={{ color: "hsl(200 70% 50%)" }} />
                    <span className="text-sm font-semibold block">{broadcastsSent}</span>
                    <span className="text-[10px] text-muted-foreground">Reach</span>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Missions</h4>
                  <div className="space-y-2">
                    {milestones.map((m, i) => {
                      const done = m.current >= m.target;
                      const progress = Math.min((m.current / m.target) * 100, 100);
                      const Icon = m.icon;
                      return (
                        <motion.div
                          key={m.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                            done
                              ? "border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/5"
                              : "border-border/40 bg-muted/10"
                          }`}
                        >
                          <div
                            className={`p-1.5 rounded-lg flex-shrink-0 ${done ? "bg-[hsl(var(--kf-accent1))]/15" : "bg-muted/40"}`}
                          >
                            <Icon className="w-3.5 h-3.5" style={{ color: done ? m.color : "hsl(var(--kf-muted-foreground))" }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className={`text-xs font-medium ${done ? "" : "text-muted-foreground"}`}>{m.title}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                done
                                  ? "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))]"
                                  : "bg-muted/40 text-muted-foreground"
                              }`}>
                                +{m.xp} XP
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mb-1">{m.description}</p>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${progress}%`, backgroundColor: done ? m.color : "hsl(var(--kf-muted-foreground))" }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground flex-shrink-0">{m.current}/{m.target}</span>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
