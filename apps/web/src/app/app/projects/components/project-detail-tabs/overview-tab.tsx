"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Calendar, CheckCircle, Clock, AlertTriangle, User,
  FileText, DollarSign, Zap, Target, TrendingUp,
  ExternalLink, HeartPulse,
} from "lucide-react";
import { Project, fetchContactDetail, type Contact } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getStageInfo, getProjectProgress, getProjectRisk, RISK_STYLES,
  normalizeStatus, isOverdue, formatDate, isDueSoon,
} from "../project-constants";

interface OverviewTabProps {
  project: Project;
  onStageChange: (stage: string) => void;
}

export function OverviewTab({ project, onStageChange }: OverviewTabProps) {
  const [clientName, setClientName] = useState<string | null>(null);
  const [clientEmail, setClientEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!project.contactId) return;
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const ctrl = new AbortController();
    fetchContactDetail(project.contactId, businessId, { signal: ctrl.signal }).then((res) => {
      if (res.data?.contact) {
        const c = res.data.contact;
        const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown";
        setClientName(name);
        setClientEmail(c.email ?? null);
      }
    });
    return () => ctrl.abort();
  }, [project.contactId]);

  const stageInfo = getStageInfo(project.status);
  const progress = getProjectProgress(project.tasks ?? []);
  const risk = getProjectRisk(project);
  const riskStyle = RISK_STYLES[risk];
  const totalTasks = project.tasks?.length ?? 0;
  const completedTasks = project.tasks?.filter((t) => t.isCompleted).length ?? 0;
  const overdueTasks = (project.tasks ?? []).filter((t) => !t.isCompleted && isOverdue(t.dueDate)).length;
  const upcomingTasks = (project.tasks ?? []).filter((t) => !t.isCompleted && isDueSoon(t.dueDate, 3)).length;

  const daysUntilDue = useMemo(() => {
    if (!project.dueDate) return null;
    const now = new Date();
    return Math.ceil((new Date(project.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }, [project.dueDate]);

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
  if (risk === "at-risk" && daysUntilDue !== null && daysUntilDue > 0 && daysUntilDue <= 3) {
    recommendations.push({ icon: Clock, text: `Due in ${daysUntilDue} day${daysUntilDue > 1 ? "s" : ""} with low progress — consider re-scoping or extending`, color: "hsl(var(--kf-warning))" });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard
          label="Health"
          value={riskStyle.label}
          sub={overdueTasks > 0 ? `${overdueTasks} overdue` : "No blockers"}
          color={riskStyle.color}
          icon={HeartPulse}
        />
        <MetricCard
          label="Progress"
          value={`${progress}%`}
          sub={`${completedTasks}/${totalTasks} tasks`}
          color={stageInfo.color}
          icon={TrendingUp}
          showBar
          barPercent={progress}
          barColor={stageInfo.color}
        />
        <MetricCard
          label="Stage"
          value={stageInfo.label}
          sub={normalizeStatus(project.status) === "COMPLETED" ? "Done" : "Active"}
          color={stageInfo.color}
          icon={Target}
        />
        <MetricCard
          label="Priority"
          value={(project.priority || "Normal")}
          sub={risk === "critical" || risk === "blocked" ? "Needs attention" : "—"}
          color={
            (project.priority || "").toUpperCase() === "HIGH" || (project.priority || "").toUpperCase() === "URGENT"
              ? "hsl(var(--kf-error))"
              : (project.priority || "").toUpperCase() === "LOW"
                ? "hsl(var(--muted-foreground))"
                : "hsl(var(--kf-accent1))"
          }
          icon={AlertTriangle}
        />
        <MetricCard
          label="Due Date"
          value={project.dueDate ? formatDate(project.dueDate) : "Not set"}
          sub={
            project.dueDate && isOverdue(project.dueDate)
              ? "Overdue"
              : daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7
                ? `${daysUntilDue}d left`
                : "—"
          }
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
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Connected Records</h4>
          <div className="space-y-2">
            <LinkedRecord
              icon={User}
              label="Client"
              value={project.contactId ? (clientName || "Loading...") : "No client linked"}
              subValue={clientEmail || undefined}
              linked={!!project.contactId}
              href={project.contactId ? `/app/clients?id=${project.contactId}` : undefined}
            />
            <LinkedRecord
              icon={DollarSign}
              label="Invoice"
              value={project.invoiceId ? `Invoice ${project.invoiceId.slice(0, 8)}...` : "No invoice linked"}
              linked={!!project.invoiceId}
              href={project.invoiceId ? `/app/commerce?tab=invoices&id=${project.invoiceId}` : undefined}
            />
            <LinkedRecord
              icon={Calendar}
              label="Booking"
              value={project.bookingId ? `Booking ${project.bookingId.slice(0, 8)}...` : "No booking linked"}
              linked={!!project.bookingId}
            />
            <LinkedRecord
              icon={Zap}
              label="Flows"
              value="Configure automation flows"
              linked={false}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Task Snapshot</h4>
          {totalTasks === 0 ? (
            <div className="text-center py-4">
              <CheckCircle className="w-5 h-5 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No tasks added yet.</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">Add tasks to start tracking progress.</p>
            </div>
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
            AI Recommendations
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
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

function MetricCard({ label, value, sub, color, icon: Icon, showBar, barPercent, barColor }: {
  label: string; value: string; sub: string; color: string; icon: React.ElementType;
  showBar?: boolean; barPercent?: number; barColor?: string;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3" style={{ color }} />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-lg font-bold capitalize" style={{ color }}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
      {showBar && barPercent !== undefined && (
        <div className="mt-1.5 h-1.5 rounded-full overflow-hidden bg-muted/30">
          <div className="h-full rounded-full transition-all" style={{ width: `${barPercent}%`, background: barColor || color }} />
        </div>
      )}
    </div>
  );
}

function LinkedRecord({ icon: Icon, label, value, subValue, linked, href }: {
  icon: React.ElementType; label: string; value: string; subValue?: string; linked: boolean; href?: string;
}) {
  const content = (
    <div className="flex items-center gap-2 py-1.5 group">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: linked ? "hsl(var(--kf-accent2) / 0.1)" : "hsl(var(--muted) / 0.3)" }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: linked ? "hsl(var(--kf-accent2))" : "hsl(var(--muted-foreground) / 0.4)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider w-14">{label}</span>
          <span className={`text-xs truncate ${linked ? "font-medium" : "text-muted-foreground/60"}`}>{value}</span>
        </div>
        {subValue && (
          <span className="text-[10px] text-muted-foreground/60 ml-[62px]">{subValue}</span>
        )}
      </div>
      {linked && href && (
        <ExternalLink className="w-3 h-3 text-muted-foreground/40 group-hover:text-foreground/60 transition-colors shrink-0" />
      )}
    </div>
  );

  if (linked && href) {
    return <a href={href} className="block hover:bg-muted/10 rounded-lg px-1 -mx-1 transition-colors">{content}</a>;
  }
  return <div className="px-1 -mx-1">{content}</div>;
}
