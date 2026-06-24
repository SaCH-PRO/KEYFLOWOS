"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Loader2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getGenomeDepartmentSummary,
  computeGenomeDepartments,
  type DepartmentGenomeSummary,
  type GenomeDepartmentData,
} from "@/lib/api/business-genome";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

function riskBadge(riskLevel: string) {
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
      return <StatusBadge status="neutral" label={riskLevel} />;
  }
}

interface KeyGenomeDepartmentsPanelProps {
  onGenomeUpdate?: () => void;
}

export function KeyGenomeDepartmentsPanel({ onGenomeUpdate }: KeyGenomeDepartmentsPanelProps) {
  const [summary, setSummary] = useState<DepartmentGenomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await getGenomeDepartmentSummary(businessId);
    if (result.error || !result.data) {
      setError(result.error || "Failed to load department summary");
    } else {
      setSummary(result.data);
      setError(null);
    }
    setLoading(false);
  }, [businessId]);

  const handleCompute = useCallback(async () => {
    if (!businessId) return;
    setComputing(true);
    const result = await computeGenomeDepartments(businessId);
    if (result.error || !result.data) {
      setError(result.error || "Failed to compute departments");
    } else {
      await refresh();
      onGenomeUpdate?.();
    }
    setComputing(false);
  }, [businessId, refresh, onGenomeUpdate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of department genome
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
        title="Error loading departments"
        description={error}
        actionLabel="Retry"
        onAction={refresh}
      />
    );
  }

  if (!summary || summary.departments.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No departments yet"
        description="Seed and compute your department genome to see readiness across the business."
        actionLabel="Compute departments"
        onAction={handleCompute}
      />
    );
  }

  return (
    <motion.div {...fade} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Department Genome</h3>
          <p className="text-sm text-muted-foreground">
            Overall maturity {summary.overallDepartmentMaturity}% · readiness {summary.overallDepartmentReadiness}%
          </p>
        </div>
        <Button onClick={handleCompute} disabled={computing} size="sm">
          {computing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Recompute
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Strongest" value={summary.strongestDepartments.length} icon={TrendingUp} />
        <MetricCard label="Weakest" value={summary.weakestDepartments.length} icon={TrendingDown} />
        <MetricCard label="Blocked" value={summary.blockedDepartments.length} icon={AlertTriangle} />
        <MetricCard label="Automation Ready" value={summary.automationReadyDepartments.length} icon={CheckCircle2} />
      </div>

      <div className="space-y-3">
        {summary.departments.map((dept) => (
          <DepartmentCard key={dept.code} department={dept} />
        ))}
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
  value: number;
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

function DepartmentCard({ department }: { department: GenomeDepartmentData }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">{department.name}</div>
          <div className="text-sm text-muted-foreground">{department.description}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {department.automationAllowed ? (
            <StatusBadge status="success" label="Ready" />
          ) : (
            <StatusBadge status="warning" label="Blocked" />
          )}
          {riskBadge(department.riskLevel)}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded bg-muted p-2">
          <div className="text-muted-foreground">Maturity</div>
          <div className="font-medium">{department.maturityScore}%</div>
        </div>
        <div className="rounded bg-muted p-2">
          <div className="text-muted-foreground">Readiness</div>
          <div className="font-medium">{department.readinessScore}%</div>
        </div>
        <div className="rounded bg-muted p-2">
          <div className="text-muted-foreground">Confidence</div>
          <div className="font-medium">{department.confidenceScore}%</div>
        </div>
      </div>

      {department.gapSummary.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-sm font-medium">Gaps</div>
          {department.gapSummary.map((gap, idx) => (
            <div key={idx} className="text-sm text-muted-foreground flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider">{gap.type}</span>
              {gap.reason}
            </div>
          ))}
        </div>
      )}

      {department.recommendedActions.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-sm font-medium">Recommended actions</div>
          {department.recommendedActions.slice(0, 3).map((action, idx) => (
            <div key={idx} className="text-sm text-muted-foreground">
              {action.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
