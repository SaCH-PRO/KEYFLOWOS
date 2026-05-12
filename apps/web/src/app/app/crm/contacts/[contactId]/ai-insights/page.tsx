"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchContactInsightSnapshot, fetchContactMomentum, fetchContactHealthMetrics } from "@/lib/client";
import { Card, Badge } from "@keyflow/ui";
import { Sparkles, TrendingUp, TrendingDown, Minus, Target, MessageSquare, Calendar, DollarSign, AlertTriangle, Zap, Heart } from "lucide-react";

interface MomentumScore {
  score: number;
  previousScore?: number | null;
  trend: string;
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
  engagementScore: number;
  tenureScore: number;
}

interface HealthMetrics {
  engagement: number;
  payment: number;
  responsiveness: number;
  relationship: number;
}

interface InsightSnapshot {
  payload: {
    relationshipSummary: string;
    bestChannel: string | null;
    bestChannelConfidence: number | null;
    bestTimeWindow: { label: string; tz: string } | null;
    dominantTopics: string[];
    lifetimeValue: number;
    currency: string;
    openDeals: { count: number; value: number };
    churnRisk: number;
    churnRiskReason: string;
    suggestedAction: {
      kind: string;
      label: string;
      description: string;
      channel?: string;
    };
  };
}

function ProgressBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function fmtCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export default function ContactAiInsightsPage() {
  const { contactId } = useParams();
  const [insight, setInsight] = useState<InsightSnapshot | null>(null);
  const [momentum, setMomentum] = useState<MomentumScore | null>(null);
  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [insRes, momRes, healthRes] = await Promise.all([
        fetchContactInsightSnapshot(contactId as string),
        fetchContactMomentum(contactId as string),
        fetchContactHealthMetrics(contactId as string),
      ]);
      setInsight(insRes.data ?? null);
      setMomentum(momRes.data ?? null);
      setHealth(healthRes.data ?? null);
      setLoading(false);
    };
    load();
  }, [contactId]);

  if (loading) return <div className="p-4">Loading AI insights...</div>;

  const TrendIcon = momentum?.trend === "rising" ? TrendingUp : momentum?.trend === "falling" ? TrendingDown : Minus;
  const trendColor = momentum?.trend === "rising" ? "text-green-600" : momentum?.trend === "falling" ? "text-red-600" : "text-amber-600";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">AI Insights</h3>
      </div>

      {insight?.payload?.relationshipSummary && (
        <Card className="border-primary/20 bg-primary/5">
          <div className="p-4">
            <p className="text-sm leading-relaxed">{insight.payload.relationshipSummary}</p>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {momentum && (
          <Card>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Momentum</span>
                <TrendIcon className={`h-4 w-4 ${trendColor}`} />
              </div>
              <p className="mt-1 text-2xl font-bold">{momentum.score}</p>
              <p className={`text-xs capitalize ${trendColor}`}>{momentum.trend}</p>
            </div>
          </Card>
        )}
        {insight?.payload?.churnRisk !== undefined && (
          <Card>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Churn Risk</span>
                <AlertTriangle className={`h-4 w-4 ${insight.payload.churnRisk > 50 ? "text-red-600" : "text-green-600"}`} />
              </div>
              <p className="mt-1 text-2xl font-bold">{insight.payload.churnRisk}%</p>
              <p className="text-xs text-muted-foreground">{insight.payload.churnRiskReason}</p>
            </div>
          </Card>
        )}
        {insight?.payload?.lifetimeValue !== undefined && (
          <Card>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Lifetime Value</span>
                <DollarSign className="h-4 w-4 text-green-600" />
              </div>
              <p className="mt-1 text-2xl font-bold">{fmtCurrency(insight.payload.lifetimeValue, insight.payload.currency)}</p>
            </div>
          </Card>
        )}
        {insight?.payload?.openDeals && (
          <Card>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Open Deals</span>
                <Target className="h-4 w-4 text-blue-600" />
              </div>
              <p className="mt-1 text-2xl font-bold">{insight.payload.openDeals.count}</p>
              <p className="text-xs text-muted-foreground">
                {fmtCurrency(insight.payload.openDeals.value, insight.payload.currency)}
              </p>
            </div>
          </Card>
        )}
      </div>

      {health && (
        <Card>
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Heart className="h-4 w-4 text-rose-500" />
              Health Metrics
            </div>
            <div className="space-y-3">
              {[
                { label: "Engagement", value: health.engagement, color: "bg-blue-500" },
                { label: "Payment", value: health.payment, color: "bg-green-500" },
                { label: "Responsiveness", value: health.responsiveness, color: "bg-amber-500" },
                { label: "Relationship", value: health.relationship, color: "bg-purple-500" },
              ].map((h) => (
                <div key={h.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{h.label}</span>
                    <span className="font-medium">{h.value}/100</span>
                  </div>
                  <ProgressBar value={h.value} color={h.color} />
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {momentum && (
        <Card>
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Zap className="h-4 w-4 text-amber-500" />
              Momentum Breakdown
            </div>
            <div className="space-y-3">
              {[
                { label: "Recency", value: momentum.recencyScore, color: "bg-sky-500" },
                { label: "Frequency", value: momentum.frequencyScore, color: "bg-indigo-500" },
                { label: "Monetary", value: momentum.monetaryScore, color: "bg-emerald-500" },
                { label: "Engagement", value: momentum.engagementScore, color: "bg-rose-500" },
                { label: "Tenure", value: momentum.tenureScore, color: "bg-violet-500" },
              ].map((m) => (
                <div key={m.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{m.label}</span>
                    <span className="font-medium">{m.value}/100</span>
                  </div>
                  <ProgressBar value={m.value} color={m.color} />
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {insight?.payload?.bestChannel && (
        <Card>
          <div className="flex items-center gap-3 p-4">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-sm font-medium">Best Communication Channel</p>
              <p className="text-sm text-muted-foreground capitalize">
                {insight.payload.bestChannel}
                {insight.payload.bestChannelConfidence && ` (${Math.round(insight.payload.bestChannelConfidence * 100)}% confidence)`}
              </p>
            </div>
          </div>
        </Card>
      )}

      {insight?.payload?.bestTimeWindow && (
        <Card>
          <div className="flex items-center gap-3 p-4">
            <Calendar className="h-5 w-5 text-purple-600" />
            <div>
              <p className="text-sm font-medium">Best Time Window</p>
              <p className="text-sm text-muted-foreground">
                {insight.payload.bestTimeWindow.label} ({insight.payload.bestTimeWindow.tz})
              </p>
            </div>
          </div>
        </Card>
      )}

      {insight?.payload?.dominantTopics && insight.payload.dominantTopics.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Dominant Topics</h4>
          <div className="flex flex-wrap gap-2">
            {insight.payload.dominantTopics.map((topic) => (
              <Badge key={topic} tone="info">{topic}</Badge>
            ))}
          </div>
        </div>
      )}

      {insight?.payload?.suggestedAction && (
        <Card className="border-amber-200 bg-amber-50">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-amber-600" />
              <div>
                <p className="text-sm font-medium">Suggested Action</p>
                <p className="text-sm text-muted-foreground">{insight.payload.suggestedAction.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{insight.payload.suggestedAction.description}</p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
