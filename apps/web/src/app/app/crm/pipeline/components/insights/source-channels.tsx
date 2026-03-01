"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Filter, MessageCircle, Mail, Phone, Globe } from "lucide-react";
import type { Contact } from "@/lib/client";

export const SourceConversion = React.memo(function SourceConversion({ contacts }: { contacts: Contact[] }) {
  const data = useMemo(() => {
    const map: Record<string, { total: number; clients: number }> = {};
    for (const c of contacts) {
      const src = c.source || "unknown";
      if (!map[src]) map[src] = { total: 0, clients: 0 };
      map[src].total++;
      if (c.status === "CLIENT") map[src].clients++;
    }
    return Object.entries(map)
      .filter(([, v]) => v.total >= 2)
      .map(([source, v]) => ({ source, total: v.total, clients: v.clients, rate: v.total > 0 ? Math.round((v.clients / v.total) * 100) : 0 }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);
  }, [contacts]);

  if (data.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <TrendingUp className="w-3.5 h-3.5" />
        Source Effectiveness
      </h3>
      <div className="space-y-2">
        {data.map((d) => (
          <div key={d.source}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="capitalize text-muted-foreground/60 font-medium">{d.source.replace(/_/g, " ")}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground/50">{d.clients}/{d.total}</span>
                <span className={`font-mono font-bold text-[10px] ${d.rate >= 50 ? "text-emerald-400" : d.rate >= 25 ? "text-amber-400" : "text-muted-foreground/50"}`}>{d.rate}%</span>
              </div>
            </div>
            <div className="h-1 bg-white/[0.03] rounded-full overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${d.rate}%` }} transition={{ duration: 0.5 }}
                className={`h-full rounded-full ${d.rate >= 50 ? "bg-gradient-to-r from-emerald-500/50 to-emerald-400" : d.rate >= 25 ? "bg-gradient-to-r from-amber-500/50 to-amber-400" : "bg-gradient-to-r from-muted to-muted-foreground/50"}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export const ChannelPreference = React.memo(function ChannelPreference({ contacts }: { contacts: Contact[] }) {
  const channels = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contacts) {
      const ch = c.preferredChannel || "none";
      map[ch] = (map[ch] || 0) + 1;
    }
    const total = contacts.length || 1;
    return Object.entries(map)
      .filter(([key]) => key !== "none")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([channel, count]) => ({ channel, count, pct: Math.round((count / total) * 100) }));
  }, [contacts]);

  if (channels.length === 0) return null;

  const channelConfig: Record<string, { icon: React.ElementType; color: string }> = {
    email: { icon: Mail, color: "hsl(220 70% 55%)" },
    whatsapp: { icon: MessageCircle, color: "hsl(142 70% 45%)" },
    phone: { icon: Phone, color: "hsl(280 60% 55%)" },
    sms: { icon: MessageCircle, color: "hsl(200 70% 50%)" },
  };

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <MessageCircle className="w-3.5 h-3.5" />
        Channels
      </h3>
      <div className="space-y-1.5">
        {channels.map((ch) => {
          const cfg = channelConfig[ch.channel.toLowerCase()] || { icon: Globe, color: "hsl(var(--kf-muted-foreground))" };
          const ChIcon = cfg.icon;
          return (
            <div key={ch.channel} className="flex items-center gap-2">
              <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: `${cfg.color}12` }}>
                <ChIcon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
              </div>
              <span className="text-[10px] capitalize text-muted-foreground/60 flex-1">{ch.channel}</span>
              <span className="text-[10px] font-mono font-semibold text-muted-foreground/70">{ch.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const TopSources = React.memo(function TopSources({ contacts }: { contacts: Contact[] }) {
  const sources = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contacts) {
      const src = c.source || "unknown";
      map[src] = (map[src] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [contacts]);

  const maxCount = sources.length > 0 ? sources[0][1] : 1;
  if (sources.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <Filter className="w-3.5 h-3.5" />
        Sources
      </h3>
      <div className="space-y-2">
        {sources.map(([source, count]) => {
          const pct = (count / maxCount) * 100;
          return (
            <div key={source}>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="capitalize text-muted-foreground/60">{source.replace(/_/g, " ")}</span>
                <span className="font-mono font-semibold text-muted-foreground/70">{count}</span>
              </div>
              <div className="h-1 bg-white/[0.03] rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }}
                  className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent2))]/40 to-[hsl(var(--kf-accent2))]" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
