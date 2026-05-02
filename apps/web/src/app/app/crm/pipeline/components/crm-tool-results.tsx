"use client";

import {
  Heart,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Minus,
  Lightbulb,
  Target,
  MessageSquare,
  Tags,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Users,
  Mail,
  Copy,
  DollarSign,
  Send,
} from "lucide-react";
import { useState } from "react";

const SENTIMENT_ICONS: Record<string, typeof Heart> = {
  positive: CheckCircle,
  neutral: Minus,
  negative: TrendingDown,
  at_risk: AlertTriangle,
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-emerald-400",
  neutral: "text-blue-400",
  negative: "text-red-400",
  at_risk: "text-amber-400",
};

const HEALTH_COLORS: Record<string, string> = {
  strong: "text-emerald-400",
  good: "text-green-400",
  neutral: "text-blue-400",
  weak: "text-amber-400",
  critical: "text-red-400",
};

const SCORE_CONFIG: Record<string, { color: string; bg: string }> = {
  Hot: { color: "text-red-400", bg: "bg-red-500/10" },
  Warm: { color: "text-orange-400", bg: "bg-orange-500/10" },
  Neutral: { color: "text-blue-400", bg: "bg-blue-500/10" },
  Cool: { color: "text-cyan-400", bg: "bg-cyan-500/10" },
  Cold: { color: "text-slate-400", bg: "bg-slate-500/10" },
};


interface SummaryData {
  sentiment?: string; relationshipHealth?: string; summary?: string;
  keyInsights?: string[]; recommendedAction?: string;
}
type ScoreFactor = { factor?: string; impact?: string; weight?: number };
interface LeadScoreData {
  score?: number; label?: string; reasoning?: string; factors?: ScoreFactor[];
}
interface PrepBriefData {
  relationshipHealth?: string; keyInfo?: string[]; talkingPoints?: string[];
  icebreakers?: string[]; thingsToAvoid?: string[];
}
type TagSuggestion = { tag?: string; reason?: string; confidence?: number };
interface TagSuggestionsData { suggestedTags?: TagSuggestion[] }
type AtRiskContact = { name?: string; riskLevel?: string; probability?: number; reasons?: string[] };
interface ChurnDetectionData {
  summary?: string; estimatedRevenueLoss?: number | string;
  atRiskContacts?: AtRiskContact[];
}
type SuggestedAction = { title?: string; description?: string };
interface AnalysisData {
  analysis?: string; suggestedActions?: SuggestedAction[]; guidelines?: string[];
}
type FieldBreakdown = { field?: string; missing?: number; percentage?: number };
type TopIssueItem = { contactName?: string; completeness?: number; missingFields?: string[] };
interface DataQualityData {
  averageCompleteness?: number; totalContacts?: number; contactsWithIssues?: number;
  fieldBreakdown?: FieldBreakdown[]; topIssues?: TopIssueItem[];
}
type DuplicateContact = { name?: string; email?: string };
type DuplicateCluster = { reason?: string; confidence?: number; contacts?: DuplicateContact[] };
interface DuplicateFinderData {
  duplicateClusters?: DuplicateCluster[]; estimatedDuplicates?: number;
}
type ReengagementSuggestion = {
  contactName?: string; urgency?: string; daysSinceLastInteraction?: number;
  recommendedAction?: string; suggestedSequence?: string;
};
interface ReengagementData { totalStale?: number; suggestions?: ReengagementSuggestion[] }
type RevenueOpportunity = {
  contactName?: string; estimatedValue?: number | string; opportunityType?: string;
  company?: string; totalRevenue?: number | string;
};
interface RevenueOpportunitiesData {
  totalEstimatedRevenue?: number | string; contactsAnalyzed?: number;
  opportunities?: RevenueOpportunity[];
}
type FollowUpMessage = { channel?: string; tone?: string; subject?: string; body?: string };
interface FollowUpDraftData {
  contactName?: string; context?: string; messages?: FollowUpMessage[]; bestTime?: string;
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-border/30 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      >
        <span className="text-[11px] font-semibold text-foreground/80">{title}</span>
        {open ? <ChevronUp className="w-3 h-3 text-muted-foreground/50" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/50" />}
      </button>
      {open && <div className="px-3 py-2.5">{children}</div>}
    </div>
  );
}

