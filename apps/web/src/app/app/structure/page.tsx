"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Building2,
  Users,
  Briefcase,
  GitBranch,
  Network,
  Loader2,
  LayoutGrid,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionCard } from "@/components/ui/section-card";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchStructureStats, type StructureStats } from "@/lib/client";
import { OrgUnitsPanel } from "./components/org-units-panel";
import { JobRolesPanel } from "./components/job-roles-panel";
import { AssignmentsPanel } from "./components/assignments-panel";
import { DelegationPanel } from "./components/delegation-panel";

const TABS = [
  { key: "units", label: "Org Units", icon: Building2 },
  { key: "roles", label: "Job Roles", icon: Briefcase },
  { key: "assignments", label: "Assignments", icon: Users },
  { key: "delegation", label: "Delegation", icon: GitBranch },
];

const TAB_COLORS: Record<string, string> = {
  units: "#F97316",
  roles: "#3b82f6",
  assignments: "#10b981",
  delegation: "#8b5cf6",
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

export default function StructurePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "units";
  const businessId = getStoredBusinessId();
  const [stats, setStats] = useState<StructureStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    fetchStructureStats(businessId)
      .then((res) => {
        if (res.data) setStats(res.data);
      })
      .finally(() => setLoadingStats(false));
  }, [businessId]);

  const setTab = (key: string) => {
    router.replace(`/app/structure?tab=${key}`);
  };

  const statItems = useMemo(
    () => [
      { label: "Org Units", value: stats?.unitCount ?? 0, icon: Network, color: "#F97316" },
      { label: "Job Roles", value: stats?.roleCount ?? 0, icon: Briefcase, color: "#3b82f6" },
      { label: "Active Assignments", value: stats?.assignmentCount ?? 0, icon: Users, color: "#10b981" },
      { label: "Delegation Rules", value: stats?.delegationCount ?? 0, icon: GitBranch, color: "#8b5cf6" },
    ],
    [stats],
  );

  return (
    <WorkspaceShell
      icon={Network}
      title="Structure"
      subtitle="Organizational units, roles, assignments & delegation"
      iconColor="#F97316"
    >
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {loadingStats ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="kf-card-metric animate-pulse h-20" />
          ))
        ) : (
          statItems.map((s, i) => (
            <motion.div
              key={s.label}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              transition={{ delay: i * 0.05 }}
            >
              <MetricCard label={s.label} value={s.value} icon={s.icon} iconColor={s.color} />
            </motion.div>
          ))
        )}
      </div>

      {/* Org Visual Placeholder */}
      {!loadingStats && stats && (
        <SectionCard title="Organization Overview" icon={LayoutGrid} compact className="mb-6">
          <div className="p-4 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center">
                <Network className="w-6 h-6 text-[hsl(var(--kf-accent1))]" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">{stats.unitCount} units · {stats.roleCount} roles · {stats.assignmentCount} assignments</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Org chart visualization coming soon</p>
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/60 mb-4">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          const color = TAB_COLORS[t.key];
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium border-b-2 transition-all ${
                active
                  ? "border-[hsl(var(--kf-accent1))] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" style={active ? { color } : undefined} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      {tab === "units" && <OrgUnitsPanel />}
      {tab === "roles" && <JobRolesPanel />}
      {tab === "assignments" && <AssignmentsPanel />}
      {tab === "delegation" && <DelegationPanel />}
    </WorkspaceShell>
  );
}
