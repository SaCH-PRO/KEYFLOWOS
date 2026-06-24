"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Landmark,
  Loader2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Lightbulb,
  Plus,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  computeGenomeFinanceSnapshot,
  generateGenomeFinanceRecommendations,
  generateGenomeFinanceSignals,
  getGenomeFinanceSnapshot,
  upsertGenomeFinancialMetric,
  type GenomeFinanceRiskLevel,
  type GenomeFinanceSnapshotData,
  type GenomeFinancialMetricType,
} from "@/lib/api/business-genome";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

const METRIC_TYPES: GenomeFinancialMetricType[] = [
  "REVENUE",
  "GROSS_PROFIT",
  "NET_PROFIT",
  "CASH_ON_HAND",
  "MONTHLY_EXPENSE",
  "ACCOUNTS_RECEIVABLE",
  "ACCOUNTS_PAYABLE",
  "TAX_RESERVE",
  "AVERAGE_ORDER_VALUE",
];

function formatMetricType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function riskBadge(riskLevel: GenomeFinanceRiskLevel) {
  switch (riskLevel) {
    case "LOW":
      return <StatusBadge status="success" label="Low" />;
    case "MEDIUM":
      return <StatusBadge status="warning" label="Medium" />;
    case "HIGH":
      return <StatusBadge status="error" label="High" />;
    case "CRITICAL":
      return <StatusBadge status="error" label="Critical" />;
    default:
      return <StatusBadge status="neutral" label="Unknown" />;
  }
}

interface KeyGenomeFinancePanelProps {
  onGenomeUpdate?: () => void;
}

