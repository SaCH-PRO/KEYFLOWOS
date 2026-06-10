"use client";

import { useEffect, useState } from "react";
import { Clock, Calendar, CalendarDays, CheckSquare, FolderKanban, Timer, Users, ArrowRight, TrendingUp, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { FlowShell } from "@/components/layout/flow-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionCard } from "@/components/ui/section-card";
import { apiGet } from "@/lib/api";

interface TemporalOverview {
  today: { bookings: number; tasksDue: number; tasksOverdue: number; events: number };
  upcoming: { pendingBookings: number; confirmedBookings: number; activeProjects: number; blockedTasks: number };
  capacity: { staffCount: number; utilizationPct: number };
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

export default function TemporalFlowPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TemporalOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      if (!businessId) return;
      const res = await apiGet<TemporalOverview>(`/temporal/businesses/${businessId}/overview`);
      if (!cancelled && res.data) setData(res.data);
      setLoading(false);
    }
    fetchData();
    return () => { cancelled = true; };
  }, [businessId]);

  const sections = [
    { label: "Calendar", href: "/app/calendar", icon: CalendarDays, desc: "Schedule and events", count: data?.today.events ?? 0 },
    { label: "Bookings", href: "/app/bookings", icon: Calendar, desc: "Appointments and reservations", count: data?.upcoming.confirmedBookings ?? 0 },
    { label: "Projects", href: "/app/projects", icon: FolderKanban, desc: "Active work and milestones", count: data?.upcoming.activeProjects ?? 0 },
    { label: "Tasks", href: "/app/approvals", icon: CheckSquare, desc: "To-do and follow-ups", count: data?.today.tasksDue ?? 0 },
  ];

  const capacityColor = (data?.capacity.utilizationPct ?? 0) > 90 ? "text-red-500" : (data?.capacity.utilizationPct ?? 0) > 70 ? "text-amber-500" : "text-emerald-500";

  return (
    <FlowShell
      title="Temporal Flow"
      subtitle="Leverage time. Schedule, plan, and protect capacity."
      icon={Clock}
      activeFlowId="temporal"
    >
      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="kf-card-metric animate-pulse h-20" />)
        ) : (
          <>
            <motion.div variants={fadeUp} initial="hidden" animate="show">
              <MetricCard label="Today's Bookings" value={data?.today.bookings ?? 0} icon={Calendar} />
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.05 }}>
              <MetricCard label="Tasks Due" value={data?.today.tasksDue ?? 0} icon={CheckSquare} />
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
              <MetricCard label="Overdue Tasks" value={data?.today.tasksOverdue ?? 0} icon={Timer} iconColor="#ef4444" />
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
              <MetricCard label="Capacity Used" value={`${data?.capacity.utilizationPct ?? 0}%`} icon={Users} iconColor="#8b5cf6" />
            </motion.div>
          </>
        )}
      </div>

      {/* Upcoming Snapshot */}
      {!loading && data && (
        <SectionCard title="Upcoming Snapshot" icon={TrendingUp} compact>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3">
            {[
              { label: "Pending Bookings", value: data.upcoming.pendingBookings, icon: AlertCircle, color: "text-amber-500" },
              { label: "Confirmed", value: data.upcoming.confirmedBookings, icon: CalendarDays, color: "text-emerald-500" },
              { label: "Active Projects", value: data.upcoming.activeProjects, icon: FolderKanban, color: "text-[hsl(var(--kf-accent1))]" },
              { label: "Blocked Tasks", value: data.upcoming.blockedTasks, icon: Timer, color: "text-red-500" },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.05 }}
                className="text-center"
              >
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
                  <span className="text-[11px] text-muted-foreground">{item.label}</span>
                </div>
                <div className="text-xl font-bold">{item.value}</div>
              </motion.div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Capacity Bar */}
      {!loading && data && (
        <SectionCard title="Team Capacity" icon={Users} compact>
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{data.capacity.staffCount} staff members</span>
              <span className={`text-sm font-bold ${capacityColor}`}>{data.capacity.utilizationPct}% utilized</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${
                  data.capacity.utilizationPct > 90 ? "bg-red-500" : data.capacity.utilizationPct > 70 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${data.capacity.utilizationPct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {data.capacity.utilizationPct > 90
                ? "High utilization — consider redistributing workload."
                : data.capacity.utilizationPct > 70
                ? "Healthy utilization with some buffer room."
                : "Low utilization — team has capacity for new work."}
            </p>
          </div>
        </SectionCard>
      )}

      {/* Navigation Cards */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 gap-3"
      >
        {sections.map((s) => (
          <motion.button
            key={s.label}
            variants={fadeUp}
            onClick={() => router.push(s.href)}
            className="kf-card kf-radius-lg p-4 text-left hover:shadow-md transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 kf-radius-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                  <s.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm">{s.label}</h3>
                    {s.count > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] font-medium">
                        {s.count}
                      </span>
                    )}
                  </div>
                  <p className="kf-text-micro text-muted-foreground">{s.desc}</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </motion.button>
        ))}
      </motion.div>
    </FlowShell>
  );
}
