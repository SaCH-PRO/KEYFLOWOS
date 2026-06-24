"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Cog,
  Loader2,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Lightbulb,
  Plus,
  Trash2,
  Boxes,
  Gauge,
  ClipboardList,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  computeGenomeOperationsSnapshot,
  deleteGenomeDeliveryCapability,
  deleteGenomeOperationalProcess,
  generateGenomeOperationsRecommendations,
  generateGenomeOperationsSignals,
  getGenomeOperationsSnapshot,
  listGenomeDeliveryCapabilities,
  listGenomeOperationalProcesses,
  upsertGenomeDeliveryCapability,
  upsertGenomeOperationalProcess,
  type GenomeDeliveryCapabilityData,
  type GenomeDeliveryCapabilityType,
  type GenomeOperationalProcessData,
  type GenomeOperationalProcessType,
  type GenomeOperationsRiskLevel,
  type GenomeOperationsSnapshotData,
} from "@/lib/api/business-genome";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

const PROCESS_TYPES: GenomeOperationalProcessType[] = [
  "DELIVERY",
  "SUPPORT",
  "FULFILLMENT",
  "ADMIN",
  "QUALITY",
  "ONBOARDING",
  "CUSTOM",
];

const CAPABILITY_TYPES: GenomeDeliveryCapabilityType[] = [
  "SERVICE",
  "PRODUCT",
  "SUPPORT",
  "FULFILLMENT",
  "CONSULTING",
  "CUSTOM",
];

