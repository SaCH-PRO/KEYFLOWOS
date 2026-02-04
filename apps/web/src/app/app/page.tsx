"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { AchievementsStrip } from "@/components/cockpit/achievements-strip";
import { FlowFeedPanel, FeedItem } from "@/components/cockpit/flow-feed-panel";
import { FlowGraphPanel, Phase } from "@/components/cockpit/flow-graph-panel";
import { FlowStatsRow } from "@/components/cockpit/flow-stats-row";
import { 
  fetchCockpitSummary, 
  fetchGamificationStats, 
  CockpitSummary, 
  GamificationStats,
  updateStreak 
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { apiPost } from "@/lib/api";
import { 
  Sparkles, 
  FileText, 
  Zap, 
  TrendingUp, 
  Users, 
  Calendar,
  AlertTriangle,
  Package,
  UserPlus,
  Send,
  ChevronRight,
  Trophy,
  Flame
} from "lucide-react";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Package,
  UserPlus,
  Send,
  AlertTriangle,
  TrendingUp,
  Zap,
  Calendar,
  Trophy,
};

export default function AppHome() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [cockpit, setCockpit] = useState<CockpitSummary | null>(null);
  const [gamification, setGamification] = useState<GamificationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) {
        setBusinessId(fresh);
        return;
      }
      const stored = getStoredBusinessId();
      if (stored) {
        setBusinessId(stored);
      }
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [cockpitResult, gamificationResult] = await Promise.all([
          fetchCockpitSummary(businessId),
          fetchGamificationStats(businessId),
        ]);

        if (cockpitResult.error) {
          console.error("Cockpit fetch error:", cockpitResult.error);
        }
        if (gamificationResult.error) {
          console.error("Gamification fetch error:", gamificationResult.error);
        }

        if (cockpitResult.data) {
          setCockpit(cockpitResult.data);
        }
        if (gamificationResult.data) {
          setGamification(gamificationResult.data);
        }

        if (!cockpitResult.data && !gamificationResult.data) {
          setError("Unable to load dashboard data. Please try again.");
        }

        void updateStreak(businessId);
      } catch (err) {
        console.error("Dashboard load error:", err);
        setError("Failed to load dashboard. Please refresh the page.");
      }
      setLoading(false);
    };
    void load();

    if (typeof window !== "undefined") {
      const handler = () => void load();
      window.addEventListener("kf:invoicePaid", handler);
      window.addEventListener("kf:bookingCreated", handler);
      return () => {
        window.removeEventListener("kf:invoicePaid", handler);
        window.removeEventListener("kf:bookingCreated", handler);
      };
    }
  }, [businessId]);

  const stats = useMemo(() => {
    if (!cockpit) return { mrr: "TTD --", conversionRate: "--", avgResponseTime: "--" };
    const { stats: s } = cockpit;
    return {
      mrr: `TTD ${s.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      conversionRate: s.totalContacts > 0 
        ? `${Math.round((s.totalContacts - s.activeLeads) / s.totalContacts * 100)}%`
        : "0%",
      avgResponseTime: `${s.weeklyBookings} bookings/wk`,
    };
  }, [cockpit]);

  const phases: Phase[] = useMemo(() => {
    if (!cockpit) return [];
    return cockpit.phases.map(p => ({ label: p.name, value: p.count }));
  }, [cockpit]);

  const bottleneck = cockpit?.bottleneck?.phase ?? "Leads";

  const feedItems: FeedItem[] = useMemo(() => {
    if (!cockpit) return [];
    return cockpit.feed.map(f => {
      let type: FeedItem["type"] = "message";
      if (f.tone === "success") type = "payment";
      else if (f.actionType === "booking") type = "booking";
      else if (f.actionType === "event") type = "automation";
      
      return {
        type,
        title: f.text.split(" — ")[0] || f.text,
        time: f.timestamp,
        description: f.text.split(" — ")[1] || "",
        suggestion: f.actionType === "invoice" ? "View invoice" : undefined,
        meta: f.actionId ? { invoiceId: f.actionId } : undefined,
      };
    });
  }, [cockpit]);

  const achievedCount = gamification?.achievements.filter(a => a.achieved).length ?? 0;
  const totalAchievements = gamification?.achievements.length ?? 0;

  return (
    <div className="space-y-6">
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500"
        >
          {error}
        </motion.div>
      )}
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Welcome back
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's what's happening with your business today
          </p>
        </div>
        <div className="flex items-center gap-3">
          {gamification && (
            <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20">
              <Trophy className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-medium">Level {gamification.level}</span>
              <span className="text-xs text-muted-foreground">
                {gamification.currentXp}/{gamification.currentXp + gamification.xpToNextLevel} XP
              </span>
            </div>
          )}
          {gamification && gamification.streakDays > 0 && (
            <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20">
              <Flame className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-medium">{gamification.streakDays} day streak</span>
            </div>
          )}
          <button
            className="kf-btn-primary inline-flex items-center gap-2"
            onClick={async () => {
              setAiLoading(true);
              const msg = await requestAiSuggestion({
                type: "automation",
                title: "Health Check",
                time: "now",
                description: "AI health check",
                suggestion: "Summarize health",
              });
              setAiSuggestion(msg);
              setAiLoading(false);
            }}
            disabled={aiLoading}
          >
            <Sparkles className="w-4 h-4" />
            {aiLoading ? "Analyzing..." : "AI Health Check"}
          </button>
        </div>
      </motion.div>

      <FlowStatsRow stats={stats} />
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="kf-card p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-sm font-medium">Momentum</span>
          </div>
          <span className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
            {Math.round((cockpit?.momentum ?? 0) * 100)}%
          </span>
        </div>
        <div className="kf-momentum-bar">
          <div className="kf-momentum-fill" style={{ width: `${(cockpit?.momentum ?? 0) * 100}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {cockpit?.bottleneck 
            ? cockpit.bottleneck.suggestion 
            : "Great work! Keep the momentum going."}
        </p>
      </motion.div>

      {cockpit?.quickActions && cockpit.quickActions.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="kf-card p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="text-sm font-medium">Quick Actions</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cockpit.quickActions.map(action => {
              const IconComponent = iconMap[action.icon] || Zap;
              return (
                <Link
                  key={action.id}
                  href={action.href}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border/60 hover:border-border hover:bg-muted/50 transition-all group"
                >
                  <div 
                    className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-orange-500/10"
                  >
                    <IconComponent className="w-5 h-5 text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{action.label}</div>
                    <div className="text-xs text-muted-foreground truncate">{action.description}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                </Link>
              );
            })}
          </div>
        </motion.div>
      )}

      {!loading && gamification && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <AchievementsStrip 
            achievements={gamification.achievements}
            level={gamification.level}
            currentXp={gamification.currentXp}
            xpToNextLevel={gamification.xpToNextLevel}
          />
        </motion.div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <FlowFeedPanel
          items={feedItems}
          onAsk={(item) => {
            void requestAiSuggestion(item).then((msg) => {
              setAiSuggestion(msg);
              setActionMessage(msg);
            });
          }}
          onAction={(item) => {
            if (item.meta?.invoiceId) {
              window.open(`/pay/${item.meta.invoiceId}`, "_blank");
            }
          }}
        />
        <div className="space-y-4">
          <FlowGraphPanel phases={phases} bottleneck={bottleneck} />
          {cockpit?.bottleneck && (
            <button
              className="w-full kf-btn-secondary inline-flex items-center justify-center gap-2"
              onClick={async () => {
                setAiLoading(true);
                const msg = await requestAiSuggestion({
                  type: "automation",
                  title: "Fix bottleneck",
                  time: "now",
                  description: cockpit.bottleneck?.phase ?? "",
                  suggestion: cockpit.bottleneck?.suggestion ?? "",
                });
                setAiSuggestion(msg);
                setAiLoading(false);
              }}
              disabled={aiLoading}
            >
              <Sparkles className="w-4 h-4" />
              Ask AI to improve {cockpit.bottleneck.phase}
            </button>
          )}
        </div>
      </div>

      {aiSuggestion && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="kf-card-accent p-4"
        >
          <div className="flex items-start gap-3">
            <div 
              className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium mb-1">AI Suggestion</div>
              <p className="text-sm text-muted-foreground">{aiSuggestion}</p>
            </div>
            <button 
              onClick={() => setAiSuggestion(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              &times;
            </button>
          </div>
        </motion.div>
      )}

      {cockpit && cockpit.highlights.highPotential.length > 0 && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="kf-card p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="text-sm font-medium">High Potential Contacts</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {cockpit.highlights.highPotential.slice(0, 5).map((contact) => (
              <Link
                key={contact.contactId}
                href={`/app/crm/contacts/${contact.contactId}`}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border/60 hover:border-border hover:bg-muted/50 transition-all"
              >
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{contact.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">
                  Score {contact.score}
                </span>
              </Link>
            ))}
          </div>
        </motion.div>
      )}

      {cockpit && cockpit.highlights.overdueReminders.length > 0 && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="kf-card p-4 border-amber-500/20"
        >
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <span className="text-sm font-medium">Needs Follow-up</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {cockpit.highlights.overdueReminders.slice(0, 5).map((contact) => (
              <Link
                key={contact.contactId}
                href={`/app/crm/contacts/${contact.contactId}`}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/20 hover:border-amber-500/40 hover:bg-amber-500/5 transition-all"
              >
                <Users className="w-4 h-4 text-amber-500" />
                <span className="text-sm">{contact.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500">
                  {contact.daysSince}d ago
                </span>
              </Link>
            ))}
          </div>
        </motion.div>
      )}

      {gamification && gamification.challenges.length > 0 && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="kf-card p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-5 h-5 text-amber-500" />
            <span className="text-sm font-medium">Active Challenges</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gamification.challenges.map((challenge) => {
              const progress = Math.min(100, (challenge.progress / challenge.target) * 100);
              const IconComponent = iconMap[challenge.icon] || Trophy;
              return (
                <div
                  key={challenge.id}
                  className="p-3 rounded-xl border border-border/60 bg-muted/20"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <IconComponent className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-medium">{challenge.title}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-auto">
                      {challenge.type}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{challenge.description}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-amber-500 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {challenge.progress}/{challenge.target}
                    </span>
                  </div>
                  <div className="text-xs text-amber-500 mt-1">+{challenge.xpReward} XP</div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}

async function requestAiSuggestion(item: FeedItem): Promise<string> {
  const { data, error } = await apiPost<{ suggestion: string }>({
    path: "/api/ai/suggest",
    body: { title: item.title, type: item.type, suggestion: item.suggestion },
  });
  return data?.suggestion ?? error ?? "AI is thinking...";
}
