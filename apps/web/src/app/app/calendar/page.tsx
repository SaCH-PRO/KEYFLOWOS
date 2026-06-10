"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Brain, CheckSquare, Timer, Calendar, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionCard } from "@/components/ui/section-card";
import { MasterCalendar } from "./master-calendar";
import { TemporalIntelligencePanel } from "./components/temporal-intelligence-panel";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { apiGet } from "@/lib/api";

interface CalendarStats {
  today: { bookings: number; tasksDue: number; tasksOverdue: number; events: number };
  upcoming: { pendingBookings: number; confirmedBookings: number; activeProjects: number; blockedTasks: number };
  capacity: { staffCount: number; utilizationPct: number };
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

export default function CalendarPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [stats, setStats] = useState<CalendarStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) { setBusinessId(fresh); return; }
      const stored = getStoredBusinessId();
      if (stored) setBusinessId(stored);
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    apiGet<CalendarStats>(`/temporal/businesses/${businessId}/overview`)
      .then((res) => {
        if (!cancelled && res.data) setStats(res.data);
      })
      .finally(() => setLoadingStats(false));
    return () => { cancelled = true; };
  }, [businessId]);

  return (
    <WorkspaceShell
      icon={CalendarDays}
      title="Calendar"
      subtitle="Unified view of bookings, tasks, deadlines, content, and external events"
      enableSwipe
      metricStrip={
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {loadingStats ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="kf-card-metric animate-pulse h-20" />
            ))
          ) : (
            <>
              <motion.div variants={fadeUp} initial="hidden" animate="show">
                <MetricCard label="Today's Bookings" value={stats?.today.bookings ?? 0} icon={Calendar} />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.05 }}>
                <MetricCard label="Tasks Due" value={stats?.today.tasksDue ?? 0} icon={CheckSquare} />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
                <MetricCard label="Overdue" value={stats?.today.tasksOverdue ?? 0} icon={Timer} iconColor="#ef4444" />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
                <MetricCard label="Capacity Used" value={`${stats?.capacity.utilizationPct ?? 0}%`} icon={Sparkles} iconColor="#8b5cf6" />
              </motion.div>
            </>
          )}
        </div>
      }
    >
      <div className="flex flex-col xl:flex-row gap-6">
        <div className="flex-1 min-w-0">
          {businessId ? (
            <MasterCalendar businessId={businessId} />
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="animate-pulse text-muted-foreground text-sm">Loading calendar...</div>
            </div>
          )}
        </div>
        <aside className="w-full xl:w-80 shrink-0 space-y-4">
          <div className="xl:sticky xl:top-4">
            <SectionCard
              title="AI Assistant"
              icon={Brain}
              compact
              noPadding
              className="border-border/40"
            >
              <div className="p-3">
                <TemporalIntelligencePanel />
              </div>
            </SectionCard>
          </div>
        </aside>
      </div>
    </WorkspaceShell>
  );
}
