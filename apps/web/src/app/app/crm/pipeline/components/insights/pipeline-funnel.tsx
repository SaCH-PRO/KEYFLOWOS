"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";

const FUNNEL_COLORS = {
  leads: '#f97316',
  prospects: '#14b8a6',
  clients: '#10b981',
};

export const FunnelChart = React.memo(function FunnelChart({ data }: { data: FlowIntelligenceData }) {
  const leadToProspect = data.leads > 0 ? ((data.prospects / data.leads) * 100).toFixed(0) : "0";
  const prospectToClient = data.prospects > 0 ? ((data.clients / data.prospects) * 100).toFixed(0) : "0";
  const maxCount = Math.max(data.leads, data.prospects, data.clients, 1);

  const stages = [
    { label: 'Leads', count: data.leads, color: FUNNEL_COLORS.leads, conv: `${leadToProspect}%` },
    { label: 'Prospects', count: data.prospects, color: FUNNEL_COLORS.prospects, conv: `${prospectToClient}%` },
    { label: 'Clients', count: data.clients, color: FUNNEL_COLORS.clients, conv: null },
  ];

  return (
    <div className="space-y-2" role="img" aria-label={`Pipeline funnel: ${data.leads} leads, ${data.prospects} prospects, ${data.clients} clients`}>
      <span className="sr-only">
        Pipeline funnel showing {data.leads} leads converting at {leadToProspect}% to {data.prospects} prospects, then at {prospectToClient}% to {data.clients} clients.
      </span>
      {stages.map((s, i) => (
        <div key={s.label}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-[11px] text-muted-foreground/70 font-medium">{s.label}</span>
            </div>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: s.color }}>{s.count}</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.max((s.count / maxCount) * 100, 2)}%`, background: `linear-gradient(90deg, ${s.color}cc, ${s.color}80)` }}
            />
          </div>
          {s.conv && i < stages.length - 1 && (
            <div className="flex items-center gap-0.5 mt-0.5 ml-3">
              <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/40" />
              <span className="text-[10px] text-muted-foreground/50 font-medium">{s.conv}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
});
