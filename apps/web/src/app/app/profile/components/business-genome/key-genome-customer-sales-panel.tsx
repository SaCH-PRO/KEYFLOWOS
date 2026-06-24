"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Loader2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Lightbulb,
  Plus,
  Trash2,
  Filter,
  Store,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  computeGenomeCustomerSalesSnapshot,
  deleteGenomeCustomerSegment,
  deleteGenomeSalesMotion,
  generateGenomeCustomerSalesRecommendations,
  generateGenomeCustomerSalesSignals,
  getGenomeCustomerSalesSnapshot,
  listGenomeCustomerSegments,
  listGenomeSalesMotions,
  upsertGenomeCustomerSegment,
  upsertGenomeSalesMotion,
  type GenomeCustomerSalesRiskLevel,
  type GenomeCustomerSalesSnapshotData,
  type GenomeCustomerSegmentData,
  type GenomeCustomerSegmentType,
  type GenomeSalesMotionData,
  type GenomeSalesMotionStage,
  type GenomeSalesMotionType,
} from "@/lib/api/business-genome";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

const SEGMENT_TYPES: GenomeCustomerSegmentType[] = [
  "HIGH_VALUE",
  "LOW_MARGIN",
  "NEW",
  "AT_RISK",
  "LOYAL",
  "CHURNED",
  "PROSPECT",
  "CUSTOM",
];

const MOTION_TYPES: GenomeSalesMotionType[] = [
  "INBOUND",
  "OUTBOUND",
  "REFERRAL",
  "PARTNERSHIP",
  "SELF_SERVICE",
  "EVENT",
  "CUSTOM",
];

const MOTION_STAGES: GenomeSalesMotionStage[] = [
  "AWARENESS",
  "INTEREST",
  "CONSIDERATION",
  "INTENT",
  "PURCHASE",
  "RETENTION",
  "ADVOCACY",
];

