"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Target,
  AlertTriangle,
  TrendingUp,
  Users,
  CheckCircle2,
  FolderKanban,
} from "lucide-react";
import type { Project } from "@/lib/client";
import { normalizeStatus, isOverdue, isDueSoon, getProjectRisk } from "./project-constants";
import { useTaskAssigneeOptions } from "./project-detail-tabs/tasks-tab";

/**
 * PR196-PROJECTS-WEB (F10c; WPD-17, WPD-18): everything on this panel is computed from the projects
 * the page already loaded. It used to render demo arrays ("Sarah Chen", "Project Alpha", "+2 this
 * week"); PR #196 kept a weekly change it never computed and a team load that assumed 6 open tasks
 * were 100% of anyone's capacity. Neither is shown: there is no trend without history and no load
 * percentage without capacity. Open tasks are counted per assignee, members and booking staff
 * alike (D-87); the assignee options only put names to the ids.
 */
interface ProjectInsight {
  id: string;
  type: "risk" | "milestone" | "resource";
  title: string;
  description: string;
  project: string;
  impact: string;
}

interface AssigneeLoad {
  key: string;
  name: string;
  kind: string;
  openTasks: number;
}

interface ProjectIntelligencePanelProps {
  projects?: Project[] | null;
  businessId?: string | null;
}

const isLive = (p: Project) => {
  const s = normalizeStatus(p.status);
  return s !== "COMPLETED" && s !== "ARCHIVED";
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ProjectIntelligencePanel({ projects, businessId }: ProjectIntelligencePanelProps) {
  const list = useMemo(() => projects ?? [], [projects]);
  const assigneeOptions = useTaskAssigneeOptions(list.length > 0 ? businessId : null);

  const metrics = useMemo(() => {
    const active = list.filter(isLive);
    return [
      { label: "Active Projects", value: active.length, icon: Target },
      { label: "On Track", value: active.filter((p) => getProjectRisk(p) === "healthy").length, icon: CheckCircle2 },
      { label: "At Risk", value: active.filter((p) => getProjectRisk(p) !== "healthy").length, icon: AlertTriangle },
      { label: "Completed", value: list.filter((p) => normalizeStatus(p.status) === "COMPLETED").length, icon: TrendingUp },
    ];
  }, [list]);

  const insights = useMemo(() => {
    const items: ProjectInsight[] = [];
    for (const p of list.filter(isLive)) {
      const open = (p.tasks ?? []).filter((t) => !t.isCompleted);
      const overdue = open.filter((t) => isOverdue(t.dueDate));
      const pastDue = isOverdue(p.dueDate);
      if (overdue.length > 0 || pastDue) {
        items.push({
          id: `risk-${p.id}`,
          type: "risk",
          title: `Deadline risk: ${p.name}`,
          description: `${plural(overdue.length, "task")} overdue${pastDue ? "; the project's due date has passed" : ""}.`,
          project: p.name,
          impact: overdue.length > 0 ? `${overdue.length} overdue` : "Past due",
        });
      }
      if (isDueSoon(p.dueDate, 7)) {
        items.push({
          id: `due-${p.id}`,
          type: "milestone",
          title: `Due within 7 days: ${p.name}`,
          description: `${plural(open.length, "open task")} remaining.`,
          project: p.name,
          impact: "Due soon",
        });
      }
      const unassigned = open.filter((t) => !t.assigneeId);
      if (unassigned.length > 0) {
        items.push({
          id: `unassigned-${p.id}`,
          type: "resource",
          title: `Unassigned work: ${p.name}`,
          description: `${plural(unassigned.length, "open task")} with no one assigned.`,
          project: p.name,
          impact: `${unassigned.length} unassigned`,
        });
      }
    }
    return items.slice(0, 6);
  }, [list]);

  const loads = useMemo(() => {
    const names = new Map((assigneeOptions ?? []).map((o) => [o.id, o]));
    const counts = new Map<string, number>();
    for (const p of list.filter(isLive)) {
      for (const t of p.tasks ?? []) {
        if (t.isCompleted) continue;
        const key = t.assigneeId || "";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const rows: AssigneeLoad[] = [...counts.entries()].map(([key, openTasks]) => {
      if (!key) return { key: "unassigned", name: "Unassigned", kind: "No one yet", openTasks };
      const option = names.get(key);
      return {
        key,
        name: option?.name ?? "Unlisted assignee",
        kind: option ? (option.type === "User" ? "Team member" : "Booking staff") : "Not in the assignee list",
        openTasks,
      };
    });
    return rows.sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name));
  }, [list, assigneeOptions]);

  if (list.length === 0) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card/40 p-6 text-center">
        <FolderKanban className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No projects yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Project intelligence is drawn from this business&apos;s projects. Create a project or approve a plan to see it here.
        </p>
      </div>
    );
  }

  const maxOpen = Math.max(1, ...loads.map((l) => l.openTasks));

  return (
    <div className="space-y-4">
      {/* Metrics: counts of the projects loaded; no trend is shown because none is computed. */}
      <div className="grid grid-cols-2 gap-2">
        {metrics.map((metric, i) => (
          <motion.div
            key={metric.label}
            data-metric={metric.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
            className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-3"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <metric.icon className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{metric.label}</span>
            </div>
            <div className="text-lg font-bold" data-metric-value>{metric.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Insights */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Project Intelligence
          </h3>
        </div>
        {insights.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-xl border border-border/40 bg-card/40 p-3">
            No overdue, due-soon or unassigned work in active projects.
          </p>
        ) : (
          <div className="space-y-2">
            {insights.map((insight, i) => {
              const config = {
                risk: { bg: "bg-rose-500/5", border: "border-rose-500/20", icon: AlertTriangle },
                milestone: { bg: "bg-amber-500/5", border: "border-amber-500/20", icon: Target },
                resource: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: Users },
              }[insight.type];
              const Icon = config.icon;
              return (
                <motion.div
                  key={insight.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.3 }}
                  className={`rounded-xl border ${config.border} ${config.bg} p-3`}
                >
                  <div className="flex items-start gap-2">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-foreground">{insight.title}</span>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-background/60 text-muted-foreground">
                          {insight.project}
                        </span>
                        <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">{insight.impact}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Open tasks per assignee (members and booking staff, D-87). No capacity is known, so no %. */}
      <section
        aria-labelledby="project-intel-assignees"
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-4"
      >
        <h3 id="project-intel-assignees" className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          Open tasks by assignee
        </h3>
        {loads.length === 0 ? (
          <p className="text-xs text-muted-foreground">No open tasks in active projects.</p>
        ) : (
          <div className="space-y-2.5">
            {loads.map((row) => (
              <div key={row.key} data-assignee={row.key}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{row.name}</span>
                    <span className="text-[10px] text-muted-foreground">{row.kind}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{plural(row.openTasks, "open task")}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-muted/20 overflow-hidden" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-[hsl(var(--kf-accent2))]"
                    style={{ width: `${Math.round((row.openTasks / maxOpen) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
