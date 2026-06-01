"use client";

import { useEffect, useState } from "react";
import { Users, Contact, UserCheck, UserX, Heart, TrendingUp, Send, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { FlowShell } from "@/components/layout/flow-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { apiGet } from "@/lib/api";

interface PeopleOverview {
  contacts: { total: number; leads: number; customers: number; staleLeads: number; atRisk: number; highValue: number };
  pipeline: { openDeals: number; pipelineValue: number };
  followUps: { overdue: number; today: number };
}

export default function PeopleFlowPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PeopleOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      if (!businessId) return;
      const res = await apiGet<PeopleOverview>(`/people-flow/businesses/${businessId}/overview`);
      if (!cancelled && res.data) setData(res.data);
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