function formatType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function riskBadge(riskLevel: GenomeCustomerSalesRiskLevel) {
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

interface KeyGenomeCustomerSalesPanelProps {
  onGenomeUpdate?: () => void;
}

export function KeyGenomeCustomerSalesPanel({ onGenomeUpdate }: KeyGenomeCustomerSalesPanelProps) {
  const [snapshot, setSnapshot] = useState<GenomeCustomerSalesSnapshotData | null>(null);
  const [segments, setSegments] = useState<GenomeCustomerSegmentData[]>([]);
  const [motions, setMotions] = useState<GenomeSalesMotionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [generatingSignals, setGeneratingSignals] = useState(false);
  const [generatingRecommendations, setGeneratingRecommendations] = useState(false);
  const [addingSegment, setAddingSegment] = useState(false);
  const [addingMotion, setAddingMotion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [segmentName, setSegmentName] = useState("");
  const [segmentType, setSegmentType] = useState<GenomeCustomerSegmentType>("HIGH_VALUE");
  const [segmentSize, setSegmentSize] = useState("");
  const [segmentLtv, setSegmentLtv] = useState("");
  const [segmentCac, setSegmentCac] = useState("");
  const [segmentChurn, setSegmentChurn] = useState("");
  const [segmentChannel, setSegmentChannel] = useState("");

  const [motionName, setMotionName] = useState("");
  const [motionType, setMotionType] = useState<GenomeSalesMotionType>("INBOUND");
  const [motionStage, setMotionStage] = useState<GenomeSalesMotionStage>("AWARENESS");
  const [motionConversion, setMotionConversion] = useState("");
  const [motionVolume, setMotionVolume] = useState("");
  const [motionChannel, setMotionChannel] = useState("");

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [snapshotRes, segmentsRes, motionsRes] = await Promise.all([
      getGenomeCustomerSalesSnapshot(businessId),
      listGenomeCustomerSegments(businessId),
      listGenomeSalesMotions(businessId),
    ]);
    if (snapshotRes.error) {
      setError(snapshotRes.error);
    } else {
      setSnapshot(snapshotRes.data);
      setError(null);
    }
    setSegments(segmentsRes.data ?? []);
    setMotions(motionsRes.data ?? []);
    setLoading(false);
  }, [businessId]);

  const handleCompute = useCallback(async () => {
    if (!businessId) return;
    setComputing(true);
    const result = await computeGenomeCustomerSalesSnapshot(businessId);
    if (result.error || !result.data) {
      setError(result.error || "Failed to compute customer/sales snapshot");
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
    const result = await generateGenomeCustomerSalesSignals(businessId);
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
    const result = await generateGenomeCustomerSalesRecommendations(businessId);
    if (result.error) {
      setError(result.error);
    } else {
      onGenomeUpdate?.();
    }
    setGeneratingRecommendations(false);
  }, [businessId, onGenomeUpdate]);

  const handleAddSegment = useCallback(async () => {
    if (!businessId || segmentName === "") return;
    setAddingSegment(true);
    const result = await upsertGenomeCustomerSegment(businessId, {
      name: segmentName,
      segmentType: segmentType,
      estimatedSize: segmentSize === "" ? null : Number(segmentSize),
      lifetimeValue: segmentLtv === "" ? null : Number(segmentLtv),
      acquisitionCost: segmentCac === "" ? null : Number(segmentCac),
      churnRate: segmentChurn === "" ? null : Number(segmentChurn),
      channel: segmentChannel || null,
    });
    if (result.error || !result.data) {
      setError(result.error || "Failed to add segment");
    } else {
      setSegmentName("");
      setSegmentSize("");
      setSegmentLtv("");
      setSegmentCac("");
      setSegmentChurn("");
      setSegmentChannel("");
      await handleCompute();
    }
    setAddingSegment(false);
  }, [
    businessId,
    handleCompute,
    segmentCac,
    segmentChannel,
    segmentChurn,
    segmentLtv,
    segmentName,
    segmentSize,
    segmentType,
  ]);

  const handleAddMotion = useCallback(async () => {
    if (!businessId || motionName === "") return;
    setAddingMotion(true);
    const result = await upsertGenomeSalesMotion(businessId, {
      name: motionName,
      motionType: motionType,
      stage: motionStage,
      conversionRate: motionConversion === "" ? null : Number(motionConversion),
      volume: motionVolume === "" ? null : Number(motionVolume),
      channel: motionChannel || null,
    });
    if (result.error || !result.data) {
      setError(result.error || "Failed to add motion");
    } else {
      setMotionName("");
      setMotionConversion("");
      setMotionVolume("");
      setMotionChannel("");
      await handleCompute();
    }
    setAddingMotion(false);
  }, [businessId, handleCompute, motionChannel, motionConversion, motionName, motionStage, motionType, motionVolume]);

  const handleDeleteSegment = useCallback(
    async (id: string) => {
      if (!businessId) return;
      const result = await deleteGenomeCustomerSegment(businessId, id);
      if (result.error) {
        setError(result.error);
      } else {
        await refresh();
        await handleCompute();
      }
    },
    [businessId, handleCompute, refresh],
  );

  const handleDeleteMotion = useCallback(
    async (id: string) => {
      if (!businessId) return;
      const result = await deleteGenomeSalesMotion(businessId, id);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of customer/sales genome
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
        title="Error loading customer/sales genome"
        description={error}
        actionLabel="Retry"
        onAction={refresh}
      />
    );
  }

  if (!snapshot) {
    return (
      <EmptyState
        icon={Users}
        title="No customer/sales genome yet"
        description="Add customer segments and sales motions, then compute a snapshot to see revenue quality, CAC/LTV, and conversion health."
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
            <Users className="h-5 w-5" />
            Customer &amp; Sales Genome
          </h3>
          <p className="text-sm text-muted-foreground">
            Revenue quality {snapshot.revenueQualityScore}% · overall risk {snapshot.overallRisk.toLowerCase()}
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
        <MetricCard label="Revenue quality" value={`${snapshot.revenueQualityScore}%`} icon={TrendingUp} />
        <MetricCard label="LTV/CAC" value={snapshot.ltvCacRatio != null ? snapshot.ltvCacRatio.toFixed(1) : "—"} icon={TrendingUp} />
        <MetricCard label="Conversion" value={snapshot.conversionRate != null ? `${(snapshot.conversionRate * 100).toFixed(1)}%` : "—"} icon={Filter} />
        <MetricCard label="Customers" value={snapshot.totalCustomers != null ? String(snapshot.totalCustomers) : "—"} icon={Users} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RiskCard label="Revenue concentration" risk={snapshot.revenueConcentrationRisk} />
        <RiskCard label="CAC risk" risk={snapshot.cacRisk} />
        <RiskCard label="LTV risk" risk={snapshot.ltvRisk} />
        <RiskCard label="Churn risk" risk={snapshot.churnRisk} />
        <RiskCard label="Conversion risk" risk={snapshot.conversionRisk} />
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
          <Users className="h-4 w-4" />
          Customer segments
        </div>
        {segments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No segments recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {segments.map((segment) => (
              <div key={segment.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{segment.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatType(segment.segmentType)}
                    {segment.estimatedSize != null ? ` · ${segment.estimatedSize} customers` : null}
                    {segment.lifetimeValue != null ? ` · LTV $${segment.lifetimeValue.toLocaleString()}` : null}
                    {segment.acquisitionCost != null ? ` · CAC $${segment.acquisitionCost.toLocaleString()}` : null}
                    {segment.channel ? ` · ${segment.channel}` : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteSegment(segment.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add segment
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={segmentName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSegmentName(e.target.value)}
              placeholder="Segment name"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <select
              value={segmentType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setSegmentType(e.target.value as GenomeCustomerSegmentType)
              }
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            >
              {SEGMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatType(t)}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={segmentSize}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSegmentSize(e.target.value)}
              placeholder="Size"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={segmentChannel}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSegmentChannel(e.target.value)}
              placeholder="Channel"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="number"
              value={segmentLtv}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSegmentLtv(e.target.value)}
              placeholder="LTV"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={segmentCac}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSegmentCac(e.target.value)}
              placeholder="CAC"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={segmentChurn}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSegmentChurn(e.target.value)}
              placeholder="Churn rate (0–1)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <Button onClick={handleAddSegment} disabled={addingSegment || segmentName === ""} size="sm">
              {addingSegment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="font-medium flex items-center gap-2">
          <Store className="h-4 w-4" />
          Sales motions
        </div>
        {motions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales motions recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {motions.map((motion) => (
              <div key={motion.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{motion.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatType(motion.motionType)}
                    {motion.stage ? ` · ${formatType(motion.stage)}` : null}
                    {motion.conversionRate != null ? ` · ${(motion.conversionRate * 100).toFixed(1)}% conv` : null}
                    {motion.volume != null ? ` · ${motion.volume} vol` : null}
                    {motion.channel ? ` · ${motion.channel}` : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteMotion(motion.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add motion
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={motionName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMotionName(e.target.value)}
              placeholder="Motion name"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <select
              value={motionType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setMotionType(e.target.value as GenomeSalesMotionType)
              }
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            >
              {MOTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatType(t)}
                </option>
              ))}
            </select>
            <select
              value={motionStage}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setMotionStage(e.target.value as GenomeSalesMotionStage)
              }
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            >
              {MOTION_STAGES.map((s) => (
                <option key={s} value={s}>
                  {formatType(s)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={motionChannel}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMotionChannel(e.target.value)}
              placeholder="Channel"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="number"
              value={motionConversion}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMotionConversion(e.target.value)}
              placeholder="Conversion rate (0–1)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={motionVolume}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMotionVolume(e.target.value)}
              placeholder="Volume"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <div />
            <Button onClick={handleAddMotion} disabled={addingMotion || motionName === ""} size="sm">
              {addingMotion ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
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

function RiskCard({ label, risk }: { label: string; risk: GenomeCustomerSalesRiskLevel }) {
  return (
    <div className="rounded-lg border bg-card p-3 flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      {riskBadge(risk)}
    </div>
  );
}
