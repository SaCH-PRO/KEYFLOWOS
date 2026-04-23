export const PROJECT_STAGES = [
  { key: "NOT_STARTED", label: "Not Started", color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.3)" },
  { key: "IN_PROGRESS", label: "In Progress", color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.1)" },
  { key: "WAITING_ON_CLIENT", label: "Waiting on Client", color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" },
  { key: "REVIEW", label: "Review", color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.1)" },
  { key: "BLOCKED", label: "Blocked", color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.1)" },
  { key: "COMPLETED", label: "Completed", color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.1)" },
] as const;

export const ALL_PROJECT_STAGES = [
  ...PROJECT_STAGES,
  { key: "ARCHIVED", label: "Archived", color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.2)" },
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number]["key"];

export const LEGACY_STATUS_MAP: Record<string, string> = {
  ACTIVE: "NOT_STARTED",
  ON_HOLD: "BLOCKED",
};

export function normalizeStatus(status: string): string {
  return LEGACY_STATUS_MAP[status] ?? status;
}

export function getStageInfo(status: string) {
  const normalized = normalizeStatus(status);
  return ALL_PROJECT_STAGES.find((s) => s.key === normalized) ?? PROJECT_STAGES[0];
}

export const PROJECT_COLORS = [
  "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e", "#eab308", "#ec4899", "#6366f1",
];

export const PROJECT_PRIORITIES = [
  { key: "LOW", label: "Low", color: "hsl(var(--muted-foreground))" },
  { key: "NORMAL", label: "Normal", color: "hsl(var(--kf-info))" },
  { key: "HIGH", label: "High", color: "hsl(var(--kf-warning))" },
  { key: "URGENT", label: "Urgent", color: "hsl(var(--kf-error))" },
] as const;

export function isOverdue(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export function isDueSoon(dateStr?: string | null, daysAhead = 7): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);
  cutoff.setHours(23, 59, 59, 999);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d >= today && d <= cutoff;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function getProjectProgress(tasks: { isCompleted: boolean }[]): number {
  if (!tasks || tasks.length === 0) return 0;
  return Math.round((tasks.filter((t) => t.isCompleted).length / tasks.length) * 100);
}

export function getProjectRisk(project: {
  status: string;
  dueDate?: string | null;
  tasks?: { isCompleted: boolean; dueDate?: string | null }[];
}): "healthy" | "at-risk" | "critical" | "blocked" {
  const status = normalizeStatus(project.status);
  if (status === "BLOCKED") return "blocked";
  if (status === "COMPLETED") return "healthy";

  const overdue = isOverdue(project.dueDate);
  if (overdue && status !== "COMPLETED") return "critical";

  const overdueTasks = (project.tasks ?? []).filter(
    (t) => !t.isCompleted && isOverdue(t.dueDate)
  ).length;
  if (overdueTasks > 0) return "at-risk";

  const progress = getProjectProgress(project.tasks ?? []);
  if (progress < 30 && isDueSoon(project.dueDate, 3)) return "at-risk";

  return "healthy";
}

export const RISK_STYLES = {
  healthy: { label: "On Track", color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.1)" },
  "at-risk": { label: "At Risk", color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" },
  critical: { label: "Overdue", color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.1)" },
  blocked: { label: "Blocked", color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.1)" },
};
