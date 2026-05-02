"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Mail, Phone, Globe, Filter, Target, ListChecks, DollarSign, CheckCircle2 } from "lucide-react";
import type { Contact } from "@/lib/client";
import { formatTTD } from "./insights-shared";

const COMPLETENESS_FIELDS: { key: keyof Contact; weight: number }[] = [
  { key: "firstName", weight: 15 },
  { key: "lastName", weight: 10 },
  { key: "email", weight: 20 },
  { key: "phone", weight: 15 },
  { key: "companyName", weight: 10 },
  { key: "source", weight: 5 },
  { key: "tags", weight: 5 },
  { key: "city", weight: 5 },
  { key: "country", weight: 5 },
  { key: "jobTitle", weight: 5 },
  { key: "preferredChannel", weight: 5 },
];

function computeHealthStats(contacts: Contact[]) {
  if (contacts.length === 0) {
    return { completenessAvg: 0, withEmail: 0, withPhone: 0, withCompany: 0, withTags: 0, withCity: 0, total: 0 };
  }

  let totalScore = 0;
  let withEmail = 0, withPhone = 0, withCompany = 0, withTags = 0, withCity = 0;

  for (const c of contacts) {
    let score = 0;
    for (const f of COMPLETENESS_FIELDS) {
      const val = c[f.key];
      if (f.key === "tags") {
        if (Array.isArray(val) && val.length > 0) score += f.weight;
      } else if (val && typeof val === "string" && val.trim()) {
        score += f.weight;
      }
    }
    totalScore += score;
    if (c.email) withEmail++;
    if (c.phone) withPhone++;
    if (c.companyName) withCompany++;
    if (Array.isArray(c.tags) && c.tags.length > 0) withTags++;
    if (c.city) withCity++;
  }

  return { completenessAvg: Math.round(totalScore / contacts.length), withEmail, withPhone, withCompany, withTags, withCity, total: contacts.length };
}

function getCompletenessColor(pct: number): string {
  if (pct >= 75) return "hsl(142 76% 36%)";
  if (pct >= 50) return "hsl(var(--kf-accent2))";
  if (pct >= 25) return "hsl(var(--kf-accent1))";
  return "hsl(0 84% 60%)";
}

export const DataCompleteness = React.memo(function DataCompleteness({ contacts }: { contacts: Contact[] }) {
  const stats = useMemo(() => computeHealthStats(contacts), [contacts]);

  if (stats.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-4 text-center">
        <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center mb-1.5">
          <ShieldCheck className="w-4 h-4 text-muted-foreground/50" />
        </div>
        <p className="text-[10px] text-muted-foreground/50">Add contacts to track quality</p>
      </div>
    );
  }

  const color = getCompletenessColor(stats.completenessAvg);
  const fields = [
    { label: "Email", count: stats.withEmail, icon: Mail },
    { label: "Phone", count: stats.withPhone, icon: Phone },
    { label: "Company", count: stats.withCompany, icon: Globe },
    { label: "Tags", count: stats.withTags, icon: Filter },
    { label: "Location", count: stats.withCity, icon: Target },
  ];

  const circumference = 2 * Math.PI * 36;
  const dashLength = (stats.completenessAvg / 100) * circumference;

  return (
    <div className="space-y-2.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5" />
        Data Quality
      </h3>
      <div className="flex items-center gap-5">
        <div className="relative w-[88px] h-[88px] shrink-0">
          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
            <circle cx="40" cy="40" r="36" fill="none" strokeWidth="5" className="stroke-white/[0.04]" />
            <motion.circle
              cx="40" cy="40" r="36" fill="none" strokeWidth="5"
              initial={{ strokeDasharray: `0 ${circumference}` }}
              animate={{ strokeDasharray: `${dashLength} ${circumference - dashLength}` }}
              transition={{ duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
              strokeLinecap="round"
              style={{ stroke: color }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold" style={{ color }}>{stats.completenessAvg}%</span>
            <span className="text-[10px] text-muted-foreground/50">complete</span>
          </div>
        </div>
        <div className="flex-1 space-y-1.5">
          {fields.map((f) => {
            const pct = Math.round((f.count / stats.total) * 100);
            const FieldIcon = f.icon;
            return (
              <div key={f.label} className="flex items-center gap-1.5">
                <FieldIcon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                <span className="text-[10px] text-muted-foreground/50 w-12">{f.label}</span>
                <div className="flex-1 h-1 bg-white/[0.03] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="h-full rounded-full"
                    style={{ background: getCompletenessColor(pct) }}
                  />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground/50 w-7 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export const TaskHealth = React.memo(function TaskHealth({ contacts }: { contacts: Contact[] }) {
  const stats = useMemo(() => {
    let overdue = 0, withOverdue = 0, totalUnpaid = 0, totalRevenue = 0, hasMeta = false;
    for (const c of contacts) {

      const meta = (c as Record<string, unknown>).meta as Record<string, unknown> | null | undefined;
      if (!meta) continue;
      hasMeta = true;
      const ot = typeof meta.overdueTasks === "number" ? meta.overdueTasks : 0;
      overdue += ot;
      if (ot > 0) withOverdue++;
      const ui = typeof meta.unpaidInvoices === "number" ? meta.unpaidInvoices : 0;
      totalUnpaid += ui;
      const tr = typeof meta.totalRevenue === "number" ? meta.totalRevenue : 0;
      totalRevenue += tr;
    }
    return { overdue, withOverdue, totalUnpaid, totalRevenue, hasMeta };
  }, [contacts]);

  if (!stats.hasMeta) return null;

  const items = [
    { label: "Overdue", value: stats.overdue.toString(), icon: ListChecks, bad: stats.overdue > 0 },
    { label: "Unpaid", value: stats.totalUnpaid.toString(), icon: DollarSign, bad: stats.totalUnpaid > 0 },
    ...(stats.totalRevenue > 0 ? [{ label: "Revenue", value: formatTTD(stats.totalRevenue), icon: CheckCircle2, bad: false }] : []),
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <ListChecks className="w-3.5 h-3.5" />
        Health
      </h3>
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="text-center p-2 rounded-lg bg-white/[0.02] border border-border/30">
              <div className={`w-6 h-6 rounded-md mx-auto mb-1 flex items-center justify-center ${it.bad ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
                <Icon className={`w-3 h-3 ${it.bad ? "text-red-400" : "text-emerald-400"}`} />
              </div>
              <div className={`text-xs font-bold ${it.bad ? "text-red-400" : "text-emerald-400"}`}>{it.value}</div>
              <div className="text-[10px] text-muted-foreground/50">{it.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