function SummaryResult({ data }: { data: SummaryData | null }) {
  if (!data) return null;
  const SentIcon = SENTIMENT_ICONS[data.sentiment ?? ""] || Minus;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <SentIcon className={`w-3.5 h-3.5 ${SENTIMENT_COLORS[data.sentiment ?? ""] || "text-muted-foreground"}`} />
          <span className={`text-xs font-medium ${SENTIMENT_COLORS[data.sentiment ?? ""] || "text-muted-foreground"}`}>
            {data.sentiment?.replace("_", " ")}
          </span>
        </div>
        {data.relationshipHealth && (
          <span className={`text-xs ${HEALTH_COLORS[data.relationshipHealth ?? ""] || "text-muted-foreground"}`}>
            Health: {data.relationshipHealth}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      {Array.isArray(data.keyInsights) && data.keyInsights.length > 0 && (
        <Section title="Key Insights">
          <ul className="space-y-1">
            {data.keyInsights.map((i: string, idx: number) => (
              <li key={idx} className="flex items-start gap-1.5">
                <Lightbulb className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-[11px] text-muted-foreground/70">{i}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {data.recommendedAction && (
        <div className="px-3 py-2 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/20">
          <span className="text-[11px] text-[hsl(var(--kf-accent1))]">{data.recommendedAction}</span>
        </div>
      )}
    </div>
  );
}

function LeadScoreResult({ data }: { data: LeadScoreData | null }) {
  if (!data) return null;
  const cfg = SCORE_CONFIG[data.label ?? ""] || SCORE_CONFIG.Neutral;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className="text-white/5" strokeWidth="4" />
            <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className={cfg.color} strokeWidth="4"
              strokeDasharray={`${((data.score ?? 0) / 100) * 176} 176`} strokeLinecap="round" />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${cfg.color}`}>
            {data.score}
          </span>
        </div>
        <div>
          <span className={`text-sm font-semibold ${cfg.color}`}>{data.label}</span>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">{data.reasoning}</p>
        </div>
      </div>
      {Array.isArray(data.factors) && data.factors.length > 0 && (
        <Section title="Score Factors">
          <div className="space-y-1.5">
            {data.factors.map((f: ScoreFactor, i: number) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground/70">{f.factor}</span>
                <div className="flex items-center gap-1.5">
                  {f.impact === "positive" ? <TrendingUp className="w-3 h-3 text-emerald-400" /> :
                    f.impact === "negative" ? <TrendingDown className="w-3 h-3 text-red-400" /> :
                    <Minus className="w-3 h-3 text-muted-foreground/50" />}
                  <span className="text-[10px] text-muted-foreground/50">w:{f.weight}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PrepBriefResult({ data }: { data: PrepBriefData | null }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.relationshipHealth && (
        <div className="flex items-center gap-2 mb-2">
          <Heart className={`w-3.5 h-3.5 ${HEALTH_COLORS[data.relationshipHealth ?? ""] || "text-muted-foreground"}`} />
          <span className={`text-xs font-medium ${HEALTH_COLORS[data.relationshipHealth ?? ""] || "text-muted-foreground"}`}>
            {data.relationshipHealth} relationship
          </span>
        </div>
      )}
      {Array.isArray(data.keyInfo) && data.keyInfo.length > 0 && (
        <Section title="Key Info">
          <ul className="space-y-1">
            {data.keyInfo.map((i: string, idx: number) => (
              <li key={idx} className="text-[11px] text-muted-foreground/70 flex items-start gap-1.5">
                <FileText className="w-3 h-3 text-blue-400 shrink-0 mt-0.5" />
                {i}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {Array.isArray(data.talkingPoints) && data.talkingPoints.length > 0 && (
        <Section title="Talking Points">
          <ul className="space-y-1">
            {data.talkingPoints.map((p: string, idx: number) => (
              <li key={idx} className="text-[11px] text-muted-foreground/70 flex items-start gap-1.5">
                <MessageSquare className="w-3 h-3 text-[hsl(var(--kf-accent1))] shrink-0 mt-0.5" />
                {p}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {Array.isArray(data.icebreakers) && data.icebreakers.length > 0 && (
        <Section title="Icebreakers">
          <ul className="space-y-1">
            {data.icebreakers.map((i: string, idx: number) => (
              <li key={idx} className="text-[11px] text-muted-foreground/70">&quot;{i}&quot;</li>
            ))}
          </ul>
        </Section>
      )}
      {Array.isArray(data.thingsToAvoid) && data.thingsToAvoid.length > 0 && (
        <Section title="Avoid">
          <ul className="space-y-1">
            {data.thingsToAvoid.map((a: string, idx: number) => (
              <li key={idx} className="text-[11px] text-red-400/70 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                {a}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function TagSuggestionsResult({ data }: { data: TagSuggestionsData | null }) {
  if (!data?.suggestedTags) return null;
  return (
    <div className="space-y-2">
      {data.suggestedTags.map((tag: TagSuggestion, i: number) => (
        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-border/30">
          <div className="flex items-center gap-2">
            <Tags className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
            <span className="text-xs font-medium text-foreground/80">{tag.tag}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/50">{tag.reason}</span>
            <span className={`text-[10px] font-medium ${(tag.confidence ?? 0) >= 0.8 ? "text-emerald-400" : (tag.confidence ?? 0) >= 0.6 ? "text-blue-400" : "text-amber-400"}`}>
              {Math.round((tag.confidence ?? 0) * 100)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChurnDetectionResult({ data }: { data: ChurnDetectionData | null }) {
  if (!data) return null;
  const RISK_COLORS: Record<string, string> = {
    critical: "text-red-400",
    high: "text-amber-400",
    medium: "text-yellow-400",
  };
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70">{data.summary}</p>
      )}
      {data.estimatedRevenueLoss && (
        <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
          <span className="text-xs text-red-400">Estimated revenue at risk: ${data.estimatedRevenueLoss}</span>
        </div>
      )}
      {Array.isArray(data.atRiskContacts) && data.atRiskContacts.length > 0 && (
        <Section title={`At-Risk Contacts (${data.atRiskContacts.length})`}>
          <div className="space-y-2">
            {data.atRiskContacts.map((c: AtRiskContact, i: number) => (
              <div key={i} className="p-2 rounded-lg border border-border/30 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground/80">{c.name}</span>
                  <span className={`text-[10px] font-bold ${RISK_COLORS[c.riskLevel ?? ""] || "text-muted-foreground"}`}>
                    {c.probability}% risk
                  </span>
                </div>
                {Array.isArray(c.reasons) && c.reasons.length > 0 && (
                  <ul className="space-y-0.5">
                    {c.reasons.slice(0, 3).map((r: string, ri: number) => (
                      <li key={ri} className="text-[10px] text-muted-foreground/60">• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function AnalysisResult({ data }: { data: AnalysisData | null }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.analysis && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.analysis}</p>
      )}
      {Array.isArray(data.suggestedActions) && data.suggestedActions.length > 0 && (
        <Section title="Recommended Actions">
          <div className="space-y-1.5">
            {data.suggestedActions.map((a: SuggestedAction, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Target className="w-3 h-3 text-[hsl(var(--kf-accent1))] shrink-0 mt-0.5" />
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{a.title || a.description}</span>
                  {a.description && a.title && (
                    <p className="text-[10px] text-muted-foreground/60">{a.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {Array.isArray(data.guidelines) && data.guidelines.length > 0 && (
        <Section title="Guidelines">
          <ul className="space-y-1">
            {data.guidelines.map((g: string, i: number) => (
              <li key={i} className="text-[11px] text-muted-foreground/70 flex items-start gap-1.5">
                <Lightbulb className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                {g}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function DataQualityResult({ data }: { data: DataQualityData | null }) {
  if (!data) return null;
  const score = data.averageCompleteness ?? 0;
  const scoreColor = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-red-400";
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" className="text-white/5" strokeWidth="4" />
            <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" className={scoreColor} strokeWidth="4"
              strokeDasharray={`${(score / 100) * 151} 151`} strokeLinecap="round" />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${scoreColor}`}>
            {score}%
          </span>
        </div>
        <div>
          <span className={`text-sm font-semibold ${scoreColor}`}>Avg Completeness</span>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            {data.totalContacts} scanned · {data.contactsWithIssues} with issues
          </p>
        </div>
      </div>
      {Array.isArray(data.fieldBreakdown) && data.fieldBreakdown.length > 0 && (
        <Section title="Field Breakdown">
          <div className="space-y-1.5">
            {data.fieldBreakdown.map((fb: FieldBreakdown, i: number) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground/70 capitalize">{fb.field}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/50">{fb.missing} missing</span>
                  <span className={`text-[10px] font-medium ${(fb.percentage ?? 0) > 30 ? "text-red-400" : (fb.percentage ?? 0) > 15 ? "text-amber-400" : "text-emerald-400"}`}>
                    {fb.percentage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {Array.isArray(data.topIssues) && data.topIssues.length > 0 && (
        <Section title={`Contacts with Issues (${data.topIssues.length})`}>
          <div className="space-y-1.5">
            {data.topIssues.slice(0, 10).map((issue: TopIssueItem, i: number) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${(issue.completeness ?? 0) < 40 ? "text-red-400" : (issue.completeness ?? 0) < 70 ? "text-amber-400" : "text-blue-400"}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-foreground/80">{issue.contactName}</span>
                    <span className="text-[10px] text-muted-foreground/50">{issue.completeness}%</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60">Missing: {(issue.missingFields ?? []).join(', ')}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function DuplicateFinderResult({ data }: { data: DuplicateFinderData | null }) {
  if (!data) return null;
  const clusters = data.duplicateClusters ?? [];
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 mb-1">
        <Copy className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-semibold text-foreground/80">
          {clusters.length} potential duplicate groups · {data.estimatedDuplicates ?? 0} duplicates
        </span>
      </div>
      {Array.isArray(clusters) && clusters.length > 0 && (
        <div className="space-y-2">
          {clusters.slice(0, 10).map((cluster: DuplicateCluster, i: number) => (
            <div key={i} className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-amber-400">
                  {cluster.reason} ({Math.round((cluster.confidence ?? 0.8) * 100)}%)
                </span>
              </div>
              <div className="space-y-1">
                {cluster.contacts?.map((c: DuplicateContact, ci: number) => (
                  <div key={ci} className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                    <Users className="w-3 h-3 shrink-0" />
                    <span>{c.name}</span>
                    {c.email && <span className="text-muted-foreground/50">({c.email})</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {clusters.length === 0 && (
        <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <span className="text-[11px] text-emerald-400 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" /> No duplicates detected — your database is clean
          </span>
        </div>
      )}
    </div>
  );
}

function ReengagementResult({ data }: { data: ReengagementData | null }) {
  if (!data) return null;
  const suggestions = data.suggestions ?? [];
  const URGENCY_COLORS: Record<string, string> = { high: "text-red-400", medium: "text-amber-400", low: "text-blue-400" };
  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-muted-foreground/70">
        {data.totalStale} stale contacts found
      </p>
      {suggestions.length > 0 && (
        <Section title={`Re-engagement Suggestions (${suggestions.length})`}>
          <div className="space-y-2">
            {suggestions.slice(0, 8).map((s: ReengagementSuggestion, i: number) => (
              <div key={i} className="p-2 rounded-lg border border-border/30 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground/80">{s.contactName}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-medium ${URGENCY_COLORS[s.urgency ?? ""] || "text-muted-foreground"}`}>
                      {s.urgency}
                    </span>
                    {s.daysSinceLastInteraction != null && (
                      <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {s.daysSinceLastInteraction}d
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-[hsl(var(--kf-accent1))]">{s.recommendedAction}</p>
                {s.suggestedSequence && (
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">Sequence: {s.suggestedSequence}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function RevenueOpportunitiesResult({ data }: { data: RevenueOpportunitiesData | null }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        {data.totalEstimatedRevenue != null && (
          <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 flex-1">
            <span className="text-xs text-emerald-400 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" />
              Estimated pipeline: TTD {Number(data.totalEstimatedRevenue).toLocaleString()}
            </span>
          </div>
        )}
        <span className="text-[10px] text-muted-foreground/50 ml-2">{data.contactsAnalyzed} analyzed</span>
      </div>
      {Array.isArray(data.opportunities) && data.opportunities.length > 0 && (
        <Section title={`Opportunities (${data.opportunities.length})`}>
          <div className="space-y-2">
            {data.opportunities.slice(0, 8).map((opp: RevenueOpportunity, i: number) => (
              <div key={i} className="p-2 rounded-lg border border-border/30 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground/80">{opp.contactName}</span>
                  <span className="text-[10px] font-medium text-emerald-400">TTD {Number(opp.estimatedValue || 0).toLocaleString()}</span>
                </div>
                <p className="text-[10px] text-[hsl(var(--kf-accent1))]">{opp.opportunityType}</p>
                {opp.company && (
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">{opp.company} · Revenue: TTD {Number(opp.totalRevenue || 0).toLocaleString()}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function FollowUpDraftResult({ data }: { data: FollowUpDraftData | null }) {
  if (!data) return null;
  const messages = data.messages ?? [];
  return (
    <div className="space-y-2.5">
      {data.contactName && (
        <div className="flex items-center gap-2 mb-1">
          <Send className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          <span className="text-xs font-medium text-foreground/80">
            Follow-up for {data.contactName}
          </span>
        </div>
      )}
      {data.context && (
        <p className="text-[11px] text-muted-foreground/70 italic">{data.context}</p>
      )}
      {messages.map((msg: FollowUpMessage, i: number) => (
        <div key={i} className="rounded-lg border border-border/30 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-border/20">
            {msg.channel === "email" ? <Mail className="w-3 h-3 text-blue-400" /> :
             <MessageSquare className="w-3 h-3 text-emerald-400" />}
            <span className="text-[10px] font-medium text-foreground/70 capitalize">{msg.tone}</span>
            <span className="text-[10px] text-muted-foreground/40">· {msg.channel}</span>
          </div>
          {msg.subject && (
            <div className="px-3 py-1.5 border-b border-border/10">
              <span className="text-[10px] text-muted-foreground/50">Subject: </span>
              <span className="text-[11px] text-foreground/80">{msg.subject}</span>
            </div>
          )}
          <div className="px-3 py-2">
            <p className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap leading-relaxed">{msg.body}</p>
          </div>
        </div>
      ))}
      {data.bestTime && (
        <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
          <Clock className="w-3 h-3" /> Best time: {data.bestTime}
        </span>
      )}
    </div>
  );
}

export function renderCrmToolResult(toolId: string, result: unknown): React.ReactNode {
  switch (toolId) {
    case "contact-summary":
      return <SummaryResult data={result as SummaryData | null} />;
    case "lead-score":
      return <LeadScoreResult data={result as LeadScoreData | null} />;
    case "prep-brief":
      return <PrepBriefResult data={result as PrepBriefData | null} />;
    case "tag-suggestions":
      return <TagSuggestionsResult data={result as TagSuggestionsData | null} />;
    case "churn-detection":
      return <ChurnDetectionResult data={result as ChurnDetectionData | null} />;
    case "crm-analysis":
      return <AnalysisResult data={result as AnalysisData | null} />;
    case "data-quality":
      return <DataQualityResult data={result as DataQualityData | null} />;
    case "duplicate-finder":
      return <DuplicateFinderResult data={result as DuplicateFinderData | null} />;
    case "reengagement":
      return <ReengagementResult data={result as ReengagementData | null} />;
    case "revenue-opportunities":
      return <RevenueOpportunitiesResult data={result as RevenueOpportunitiesData | null} />;
    case "follow-up-drafter":
      return <FollowUpDraftResult data={result as FollowUpDraftData | null} />;
    default:
      return (
        <div className="rounded-xl border border-border/40 p-3 bg-white/[0.02]">
          <pre className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap overflow-auto max-h-[300px]">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      );
  }
}