export function KeyGenomeFinancePanel({ onGenomeUpdate }: KeyGenomeFinancePanelProps) {
  const [snapshot, setSnapshot] = useState<GenomeFinanceSnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [generatingSignals, setGeneratingSignals] = useState(false);
  const [generatingRecommendations, setGeneratingRecommendations] = useState(false);
  const [addingMetric, setAddingMetric] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [metricType, setMetricType] = useState<GenomeFinancialMetricType>("REVENUE");
  const [metricValue, setMetricValue] = useState("");
  const [metricPeriod, setMetricPeriod] = useState("");

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await getGenomeFinanceSnapshot(businessId);
    if (result.error || !result.data) {
      setError(result.error || "Failed to load finance snapshot");
    } else {
      setSnapshot(result.data);
      setError(null);
    }
    setLoading(false);
  }, [businessId]);

  const handleCompute = useCallback(async () => {
    if (!businessId) return;
    setComputing(true);
    const result = await computeGenomeFinanceSnapshot(businessId);
    if (result.error || !result.data) {
      setError(result.error || "Failed to compute finance snapshot");
    } else {
      setSnapshot(result.data);
      setError(null);
      onGenomeUpdate?.();
    }
    setComputing(false);
  }, [businessId, onGenomeUpdate]);

  const handleGenerateSignals = useCallback(async () => {
    if (!businessId) return;
    setGeneratingSignals(true);
    const result = await generateGenomeFinanceSignals(businessId);
    if (result.error) {
      setError(result.error);
    } else {
      onGenomeUpdate?.();
    }
    setGeneratingSignals(false);
  }, [businessId, onGenomeUpdate]);

  const handleGenerateRecommendations = useCallback(async () => {
    if (!businessId) return;
    setGeneratingRecommendations(true);
    const result = await generateGenomeFinanceRecommendations(businessId);
    if (result.error) {
      setError(result.error);
    } else {
      onGenomeUpdate?.();
    }
    setGeneratingRecommendations(false);
  }, [businessId, onGenomeUpdate]);

  const handleAddMetric = useCallback(async () => {
    if (!businessId || metricValue === "") return;
    setAddingMetric(true);
    const result = await upsertGenomeFinancialMetric(businessId, {
      metricType,
      value: Number(metricValue),
      period: metricPeriod || null,
    });
    if (result.error || !result.data) {
      setError(result.error || "Failed to add metric");
    } else {
      setMetricValue("");
      setMetricPeriod("");
      await handleCompute();
    }
    setAddingMetric(false);
  }, [businessId, handleCompute, metricPeriod, metricType, metricValue]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of finance genome
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Error loading finance genome"
        description={error}
        actionLabel="Retry"
        onAction={refresh}
      />
    );
  }

  if (!snapshot) {
    return (
      <EmptyState
        icon={Landmark}
        title="No finance genome yet"
        description="Record financial metrics and compute a snapshot to see cash-flow, margin, and runway health."
        actionLabel="Compute snapshot"
        onAction={handleCompute}
      />
    );
  }

  return (
    <motion.div {...fade} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Finance Genome
          </h3>
          <p className="text-sm text-muted-foreground">
            Health {snapshot.healthScore}% · overall risk {snapshot.overallRisk.toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleGenerateSignals} disabled={generatingSignals} size="sm" variant="outline">
            {generatingSignals ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TrendingUp className="mr-2 h-4 w-4" />}
            Signals
          </Button>
          <Button
            onClick={handleGenerateRecommendations}
            disabled={generatingRecommendations}
            size="sm"
            variant="outline"
          >
            {generatingRecommendations ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lightbulb className="mr-2 h-4 w-4" />}
            Recommendations
          </Button>
          <Button onClick={handleCompute} disabled={computing} size="sm">
            {computing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Recompute
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Health" value={`${snapshot.healthScore}%`} icon={TrendingUp} />
        <MetricCard label="Runway" value={snapshot.runwayMonths != null ? `${snapshot.runwayMonths.toFixed(1)} mo` : "—"} icon={TrendingDown} />
        <MetricCard label="Net margin" value={snapshot.netMarginPercent != null ? `${snapshot.netMarginPercent.toFixed(1)}%` : "—"} icon={TrendingUp} />
        <MetricCard label="Cash on hand" value={snapshot.cashOnHand != null ? `$${snapshot.cashOnHand.toLocaleString()}` : "—"} icon={Landmark} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RiskCard label="Cash-flow risk" risk={snapshot.cashFlowRisk} />
        <RiskCard label="Margin risk" risk={snapshot.marginRisk} />
        <RiskCard label="Pricing risk" risk={snapshot.pricingRisk} />
        <RiskCard label="Tax risk" risk={snapshot.taxRisk} />
      </div>

      {snapshot.warnings.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Warnings
          </div>
          {snapshot.warnings.map((warning, idx) => (
            <div key={idx} className="text-sm flex items-center gap-2">
              {riskBadge(warning.severity)}
              <span className="text-muted-foreground">{warning.message}</span>
            </div>
          ))}
        </div>
      )}

      {snapshot.missingInputs.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="font-medium">Missing inputs</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {snapshot.missingInputs.join(", ")}
          </div>
        </div>
      )}

      {snapshot.recommendations.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="font-medium flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            Recommendations
          </div>
          {snapshot.recommendations.slice(0, 5).map((rec, idx) => (
            <div key={idx} className="text-sm">
              <span className="font-medium">{rec.title}</span>
              <p className="text-muted-foreground">{rec.reason}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="font-medium flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add metric
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="space-y-1">
            <label htmlFor="metric-type" className="text-xs text-muted-foreground">
              Type
            </label>
            <select
              id="metric-type"
              value={metricType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setMetricType(e.target.value as GenomeFinancialMetricType)
              }
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            >
              {METRIC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatMetricType(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="metric-value" className="text-xs text-muted-foreground">
              Value
            </label>
            <input
              id="metric-value"
              type="number"
              value={metricValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMetricValue(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="metric-period" className="text-xs text-muted-foreground">
              Period
            </label>
            <input
              id="metric-period"
              value={metricPeriod}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMetricPeriod(e.target.value)}
              placeholder="2026-06"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={handleAddMetric} disabled={addingMetric || metricValue === ""} size="sm">
            {addingMetric ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function RiskCard({ label, risk }: { label: string; risk: GenomeFinanceRiskLevel }) {
  return (
    <div className="rounded-lg border bg-card p-3 flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      {riskBadge(risk)}
    </div>
  );
}
