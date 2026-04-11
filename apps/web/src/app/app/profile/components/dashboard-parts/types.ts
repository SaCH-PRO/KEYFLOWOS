export interface CategoryScores {
  clarity?: number;
  readiness?: number;
  profitability?: number;
  operations?: number;
  growth?: number;
  risk?: number;
  safety?: number;
  [key: string]: number | undefined;
}

export interface Metrics {
  monthlyRevenueEstimate?: number;
  revenueSource?: string;
  grossProfit?: number;
  totalMonthlyOperatingCosts?: number;
  netOperatingProfit?: number;
  taxAdjustedProfit?: number;
  contributionMarginPerUnit?: number;
  contributionMarginPct?: number;
  breakEvenVolume?: number | null;
  breakEvenRevenue?: number | null;
  runwayMonths?: number | null;
  runwayLabel?: string;
  profitMarginPct?: number;
  monthlyTargetVolume?: number | null;
  repeatCustomerPct?: number | null;
  leadCount?: number | null;
  conversionRate?: number | null;
  [key: string]: number | string | null | undefined;
}

export interface AssessmentResult {
  id: string;
  overallScore: number | null;
  categoryScores: CategoryScores | null;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  opportunities: string[];
  metrics: Metrics | null;
  flags: string[];
  version: number;
  createdAt: string;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  urgency?: string;
  impact?: string;
  effort?: string;
  status: string;
  rationale?: string;
  suggestedAction?: string;
  impactLevel?: string;
  estimatedDifficulty?: string;
  actionUrl?: string | null;
  triggerScoreKey?: string;
}

export interface RoadmapItem {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  sequenceOrder?: number;
  orderIndex?: number;
  actionTitle?: string;
  whyItMatters?: string;
  expectedOutcome?: string;
  linkedScoreArea?: string;
  estimatedDays?: number;
  status: string;
}

export interface ProgressSnapshot {
  id: string;
  overallScore: number | null;
  categoryScores: CategoryScores | null;
  completedRecommendations: number;
  totalRecommendations: number;
  completedRoadmapItems: number;
  totalRoadmapItems: number;
  snapshotDate: string;
}

export interface DashboardData {
  status: string;
  latestAssessment: AssessmentResult | null;
  topRecommendations: Recommendation[];
  nextRoadmapItems: RoadmapItem[];
  progressHistory: ProgressSnapshot[];
}

export const DIMENSION_MAP: Record<string, { label: string; key: string }> = {
  clarity: { label: "Business Clarity", key: "clarity" },
  readiness: { label: "Readiness", key: "readiness" },
  profitability: { label: "Profitability", key: "profitability" },
  operations: { label: "Operational Maturity", key: "operations" },
  growth: { label: "Growth", key: "growth" },
  risk: { label: "Risk & Safety", key: "risk" },
  safety: { label: "Safety & Compliance", key: "safety" },
};

export function getDimensionScore(scores: CategoryScores | null, key: string): number | null {
  if (!scores) return null;
  const val = scores[key];
  return val !== undefined && val !== null ? Math.round(val) : null;
}

export function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score < 40) return "text-red-400";
  if (score < 70) return "text-amber-400";
  return "text-emerald-400";
}

export function scoreBg(score: number | null): string {
  if (score === null) return "bg-muted/20";
  if (score < 40) return "bg-red-500/15";
  if (score < 70) return "bg-amber-500/15";
  return "bg-emerald-500/15";
}

export function scoreBarColor(score: number | null): string {
  if (score === null) return "hsl(var(--muted))";
  if (score < 40) return "hsl(var(--kf-error))";
  if (score < 70) return "hsl(var(--kf-warning))";
  return "hsl(var(--kf-success))";
}

export function scoreLabel(score: number | null): string {
  if (score === null) return "No data";
  if (score < 40) return "Needs attention";
  if (score < 70) return "On track";
  return "Strong";
}

export function formatTTD(value: number | undefined | null): string {
  if (value === undefined || value === null) return "N/A";
  return `TTD $${value.toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function severityBadge(severity: string) {
  const s = severity.toLowerCase();
  if (s === "critical") return { bg: "bg-red-500/20", text: "text-red-400", label: "Critical" };
  if (s === "high") return { bg: "bg-orange-500/20", text: "text-orange-400", label: "High" };
  if (s === "medium") return { bg: "bg-amber-500/20", text: "text-amber-400", label: "Medium" };
  return { bg: "bg-muted/30", text: "text-muted-foreground", label: "Low" };
}

export function priorityToSeverity(priority: string): string {
  const p = priority.toUpperCase();
  if (p === "CRITICAL") return "critical";
  if (p === "HIGH") return "high";
  if (p === "MEDIUM") return "medium";
  return "low";
}

export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};
