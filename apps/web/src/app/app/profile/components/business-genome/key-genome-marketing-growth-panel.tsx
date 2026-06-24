"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Lightbulb,
  Plus,
  Trash2,
  Megaphone,
  Radio,
  Palette,
  Target,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  computeGenomeMarketingGrowthSnapshot,
  createGenomeContentStrategy,
  createGenomeGrowthChannel,
  deleteGenomeContentStrategy,
  deleteGenomeGrowthChannel,
  fetchGenomeContentStrategies,
  fetchGenomeGrowthChannels,
  generateGenomeMarketingGrowthRecommendations,
  generateGenomeMarketingGrowthSignals,
  getGenomeMarketingGrowthSnapshot,
  type GenomeContentStrategy,
  type GenomeGrowthChannel,
  type GenomeMarketingGrowthRecommendation,
  type GenomeMarketingGrowthRiskLevel,
  type GenomeMarketingGrowthSnapshot,
} from "@/lib/api/business-genome";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

const CHANNEL_TYPES: Array<"owned" | "earned" | "paid"> = ["owned", "earned", "paid"];

const CHANNEL_STATUSES: Array<"ACTIVE" | "TESTING" | "PAUSED" | "DEPRECATED"> = [
  "ACTIVE",
  "TESTING",
  "PAUSED",
  "DEPRECATED",
];

function formatType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function riskBadge(riskLevel: GenomeMarketingGrowthRiskLevel) {
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

function channelStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return <StatusBadge status="active" label="Active" />;
    case "TESTING":
      return <StatusBadge status="info" label="Testing" />;
    case "PAUSED":
      return <StatusBadge status="paused" label="Paused" />;
    case "DEPRECATED":
      return <StatusBadge status="neutral" label="Deprecated" />;
    default:
      return <StatusBadge status="neutral" label={status} />;
  }
}

interface KeyGenomeMarketingGrowthPanelProps {
  onGenomeUpdate?: () => void;
}

