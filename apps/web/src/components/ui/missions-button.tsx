"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  X,
  Trophy,
  Target,
  Rocket,
  Crown,
  Sparkles,
  ChevronDown,
  CheckCircle2,
  Flame,
  Star,
  UserPlus,
  FileText,
  ShoppingBag,
  CalendarCheck,
  Mail,
  Globe,
  Bot,
  CreditCard,
  BarChart3,
  Repeat,
  Users,
  Link2,
  Store,
} from "lucide-react";
import { fetchGamificationStats } from "@/lib/client";

interface Mission {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  xp: number;
  target: number;
  current: number;
  color: string;
}

interface MissionTier {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  missions: Mission[];
}

const NOW_MISSIONS: Omit<Mission, "current">[] = [
  { id: "add-first-contact", title: "First Contact", description: "Add your first contact to the CRM", icon: UserPlus, xp: 10, target: 1, color: "hsl(var(--kf-accent1))" },
  { id: "complete-profile", title: "Complete Profile", description: "Fill in your business info in Settings", icon: Star, xp: 15, target: 1, color: "hsl(45 90% 55%)" },
  { id: "first-product", title: "List Something", description: "Add your first product or service", icon: ShoppingBag, xp: 15, target: 1, color: "hsl(var(--kf-accent2))" },
  { id: "connect-calendar", title: "Calendar Sync", description: "Connect Google Calendar", icon: CalendarCheck, xp: 20, target: 1, color: "hsl(200 70% 50%)" },
  { id: "first-invoice", title: "First Invoice", description: "Create your first invoice", icon: FileText, xp: 25, target: 1, color: "hsl(150 60% 45%)" },
];

const SHORT_TERM_MISSIONS: Omit<Mission, "current">[] = [
  { id: "ten-contacts", title: "Growing Network", description: "Add 10 contacts to your CRM", icon: Users, xp: 50, target: 10, color: "hsl(var(--kf-accent1))" },
  { id: "first-sale", title: "First Sale", description: "Get your first invoice paid", icon: CreditCard, xp: 75, target: 1, color: "hsl(150 60% 45%)" },
  { id: "five-bookings", title: "Booking Streak", description: "Complete 5 bookings", icon: CalendarCheck, xp: 75, target: 5, color: "hsl(200 70% 50%)" },
  { id: "send-campaign", title: "Marketer", description: "Send your first email campaign", icon: Mail, xp: 50, target: 1, color: "hsl(270 60% 55%)" },
  { id: "week-streak", title: "7-Day Streak", description: "Log in for 7 consecutive days", icon: Flame, xp: 100, target: 7, color: "hsl(15 90% 55%)" },
];

const MEDIUM_TERM_MISSIONS: Omit<Mission, "current">[] = [
  { id: "fifty-contacts", title: "Community Builder", description: "Reach 50 contacts", icon: Users, xp: 150, target: 50, color: "hsl(var(--kf-accent2))" },
  { id: "ten-sales", title: "Sales Engine", description: "Complete 10 paid invoices", icon: CreditCard, xp: 200, target: 10, color: "hsl(150 60% 45%)" },
  { id: "recurring-setup", title: "Autopilot Revenue", description: "Set up a recurring invoice", icon: Repeat, xp: 150, target: 1, color: "hsl(200 70% 50%)" },
  { id: "twenty-bookings", title: "Fully Booked", description: "Complete 20 bookings", icon: CalendarCheck, xp: 200, target: 20, color: "hsl(45 90% 55%)" },
  { id: "month-streak", title: "30-Day Streak", description: "Log in for 30 consecutive days", icon: Flame, xp: 300, target: 30, color: "hsl(15 90% 55%)" },
];