function formatType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function riskBadge(riskLevel: GenomeOperationsRiskLevel) {
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

interface KeyGenomeOperationsPanelProps {
  onGenomeUpdate?: () => void;
}

export function KeyGenomeOperationsPanel({ onGenomeUpdate }: KeyGenomeOperationsPanelProps) {
  const [snapshot, setSnapshot] = useState<GenomeOperationsSnapshotData | null>(null);
  const [processes, setProcesses] = useState<GenomeOperationalProcessData[]>([]);
  const [capabilities, setCapabilities] = useState<GenomeDeliveryCapabilityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [generatingSignals, setGeneratingSignals] = useState(false);
  const [generatingRecommendations, setGeneratingRecommendations] = useState(false);
  const [addingProcess, setAddingProcess] = useState(false);
  const [addingCapability, setAddingCapability] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [processName, setProcessName] = useState("");
  const [processType, setProcessType] = useState<GenomeOperationalProcessType>("DELIVERY");
  const [processHasSop, setProcessHasSop] = useState(false);
  const [processDocumented, setProcessDocumented] = useState(false);
  const [processFailureRate, setProcessFailureRate] = useState("");
  const [processReworkRate, setProcessReworkRate] = useState("");
  const [processHandoffs, setProcessHandoffs] = useState("");
  const [processCycleTime, setProcessCycleTime] = useState("");

  const [capabilityName, setCapabilityName] = useState("");
  const [capabilityType, setCapabilityType] = useState<GenomeDeliveryCapabilityType>("SERVICE");
  const [capabilityUtilization, setCapabilityUtilization] = useState("");
  const [capabilityLeadTime, setCapabilityLeadTime] = useState("");
  const [capabilityQuality, setCapabilityQuality] = useState("");
  const [capabilityReliability, setCapabilityReliability] = useState("");

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [snapshotRes, processesRes, capabilitiesRes] = await Promise.all([
      getGenomeOperationsSnapshot(businessId),
      listGenomeOperationalProcesses(businessId),
      listGenomeDeliveryCapabilities(businessId),
    ]);
    if (snapshotRes.error) {
      setError(snapshotRes.error);
    } else {
      setSnapshot(snapshotRes.data);
      setError(null);
    }
    setProcesses(processesRes.data ?? []);
    setCapabilities(capabilitiesRes.data ?? []);
    setLoading(false);
  }, [businessId]);

  const handleCompute = useCallback(async () => {
    if (!businessId) return;
    setComputing(true);
    const result = await computeGenomeOperationsSnapshot(businessId);
    if (result.error || !result.data) {
      setError(result.error || "Failed to compute operations snapshot");
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
    const result = await generateGenomeOperationsSignals(businessId);
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
    const result = await generateGenomeOperationsRecommendations(businessId);
    if (result.error) {
      setError(result.error);
    } else {
      onGenomeUpdate?.();
    }
    setGeneratingRecommendations(false);
  }, [businessId, onGenomeUpdate]);

  const handleAddProcess = useCallback(async () => {
    if (!businessId || processName === "") return;
    setAddingProcess(true);
    const result = await upsertGenomeOperationalProcess(businessId, {
      name: processName,
      processType: processType,
      hasSop: processHasSop,
      documented: processDocumented,
      failureRate: processFailureRate === "" ? null : Number(processFailureRate),
      reworkRate: processReworkRate === "" ? null : Number(processReworkRate),
      handoffCount: processHandoffs === "" ? null : Number(processHandoffs),
      averageCycleTimeHours: processCycleTime === "" ? null : Number(processCycleTime),
    });
    if (result.error || !result.data) {
      setError(result.error || "Failed to add process");
    } else {
      setProcessName("");
      setProcessHasSop(false);
      setProcessDocumented(false);
      setProcessFailureRate("");
      setProcessReworkRate("");
      setProcessHandoffs("");
      setProcessCycleTime("");
      await handleCompute();
    }
    setAddingProcess(false);
  }, [
    businessId,
    handleCompute,
    processCycleTime,
    processDocumented,
    processFailureRate,
    processHandoffs,
    processHasSop,
    processName,
    processReworkRate,
    processType,
  ]);

  const handleAddCapability = useCallback(async () => {
    if (!businessId || capabilityName === "") return;
    setAddingCapability(true);
    const result = await upsertGenomeDeliveryCapability(businessId, {
      name: capabilityName,
      capabilityType: capabilityType,
      utilizationRate: capabilityUtilization === "" ? null : Number(capabilityUtilization),
      averageLeadTimeDays: capabilityLeadTime === "" ? null : Number(capabilityLeadTime),
      qualityScore: capabilityQuality === "" ? null : Number(capabilityQuality),
      reliabilityScore: capabilityReliability === "" ? null : Number(capabilityReliability),
    });
    if (result.error || !result.data) {
      setError(result.error || "Failed to add capability");
    } else {
      setCapabilityName("");
      setCapabilityUtilization("");
      setCapabilityLeadTime("");
      setCapabilityQuality("");
      setCapabilityReliability("");
      await handleCompute();
    }
    setAddingCapability(false);
  }, [
    businessId,
    capabilityLeadTime,
    capabilityName,
    capabilityQuality,
    capabilityReliability,
    capabilityType,
    capabilityUtilization,
    handleCompute,
  ]);

  const handleDeleteProcess = useCallback(
    async (id: string) => {
      if (!businessId) return;
      const result = await deleteGenomeOperationalProcess(businessId, id);
      if (result.error) {
        setError(result.error);
      } else {
        await refresh();
        await handleCompute();
      }
    },
    [businessId, handleCompute, refresh],
  );

  const handleDeleteCapability = useCallback(
    async (id: string) => {
      if (!businessId) return;
      const result = await deleteGenomeDeliveryCapability(businessId, id);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of operations genome
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
        title="Error loading operations genome"
        description={error}
        actionLabel="Retry"
        onAction={refresh}
      />
    );
  }

  if (!snapshot) {
    return (
      <EmptyState
        icon={Cog}
        title="No operations genome yet"
        description="Add operational processes and delivery capabilities, then compute a snapshot to see SOP coverage, capacity risk, and delivery readiness."
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
            <Cog className="h-5 w-5" />
            Operations Genome
          </h3>
          <p className="text-sm text-muted-foreground">
            Delivery readiness {snapshot.deliveryReadinessScore.toFixed(0)}% · overall risk {snapshot.overallRisk.toLowerCase()}
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
        <MetricCard label="Readiness" value={`${snapshot.deliveryReadinessScore.toFixed(0)}%`} icon={Cog} />
        <MetricCard label="SOP coverage" value={snapshot.sopCoverageRate != null ? `${(snapshot.sopCoverageRate * 100).toFixed(0)}%` : "—"} icon={ClipboardList} />
        <MetricCard label="Processes" value={String(snapshot.processCount)} icon={Boxes} />
        <MetricCard label="Capabilities" value={String(capabilities.length)} icon={Gauge} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RiskCard label="SOP risk" risk={snapshot.sopRisk} />
        <RiskCard label="Capacity risk" risk={snapshot.capacityRisk} />
        <RiskCard label="Quality risk" risk={snapshot.qualityRisk} />
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
          <Boxes className="h-4 w-4" />
          Operational processes
        </div>
        {processes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No processes recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {processes.map((process) => (
              <div key={process.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{process.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatType(process.processType)}
                    {process.hasSop ? " · SOP" : null}
                    {process.documented ? " · documented" : null}
                    {process.failureRate != null ? ` · fail ${(process.failureRate * 100).toFixed(0)}%` : null}
                    {process.reworkRate != null ? ` · rework ${(process.reworkRate * 100).toFixed(0)}%` : null}
                    {process.handoffCount != null ? ` · ${process.handoffCount} handoffs` : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteProcess(process.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add process
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={processName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProcessName(e.target.value)}
              placeholder="Process name"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <select
              value={processType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setProcessType(e.target.value as GenomeOperationalProcessType)
              }
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            >
              {PROCESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatType(t)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={processDocumented}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProcessDocumented(e.target.checked)}
                className="rounded border"
              />
              Documented
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={processHasSop}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProcessHasSop(e.target.checked)}
                className="rounded border"
              />
              Has SOP
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="number"
              value={processFailureRate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProcessFailureRate(e.target.value)}
              placeholder="Failure rate (0–1)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={processReworkRate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProcessReworkRate(e.target.value)}
              placeholder="Rework rate (0–1)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={processHandoffs}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProcessHandoffs(e.target.value)}
              placeholder="Handoff count"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={processCycleTime}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProcessCycleTime(e.target.value)}
              placeholder="Cycle time (hours)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={handleAddProcess} disabled={addingProcess || processName === ""} size="sm">
            {addingProcess ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="font-medium flex items-center gap-2">
          <Gauge className="h-4 w-4" />
          Delivery capabilities
        </div>
        {capabilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No capabilities recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {capabilities.map((capability) => (
              <div key={capability.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{capability.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatType(capability.capabilityType)}
                    {capability.utilizationRate != null ? ` · util ${(capability.utilizationRate * 100).toFixed(0)}%` : null}
                    {capability.averageLeadTimeDays != null ? ` · ${capability.averageLeadTimeDays}d lead` : null}
                    {capability.qualityScore != null ? ` · quality ${capability.qualityScore}` : null}
                    {capability.reliabilityScore != null ? ` · reliability ${capability.reliabilityScore}` : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteCapability(capability.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add capability
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={capabilityName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCapabilityName(e.target.value)}
              placeholder="Capability name"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <select
              value={capabilityType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setCapabilityType(e.target.value as GenomeDeliveryCapabilityType)
              }
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            >
              {CAPABILITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatType(t)}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={capabilityUtilization}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCapabilityUtilization(e.target.value)}
              placeholder="Utilization (0–1)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={capabilityLeadTime}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCapabilityLeadTime(e.target.value)}
              placeholder="Lead time (days)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="number"
              value={capabilityQuality}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCapabilityQuality(e.target.value)}
              placeholder="Quality score (0–100)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={capabilityReliability}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCapabilityReliability(e.target.value)}
              placeholder="Reliability score (0–100)"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <div />
            <Button onClick={handleAddCapability} disabled={addingCapability || capabilityName === ""} size="sm">
              {addingCapability ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
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

function RiskCard({ label, risk }: { label: string; risk: GenomeOperationsRiskLevel }) {
  return (
    <div className="rounded-lg border bg-card p-3 flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      {riskBadge(risk)}
    </div>
  );
}
