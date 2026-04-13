"use client";

import {
  Calendar, CheckCircle, Clock, AlertTriangle, User,
  FileText, DollarSign, Zap, Target,
} from "lucide-react";
import { Project } from "@/lib/client";
import {
  getStageInfo, getProjectProgress, getProjectRisk, RISK_STYLES,
  normalizeStatus, isOverdue, formatDate, isDueSoon,
} from "../project-constants";

interface OverviewTabProps {
  project: Project;
  onStageChange: (stage: string) => void;
}

export function OverviewTab({ project, onStageChange }: OverviewTabProps) {
  const stageInfo = getStageInfo(project.status);
  const progress = getProjectProgress(project.tasks ?? []);
  const risk = getProjectRisk(project);
  const riskStyle = RISK_STYLES[risk];
  const totalTasks = project.tasks?.length ?? 0;
  const completedTasks = project.tasks?.filter((t) => t.isCompleted).length ?? 0;
  const overdueTasks = (project.tasks ?? []).filter((t) => !t.isCompleted && isOverdue(t.dueDate)).length;
  const upcomingTasks = (project.tasks ?? []).filter((t) => !t.isCompleted && isDueSoon(t.dueDate, 3)).length;

  const recommendations = [];
  if (normalizeStatus(project.status) === "NOT_STARTED" && totalTasks === 0) {
    recommendations.push({ icon: Target, text: "Add tasks to define the scope of this project", color: "hsl(var(--kf-accent1))" });
  }
  if (!project.contactId) {
    recommendations.push({ icon: User, text: "Link a client to track deliverables against their account", color: "hsl(var(--kf-info))" });
  }
  if (!project.dueDate) {
    recommendations.push({ icon: Calendar, text: "Set a due date to enable delivery tracking and risk detection", color: "hsl(var(--kf-warning))" });
  }
  if (overdueTasks > 0) {
    recommendations.push({ icon: AlertTriangle, text: `${overdueTasks} task${overdueTasks > 1 ? "s are" : " is"} overdue — review and reschedule`, color: "hsl(var(--kf-error))" });
  }
  if (normalizeStatus(project.status) === "IN_PROGRESS" && progress === 100) {
    recommendations.push({ icon: CheckCircle, text: "All tasks are complete — consider moving this project to Review or Completed", color: "hsl(var(--kf-success))" });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Progress"
          value={`${progress}%`}
          sub={`${completedTasks}/${totalTasks} tasks`}
          color={stageInfo.color}
          icon={CheckCircle}
        />
        <MetricCard
          label="Stage"
          value={stageInfo.label}
          sub={normalizeStatus(project.status) === "COMPLETED" ? "Done" : "Active"}
          color={stageInfo.color}
          icon={Target}
        />
        <MetricCard
          label="Risk"
          value={riskStyle.label}
          sub={overdueTasks > 0 ? `${overdueTasks} overdue` : "—"}
          color={riskStyle.color}
          icon={AlertTriangle}
        />
        <MetricCard
          label="Due Date"
          value={project.dueDate ? formatDate(project.dueDate) : "Not set"}
          sub={project.dueDate && isOverdue(project.dueDate) ? "Overdue" : project.dueDate && isDueSoon(project.dueDate, 7) ? "Due soon" : "—"}
          color={project.dueDate && isOverdue(project.dueDate) ? "hsl(var(--kf-error))" : "hsl(var(--muted-foreground))"}
          icon={Calendar}
        />
      </div>

      {project.description && (
        <div className="rounded-xl border border-border/40 bg-card p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Description</h4>
          <p className="text-sm text-foreground/80 leading-relaxed">{project.description}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Linked Records</h4>
          <div className="space-y-2">
            <LinkedRecord
              icon={User}
              label="Client"
              value={project.contactId ? "Linked" : "No client linked"}
              linked={!!project.contactId}
            />
            <LinkedRecord
              icon={DollarSign}
              label="Invoice"
              value={project.invoiceId ? "Linked" : "No invoice linked"}
              linked={!!project.invoiceId}
            />
            <LinkedRecord
              icon={Calendar}
              label="Booking"
              value={project.bookingId ? "Linked" : "No booking linked"}
              linked={!!project.bookingId}
            />
            <LinkedRecord
              icon={Zap}
              label="Automations"
              value="—"
              linked={false}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Task Snapshot</h4>
          {totalTasks === 0 ? (
            <p className="text-xs text-muted-foreground">No tasks added yet.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Completed</span>
                <span className="font-medium" style={{ color: "hsl(var(--kf-success))" }}>{completedTasks}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Remaining</span>
                <span className="font-medium">{totalTasks - completedTasks}</span>
              </div>
              {overdueTasks > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Overdue</span>
                  <span className="font-medium" style={{ color: "hsl(var(--kf-error))" }}>{overdueTasks}</span>
                </div>
              )}
              {upcomingTasks > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Due in 3 days</span>
                  <span className="font-medium" style={{ color: "hsl(var(--kf-warning))" }}>{upcomingTasks}</span>
                </div>
              )}
              <div className="mt-2 h-2 rounded-full overflow-hidden bg-muted/30">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${progress}%`, background: stageInfo.color }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {recommendations.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Zap className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
            Recommended Actions
          </h4>
          {recommendations.map((r, i) => (
            <div key={i} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg" style={{ background: "hsl(var(--muted) / 0.15)" }}>
              <r.icon className="w-3.5 h-3.5 shrink-0" style={{ color: r.color }} />
              <span className="text-xs text-foreground/80">{r.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Details</h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Created</span>
            <p className="font-medium mt-0.5">{new Date(project.createdAt).toLocaleDateString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Last Updated</span>
            <p className="font-medium mt-0.5">{new Date(project.updatedAt).toLocaleDateString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Priority</span>
            <p className="font-medium mt-0.5 capitalize">{(project.priority || "normal").toLowerCase()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Color</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: project.color || stageInfo.color }} />
              <span className="font-medium">{project.color || "Default"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub: string; color: string; icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3" style={{ color }} />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function LinkedRecord({ icon: Icon, label, value, linked }: {
  icon: React.ElementType; label: string; value: string; linked: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <Icon className="w-3.5 h-3.5" style={{ color: linked ? "hsl(var(--kf-accent2))" : "hsl(var(--muted-foreground) / 0.4)" }} />
      <span className="text-xs text-muted-foreground w-16">{label}</span>
      <span className={`text-xs ${linked ? "font-medium" : "text-muted-foreground/60"}`}>{value}</span>
    </div>
  );
}