export function KeyGenomeMarketingGrowthPanel({ onGenomeUpdate }: KeyGenomeMarketingGrowthPanelProps) {
  const [snapshot, setSnapshot] = useState<GenomeMarketingGrowthSnapshot | null>(null);
  const [channels, setChannels] = useState<GenomeGrowthChannel[]>([]);
  const [strategies, setStrategies] = useState<GenomeContentStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [generatingSignals, setGeneratingSignals] = useState(false);
  const [generatingRecommendations, setGeneratingRecommendations] = useState(false);
  const [addingChannel, setAddingChannel] = useState(false);
  const [addingStrategy, setAddingStrategy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [channelKey, setChannelKey] = useState("");
  const [channelLabel, setChannelLabel] = useState("");
  const [channelType, setChannelType] = useState<"owned" | "earned" | "paid">("owned");
  const [channelStatus, setChannelStatus] = useState<"ACTIVE" | "TESTING" | "PAUSED" | "DEPRECATED">("ACTIVE");
  const [channelBudget, setChannelBudget] = useState("");
  const [channelCurrency, setChannelCurrency] = useState("TTD");
  const [channelTargetCac, setChannelTargetCac] = useState("");
  const [channelTargetConversion, setChannelTargetConversion] = useState("");
  const [channelConfidence, setChannelConfidence] = useState("0.5");

  const [strategyPillars, setStrategyPillars] = useState("");
  const [strategyCadence, setStrategyCadence] = useState("");
  const [strategyFormats, setStrategyFormats] = useState("");
  const [strategyDistribution, setStrategyDistribution] = useState("");
  const [strategyConfidence, setStrategyConfidence] = useState("0.5");

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [snapshotRes, channelsRes, strategiesRes] = await Promise.all([
      getGenomeMarketingGrowthSnapshot(businessId),
      fetchGenomeGrowthChannels(businessId),
      fetchGenomeContentStrategies(businessId),
    ]);
    if (snapshotRes.error) {
      setError(snapshotRes.error);
    } else {
      setSnapshot(snapshotRes.data);
      setError(null);
    }
    setChannels(channelsRes.data ?? []);
    setStrategies(strategiesRes.data ?? []);
    setLoading(false);
  }, [businessId]);

  const handleCompute = useCallback(async () => {
    if (!businessId) return;
    setComputing(true);
    const result = await computeGenomeMarketingGrowthSnapshot(businessId);
    if (result.error || !result.data) {
      setError(result.error || "Failed to compute marketing/growth snapshot");
    } else {
      setSnapshot(result.data);
      setError(null);
      onGenomeUpdate?.();
      await refresh();
    }
    setComputing(false);
  }, [businessId, onGenomeUpdate, refresh]);

  const handleGenerateSignals = useCallback(async () => {
    if (!businessId) return;
    setGeneratingSignals(true);
    const result = await generateGenomeMarketingGrowthSignals(businessId);
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
    const result = await generateGenomeMarketingGrowthRecommendations(businessId);
    if (result.error) {
      setError(result.error);
    } else {
      onGenomeUpdate?.();
    }
    setGeneratingRecommendations(false);
  }, [businessId, onGenomeUpdate]);

  const handleAddChannel = useCallback(async () => {
    if (!businessId || channelKey === "" || channelLabel === "") return;
    setAddingChannel(true);
    const result = await createGenomeGrowthChannel(businessId, {
      key: channelKey,
      label: channelLabel,
      channelType,
      status: channelStatus,
      monthlyBudget: channelBudget === "" ? null : Number(channelBudget),
      currency: channelCurrency || "TTD",
      targetCac: channelTargetCac === "" ? null : Number(channelTargetCac),
      targetConversionRate: channelTargetConversion === "" ? null : Number(channelTargetConversion),
      confidence: channelConfidence === "" ? 0.5 : Number(channelConfidence),
    });
    if (result.error || !result.data) {
      setError(result.error || "Failed to add channel");
    } else {
      setChannelKey("");
      setChannelLabel("");
      setChannelType("owned");
      setChannelStatus("ACTIVE");
      setChannelBudget("");
      setChannelCurrency("TTD");
      setChannelTargetCac("");
      setChannelTargetConversion("");
      setChannelConfidence("0.5");
      await handleCompute();
    }
    setAddingChannel(false);
  }, [
    businessId,
    channelConfidence,
    channelCurrency,
    channelKey,
    channelLabel,
    channelBudget,
    channelStatus,
    channelTargetCac,
    channelTargetConversion,
    channelType,
    handleCompute,
  ]);

  const handleAddStrategy = useCallback(async () => {
    if (!businessId || strategyPillars === "") return;
    setAddingStrategy(true);
    const result = await createGenomeContentStrategy(businessId, {
      pillars: strategyPillars.split(",").map((s) => s.trim()).filter(Boolean),
      cadence: strategyCadence || undefined,
      formats: strategyFormats.split(",").map((s) => s.trim()).filter(Boolean),
      distributionChannels: strategyDistribution.split(",").map((s) => s.trim()).filter(Boolean),
      confidence: strategyConfidence === "" ? 0.5 : Number(strategyConfidence),
    });
    if (result.error || !result.data) {
      setError(result.error || "Failed to add content strategy");
    } else {
      setStrategyPillars("");
      setStrategyCadence("");
      setStrategyFormats("");
      setStrategyDistribution("");
      setStrategyConfidence("0.5");
      await handleCompute();
    }
    setAddingStrategy(false);
  }, [businessId, handleCompute, strategyCadence, strategyConfidence, strategyDistribution, strategyFormats, strategyPillars]);

  const handleDeleteChannel = useCallback(
    async (id: string) => {
      if (!businessId) return;
      const result = await deleteGenomeGrowthChannel(businessId, id);
      if (result.error) {
        setError(result.error);
      } else {
        await refresh();
        await handleCompute();
      }
    },
    [businessId, handleCompute, refresh],
  );

  const handleDeleteStrategy = useCallback(
    async (id: string) => {
      if (!businessId) return;
      const result = await deleteGenomeContentStrategy(businessId, id);
      if (result.error) {
        setError(result.error);
      } else {
        await refresh();
        await handleCompute();
      }
    },
    [businessId, handleCompute, refresh],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of marketing/growth genome
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
        title="Error loading marketing/growth genome"
        description={error}
        actionLabel="Retry"
        onAction={refresh}
      />
    );
  }

  if (!snapshot) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No marketing/growth genome yet"
        description="Add growth channels and content strategies, then compute a snapshot to see channel mix, CAC, and growth readiness."
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
            <TrendingUp className="h-5 w-5" />
            Marketing &amp; Growth Genome
          </h3>
          <p className="text-sm text-muted-foreground">
            Channel diversification {snapshot.channelDiversificationScore.toFixed(0)}% · overall risk {snapshot.overallRisk.toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleGenerateSignals} disabled={generatingSignals} size="sm" variant="outline">
            {generatingSignals ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" />}
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
        <MetricCard label="Blended CAC" value={snapshot.blendedCac != null ? `$${snapshot.blendedCac.toLocaleString()}` : "—"} icon={Target} />
        <MetricCard label="Lead volume" value={snapshot.leadVolumeEstimate != null ? snapshot.leadVolumeEstimate.toLocaleString() : "—"} icon={TrendingUp} />
        <MetricCard label="Channel diversity" value={`${snapshot.channelDiversificationScore.toFixed(0)}%`} icon={Radio} />
        <MetricCard label="Content consistency" value={`${snapshot.contentConsistencyScore.toFixed(0)}%`} icon={Palette} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RiskCard label="Overall risk" risk={snapshot.overallRisk} />
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
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="font-medium flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            Recommendations
          </div>
          {snapshot.recommendations.slice(0, 5).map((rec, idx) => (
            <RecommendationCard key={idx} rec={rec} />
          ))}
        </div>
      )}

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="font-medium flex items-center gap-2">
          <Megaphone className="h-4 w-4" />
          Channel mix
        </div>
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No growth channels recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {channels.map((channel) => (
              <div key={channel.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{channel.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {channel.key}
                    {` · ${formatType(channel.channelType)}`}
                    {channel.monthlyBudget != null ? ` · ${channel.currency} ${channel.monthlyBudget.toLocaleString()}/mo` : null}
                    {channel.targetCac != null ? ` · target CAC ${channel.currency} ${channel.targetCac.toLocaleString()}` : null}
                    {channel.targetConversionRate != null ? ` · ${(channel.targetConversionRate * 100).toFixed(1)}% conv` : null}
                    {` · confidence ${(channel.confidence * 100).toFixed(0)}%`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {channelStatusBadge(channel.status)}
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteChannel(channel.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add channel
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={channelKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChannelKey(e.target.value)}
              placeholder="Key (e.g. paid_meta)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              value={channelLabel}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChannelLabel(e.target.value)}
              placeholder="Label"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <select
              value={channelType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setChannelType(e.target.value as "owned" | "earned" | "paid")
              }
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            >
              {CHANNEL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatType(t)}
                </option>
              ))}
            </select>
            <select
              value={channelStatus}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setChannelStatus(e.target.value as "ACTIVE" | "TESTING" | "PAUSED" | "DEPRECATED")
              }
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            >
              {CHANNEL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {formatType(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="number"
              value={channelBudget}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChannelBudget(e.target.value)}
              placeholder="Monthly budget"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              value={channelCurrency}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChannelCurrency(e.target.value)}
              placeholder="Currency"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={channelTargetCac}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChannelTargetCac(e.target.value)}
              placeholder="Target CAC"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={channelTargetConversion}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChannelTargetConversion(e.target.value)}
              placeholder="Target conversion (0–1)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="number"
              value={channelConfidence}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChannelConfidence(e.target.value)}
              placeholder="Confidence (0–1)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <div />
            <div />
            <Button onClick={handleAddChannel} disabled={addingChannel || channelKey === "" || channelLabel === ""} size="sm">
              {addingChannel ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="font-medium flex items-center gap-2">
          <Palette className="h-4 w-4" />
          Content strategy
        </div>
        {strategies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No content strategies recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {strategies.map((strategy) => (
              <div key={strategy.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{strategy.pillars.join(", ")}</div>
                  <div className="text-xs text-muted-foreground">
                    {strategy.cadence ? `Cadence: ${strategy.cadence} · ` : null}
                    formats: {strategy.formats.join(", ") || "—"}
                    {strategy.distributionChannels.length > 0 ? ` · channels: ${strategy.distributionChannels.join(", ")}` : null}
                    {` · confidence ${(strategy.confidence * 100).toFixed(0)}%`}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteStrategy(strategy.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add content strategy
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={strategyPillars}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStrategyPillars(e.target.value)}
              placeholder="Pillars (comma-separated)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              value={strategyCadence}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStrategyCadence(e.target.value)}
              placeholder="Cadence (e.g. 2 posts/week)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              value={strategyFormats}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStrategyFormats(e.target.value)}
              placeholder="Formats (comma-separated)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              value={strategyDistribution}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStrategyDistribution(e.target.value)}
              placeholder="Distribution channels (comma-separated)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="number"
              value={strategyConfidence}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStrategyConfidence(e.target.value)}
              placeholder="Confidence (0–1)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <div />
            <div />
            <Button onClick={handleAddStrategy} disabled={addingStrategy || strategyPillars === ""} size="sm">
              {addingStrategy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add
            </Button>
          </div>
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

function RiskCard({ label, risk }: { label: string; risk: GenomeMarketingGrowthRiskLevel }) {
  return (
    <div className="rounded-lg border bg-card p-3 flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      {riskBadge(risk)}
    </div>
  );
}

function RecommendationCard({ rec }: { rec: GenomeMarketingGrowthRecommendation }) {
  return (
    <div className="text-sm rounded-md border p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{rec.title}</span>
        <div className="flex items-center gap-1.5">
          {riskBadge(rec.riskLevel)}
          <StatusBadge status="neutral" label={rec.effortLevel} />
        </div>
      </div>
      <p className="text-muted-foreground">{rec.insight}</p>
      {rec.diagnosis ? <p className="text-muted-foreground"><span className="font-medium">Diagnosis:</span> {rec.diagnosis}</p> : null}
      {rec.recommendation ? <p className="text-muted-foreground"><span className="font-medium">Recommendation:</span> {rec.recommendation}</p> : null}
      {rec.expectedGain ? <p className="text-muted-foreground"><span className="font-medium">Expected gain:</span> {rec.expectedGain}</p> : null}
    </div>
  );
}
