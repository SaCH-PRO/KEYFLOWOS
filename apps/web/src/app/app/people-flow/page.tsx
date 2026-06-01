"use client";

import { useEffect, useState } from "react";
import { Users, Contact, UserCheck, UserX, Heart, TrendingUp, Send, ArrowRight, UsersRound, ShieldAlert, Flame, Snowflake } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { FlowShell } from "@/components/layout/flow-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { apiGet } from "@/lib/api";
import { fetchPeopleSegments, type PeopleSegment } from "@/lib/api/people-flow";

interface PeopleOverview {
  contacts: { total: number; leads: number; customers: number; staleLeads: number; atRisk: number; highValue: number };
  pipeline: { openDeals: number; pipelineValue: number };
  followUps: { overdue: number; today: number };
}

const SEGMENT_ICONS: Record<string, React.ReactNode> = {
  "hot-leads": <Flame className="w-4 h-4 text-orange-500" />,
  "stale-leads": <Snowflake className="w-4 h-4 text-blue-400" />,
  "high-value": <TrendingUp className="w-4 h-4 text-emerald-500" />,
  "at-risk": <ShieldAlert className="w-4 h-4 text-red-500" />,
  "dormant": <Snowflake className="w-4 h-4 text-slate-400" />,
};

const SEGMENT_COLORS: Record<string, string> = {
  "hot-leads": "bg-orange-500/10 border-orange-500/20",
  "stale-leads": "bg-blue-500/10 border-blue-500/20",
  "high-value": "bg-emerald-500/10 border-emerald-500/20",
  "at-risk": "bg-red-500/10 border-red-500/20",
  "dormant": "bg-slate-500/10 border-slate-500/20",
};

export default function PeopleFlowPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PeopleOverview | null>(null);
  const [segments, setSegments] = useState<PeopleSegment[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      if (!businessId) return;
      const [ovRes, segRes] = await Promise.all([
        apiGet<PeopleOverview>(`/people-flow/businesses/${businessId}/overview`),
        fetchPeopleSegments(businessId),
      ]);
      if (!cancelled && ovRes.data) setData(ovRes.data);
      if (!cancelled && segRes.data) setSegments(segRes.data);
      setLoading(false);
    }
    fetchData();
    return () => { cancelled = true; };
  }, [businessId]);

  const sections = [
    { label: "Contacts", href: "/app/network/contacts", icon: Contact, desc: "All people and relationships" },
    { label: "Leads", href: "/app/network/contacts?status=LEAD", icon: UserCheck, desc: "Prospects to nurture" },
    { label: "Customers", href: "/app/network/contacts?status=CLIENT", icon: Heart, desc: "Clients and loyalty" },
    { label: "Follow-ups", href: "/app/crm/sequences", icon: Send, desc: "Sequences and outreach" },
  ];

  return (
    <FlowShell
      title="People Flow"
      subtitle="Leverage relationships. Know who matters and what to do next."
      icon={Users}
      activeFlowId="people"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="kf-card-metric animate-pulse h-20" />) : (
          <>
            <MetricCard label="Total Contacts" value={data?.contacts.total ?? 0} icon={Contact} />
            <MetricCard label="Pipeline Value" value={`$${(data?.pipeline.pipelineValue ?? 0).toLocaleString()}`} icon={TrendingUp} />
            <MetricCard label="Stale Leads" value={data?.contacts.staleLeads ?? 0} icon={UserX} iconColor="#f59e0b" />
            <MetricCard label="Overdue Follow-ups" value={data?.followUps.overdue ?? 0} icon={Send} iconColor="#ef4444" />
          </>
        )}
      </div>

      {/* Segments */}
      {!loading && segments.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Segments</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {segments.map((seg) => (
              <div key={seg.id} className={`p-3 rounded-xl border ${SEGMENT_COLORS[seg.id] ?? "bg-muted/30 border-border/50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {SEGMENT_ICONS[seg.id] ?? <UsersRound className="w-4 h-4 text-muted-foreground" />}
                    <span className="text-sm font-medium">{seg.name}</span>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-background">{seg.count}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2">{seg.criteria}</p>
                <div className="flex flex-wrap gap-1">
                  {seg.contacts.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => router.push(`/app/crm/contacts/${c.id}`)}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-background hover:bg-muted transition-colors"
                      title={c.email ?? undefined}
                    >
                      {c.name}
                    </button>
                  ))}
                  {seg.count > seg.contacts.length && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-background text-muted-foreground">
                      +{seg.count - seg.contacts.length} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