const LONG_TERM_MISSIONS: Omit<Mission, "current">[] = [
  { id: "five-hundred-contacts", title: "Network Giant", description: "Reach 500 contacts", icon: Globe, xp: 500, target: 500, color: "hsl(var(--kf-accent1))" },
  { id: "hundred-sales", title: "Sales Master", description: "Complete 100 paid invoices", icon: Trophy, xp: 1000, target: 100, color: "hsl(45 90% 55%)" },
  { id: "hundred-bookings", title: "Booking Empire", description: "Complete 100 bookings", icon: CalendarCheck, xp: 750, target: 100, color: "hsl(200 70% 50%)" },
  { id: "ninety-streak", title: "90-Day Streak", description: "Log in for 90 consecutive days", icon: Flame, xp: 1000, target: 90, color: "hsl(15 90% 55%)" },
  { id: "reports-mastery", title: "Data Driven", description: "Generate 25 AI reports", icon: BarChart3, xp: 500, target: 25, color: "hsl(270 60% 55%)" },
];

const SPECIAL_MISSIONS: Omit<Mission, "current">[] = [
  { id: "connect-all", title: "Fully Connected", description: "Connect all available integrations", icon: Link2, xp: 300, target: 5, color: "hsl(270 60% 55%)" },
  { id: "ai-advisor", title: "AI Whisperer", description: "Use the AI advisor 10 times", icon: Bot, xp: 200, target: 10, color: "hsl(var(--kf-accent2))" },
  { id: "store-order", title: "Open for Business", description: "Publish your store & get your first order", icon: Store, xp: 250, target: 1, color: "hsl(150 60% 45%)" },
  { id: "marketplace-listing", title: "Going Global", description: "List a product on the marketplace", icon: Globe, xp: 300, target: 1, color: "hsl(var(--kf-accent1))" },
  { id: "masterclass", title: "Scholar", description: "Complete a MasterClass course", icon: Star, xp: 500, target: 1, color: "hsl(45 90% 55%)" },
];

function mapAchievementToMission(
  missionId: string,
  achievements: { id: string; achieved: boolean }[],
  challenges: { id: string; progress: number; target: number }[],
  streakDays: number,
  _totalXp: number,
): number {
  const ach = achievements.find((a) => a.id === missionId);
  if (ach) return ach.achieved ? 1 : 0;

  const ch = challenges.find((c) => c.id === missionId);
  if (ch) return ch.progress;

  if (missionId === "complete-profile") {
    const a = achievements.find((x) => x.id === "profile-complete");
    return a?.achieved ? 1 : 0;
  }
  if (missionId === "connect-calendar") {
    const a = achievements.find((x) => x.id === "calendar-connected");
    return a?.achieved ? 1 : 0;
  }
  if (missionId === "add-first-contact") {
    const a = achievements.find((x) => x.id === "first-contact");
    return a?.achieved ? 1 : 0;
  }
  if (missionId === "first-product") {
    const a = achievements.find((x) => x.id === "first-product");
    return a?.achieved ? 1 : 0;
  }
  if (missionId === "first-invoice") {
    const a = achievements.find((x) => x.id === "first-invoice");
    return a?.achieved ? 1 : 0;
  }
  if (missionId === "first-sale") {
    const a = achievements.find((x) => x.id === "first-sale");
    return a?.achieved ? 1 : 0;
  }
  if (missionId === "ten-contacts") {
    const has10 = achievements.find((x) => x.id === "ten-contacts")?.achieved;
    if (has10) return 10;
    const has1 = achievements.find((x) => x.id === "first-contact")?.achieved;
    return has1 ? 1 : 0;
  }
  if (missionId === "fifty-contacts") {
    const has100 = achievements.find((x) => x.id === "hundred-contacts")?.achieved;
    if (has100) return 50;
    const has10 = achievements.find((x) => x.id === "ten-contacts")?.achieved;
    return has10 ? 10 : 0;
  }
  if (missionId === "five-hundred-contacts") {
    const has100 = achievements.find((x) => x.id === "hundred-contacts")?.achieved;
    return has100 ? 100 : 0;
  }
  if (missionId === "ten-sales") {
    const has5 = achievements.find((x) => x.id === "five-sales")?.achieved;
    if (has5) return 5;
    const has1 = achievements.find((x) => x.id === "first-sale")?.achieved;
    return has1 ? 1 : 0;
  }
  if (missionId === "hundred-sales") {
    const has25 = achievements.find((x) => x.id === "twenty-five-sales")?.achieved;
    if (has25) return 25;
    const has5 = achievements.find((x) => x.id === "five-sales")?.achieved;
    return has5 ? 5 : 0;
  }
  if (missionId === "week-streak") return Math.min(streakDays, 7);
  if (missionId === "month-streak") return Math.min(streakDays, 30);
  if (missionId === "ninety-streak") return Math.min(streakDays, 90);

  return 0;
}

