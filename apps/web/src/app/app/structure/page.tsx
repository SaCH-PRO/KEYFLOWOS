"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Users,
  Briefcase,
  GitBranch,
  Network,
  Loader2,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
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

  const statCards = useMemo(
    () => [
      { label: "Org Units", value: stats?.unitCount ?? 0, icon: Network },
      { label: "Job Roles", value: stats?.roleCount ?? 0, icon: Briefcase },
      { label: "Active Assignments", value: stats?.assignmentCount ?? 0, icon: Users },
      { label: "Delegation Rules", value: stats?.delegationCount ?? 0, icon: GitBranch },
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
        {statCards.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-3 flex items-center gap-3"
          >
            <div className="h-9 w-9 rounded-lg bg-muted/60 flex items-center justify-center">
              <s.icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <div className="text-lg font-semibold leading-tight">
                {loadingStats ? <Loader2 className="w-4 h-4 animate-spin" /> : s.value}
              </div>
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/60 mb-4">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
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
              <Icon className="w-3.5 h-3.5" />
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
