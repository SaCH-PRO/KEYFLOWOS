"use client";

import { useEffect, useState } from "react";
import { Clock, Calendar, CalendarDays, CheckSquare, FolderKanban, Timer, Users, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { FlowShell } from "@/components/layout/flow-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { apiGet } from "@/lib/api";

interface TemporalOverview {
  today: { bookings: number; tasksDue: number; tasksOverdue: number; events: number };
  upcoming: { pendingBookings: number; confirmedBookings: number; activeProjects: number; blockedTasks: number };
  capacity: { staffCount: number; utilizationPct: number };
}

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
    { label: "Calendar", href: "/app/calendar", icon: CalendarDays, desc: "Schedule and events" },
    { label: "Bookings", href: "/app/bookings", icon: Calendar, desc: "Appointments and reservations" },
    { label: "Projects", href: "/app/projects", icon: FolderKanban, desc: "Active work and milestones" },
    { label: "Tasks", href: "/app/approvals", icon: CheckSquare, desc: "To-do and follow-ups" },
  ];

  return (
    <FlowShell
      title="Temporal Flow"
      subtitle="Leverage time. Schedule, plan, and protect capacity."
      icon={Clock}
      activeFlowId="temporal"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="kf-card-metric animate-pulse h-20" />) : (
          <>
            <MetricCard label="Today's Bookings" value={data?.today.bookings ?? 0} icon={Calendar} />
            <MetricCard label="Tasks Due" value={data?.today.tasksDue ?? 0} icon={CheckSquare} />
            <MetricCard label="Overdue Tasks" value={data?.today.tasksOverdue ?? 0} icon={Timer} iconColor="#ef4444" />
            <MetricCard label="Capacity Used" value={`${data?.capacity.utilizationPct ?? 0}%`} icon={Users} />
          </>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map((s) => (
          <button key={s.label} onClick={() => router.push(s.href)} className="kf-card kf-radius-lg p-4 text-left hover:shadow-md transition-all group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 kf-radius-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                  <s.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{s.label}</h3>
                  <p className="kf-text-micro text-muted-foreground">{s.desc}</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </button>
        ))}
      </div>
    </FlowShell>
  );
}