function buildTier(
  id: string,
  label: string,
  icon: React.ElementType,
  color: string,
  bgColor: string,
  defs: Omit<Mission, "current">[],
  achievements: { id: string; achieved: boolean }[],
  challenges: { id: string; progress: number; target: number }[],
  streakDays: number,
  totalXp: number,
): MissionTier {
  return {
    id,
    label,
    icon,
    color,
    bgColor,
    missions: defs.map((d) => ({
      ...d,
      current: Math.min(
        mapAchievementToMission(d.id, achievements, challenges, streakDays, totalXp),
        d.target,
      ),
    })),
  };
}

export function MissionsButton() {
  const [open, setOpen] = useState(false);
  const [expandedTier, setExpandedTier] = useState<string | null>("now");
  const [stats, setStats] = useState<{
    level: number;
    totalXp: number;
    currentXp: number;
    xpToNextLevel: number;
    streakDays: number;
    achievements: { id: string; achieved: boolean }[];
    challenges: { id: string; progress: number; target: number }[];
  } | null>(null);

  useEffect(() => {
    fetchGamificationStats()
      .then((result) => {
        if (result && result.data) setStats(result.data as NonNullable<typeof stats>);
      })
      .catch(() => {});
  }, []);

  const tiers = useMemo(() => {
    const a = stats?.achievements ?? [];
    const c = stats?.challenges ?? [];
    const s = stats?.streakDays ?? 0;
    const x = stats?.totalXp ?? 0;
    return [
      buildTier("now", "Now", Zap, "hsl(45 90% 55%)", "bg-amber-400/10", NOW_MISSIONS, a, c, s, x),
      buildTier("short", "Short Term", Target, "hsl(var(--kf-accent1))", "bg-[hsl(var(--kf-accent1))]/10", SHORT_TERM_MISSIONS, a, c, s, x),
      buildTier("medium", "Medium Term", Rocket, "hsl(var(--kf-accent2))", "bg-[hsl(var(--kf-accent2))]/10", MEDIUM_TERM_MISSIONS, a, c, s, x),
      buildTier("long", "Long Term", Crown, "hsl(270 60% 55%)", "bg-purple-400/10", LONG_TERM_MISSIONS, a, c, s, x),
      buildTier("special", "Special Missions", Sparkles, "hsl(200 70% 50%)", "bg-sky-400/10", SPECIAL_MISSIONS, a, c, s, x),
    ];
  }, [stats]);

  const totalMissions = tiers.reduce((s, t) => s + t.missions.length, 0);
  const completedMissions = tiers.reduce(
    (s, t) => s + t.missions.filter((m) => m.current >= m.target).length,
    0,
  );
  const overallProgress = totalMissions > 0 ? Math.round((completedMissions / totalMissions) * 100) : 0;
  const level = stats?.level ?? 1;
  const totalXp = stats?.totalXp ?? 0;
  const streakDays = stats?.streakDays ?? 0;
  const xpToNext = stats?.xpToNextLevel ?? 500;
  const currentXp = stats?.currentXp ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
          open
            ? "bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white shadow-md shadow-[hsl(var(--kf-accent1))]/40 scale-110"
            : "bg-gradient-to-br from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent2))]/25 hover:shadow-sm hover:shadow-[hsl(var(--kf-accent1))]/20 hover:scale-105"
        }`}
        aria-label="Missions & XP"
        title={`Level ${level} · ${totalXp} XP · ${completedMissions}/${totalMissions} missions`}
      >
        <Zap className="w-3.5 h-3.5" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[360px] max-h-[80vh] overflow-y-auto"
              role="dialog"
              aria-modal="true"
              aria-label="Missions"
            >
              <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-md border-b border-border/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20">
                      <Trophy className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold">Missions</h3>
                      <p className="text-[11px] text-muted-foreground">Level {level} · {totalXp} XP</p>
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

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-center p-2 rounded-xl bg-muted/30">
                    <span className="text-sm font-semibold block">{completedMissions}/{totalMissions}</span>
                    <span className="text-[10px] text-muted-foreground">Missions</span>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-muted/30">
                    <div className="flex items-center justify-center gap-0.5">
                      <Flame className="w-3 h-3 text-orange-400" />
                      <span className="text-sm font-semibold">{streakDays}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">Day Streak</span>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-muted/30">
                    <span className="text-sm font-semibold block">{currentXp}/{xpToNext}</span>
                    <span className="text-[10px] text-muted-foreground">Next Level</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-muted-foreground">Overall Progress</span>
                    <span className="font-semibold">{overallProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${overallProgress}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                    />
                  </div>
                </div>
              </div>

              <div className="p-3 space-y-1.5">
                {tiers.map((tier) => {
                  const TierIcon = tier.icon;
                  const tierCompleted = tier.missions.filter((m) => m.current >= m.target).length;
                  const isExpanded = expandedTier === tier.id;
                  return (
                    <div key={tier.id}>
                      <button
                        onClick={() => setExpandedTier(isExpanded ? null : tier.id)}
                        className="w-full flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-muted/30 transition-colors"
                      >
                        <div className={`p-1.5 rounded-lg ${tier.bgColor}`}>
                          <TierIcon className="w-3.5 h-3.5" style={{ color: tier.color }} />
                        </div>
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold">{tier.label}</span>
                            <span className="text-[10px] text-muted-foreground">{tierCompleted}/{tier.missions.length}</span>
                          </div>
                          <div className="h-1 bg-muted rounded-full overflow-hidden mt-1 w-full">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${tier.missions.length > 0 ? (tierCompleted / tier.missions.length) * 100 : 0}%`,
                                backgroundColor: tier.color,
                              }}
                            />
                          </div>
                        </div>
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div className="pl-2 pr-1 pb-2 space-y-1.5">
                              {tier.missions.map((m) => {
                                const done = m.current >= m.target;
                                const progress = Math.min((m.current / m.target) * 100, 100);
                                const MIcon = m.icon;
                                return (
                                  <div
                                    key={m.id}
                                    className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all ${
                                      done
                                        ? "border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/5"
                                        : "border-border/30 bg-muted/5"
                                    }`}
                                  >
                                    <div className={`p-1 rounded-lg flex-shrink-0 ${done ? "bg-[hsl(var(--kf-accent1))]/15" : "bg-muted/30"}`}>
                                      {done ? (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                      ) : (
                                        <MIcon className="w-3.5 h-3.5" style={{ color: m.color }} />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between mb-0.5">
                                        <span className={`text-[11px] font-medium ${done ? "line-through text-muted-foreground" : ""}`}>
                                          {m.title}
                                        </span>
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                          done
                                            ? "bg-emerald-400/20 text-emerald-400"
                                            : "bg-muted/40 text-muted-foreground"
                                        }`}>
                                          +{m.xp} XP
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-muted-foreground leading-tight">{m.description}</p>
                                      {!done && m.target > 1 && (
                                        <div className="flex items-center gap-1.5 mt-1">
                                          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                            <div
                                              className="h-full rounded-full transition-all duration-500"
                                              style={{ width: `${progress}%`, backgroundColor: m.color }}
                                            />
                                          </div>
                                          <span className="text-[9px] text-muted-foreground flex-shrink-0">{m.current}/{m.target}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
