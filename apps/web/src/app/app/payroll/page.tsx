"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { StandardModuleLayout } from "@/components/ui/standard-module-layout";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { Button } from "@keyflow/ui";
import {
  approveRun,
  getRun,
  listRates,
  listRuns,
  markRunPaid,
  type PayRate,
  type PayrollRun,
  type PayrollRunListItem,
} from "@/lib/api/payroll";

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function formatMoney(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PayrollPage() {
  const businessId = getStoredBusinessId();

  const [rates, setRates] = useState<PayRate[]>([]);
  const [runs, setRuns] = useState<PayrollRunListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<PayrollRun | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const [ratesRes, runsRes] = await Promise.all([listRates(businessId), listRuns(businessId)]);
    if (ratesRes.error) toast.error(ratesRes.error);
    else if (ratesRes.data) setRates(ratesRes.data);
    if (runsRes.error) toast.error(runsRes.error);
    else if (runsRes.data) setRuns(runsRes.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const toggleRun = async (runId: string) => {
    if (!businessId) return;
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setRunDetail(null);
      return;
    }
    setExpandedRunId(runId);
    setDetailLoading(true);
    setRunDetail(null);
    const { data, error } = await getRun(businessId, runId);
    if (error || !data) toast.error(error ?? "Failed to load payroll run");
    else setRunDetail(data);
    setDetailLoading(false);
  };

  const handleApprove = async (run: PayrollRunListItem) => {
    if (!businessId) return;
    if (!window.confirm(`Approve payroll run for ${formatDate(run.periodStart)} – ${formatDate(run.periodEnd)}?`)) return;
    setActionLoading(run.id);
    const { error } = await approveRun(businessId, run.id);
    if (error) toast.error(error);
    else {
      toast.success("Payroll run approved");
      await load();
      if (expandedRunId === run.id) {
        const { data } = await getRun(businessId, run.id);
        if (data) setRunDetail(data);
      }
    }
    setActionLoading(null);
  };

  const handleMarkPaid = async (run: PayrollRunListItem) => {
    if (!businessId) return;
    if (!window.confirm(`Mark payroll run for ${formatDate(run.periodStart)} – ${formatDate(run.periodEnd)} as paid?`)) return;
    setActionLoading(run.id);
    const { error } = await markRunPaid(businessId, run.id);
    if (error) toast.error(error);
    else {
      toast.success("Payroll run marked as paid");
      await load();
      if (expandedRunId === run.id) {
        const { data } = await getRun(businessId, run.id);
        if (data) setRunDetail(data);
      }
    }
    setActionLoading(null);
  };

  const headerRight = (
    <Button variant="outline" size="sm" onClick={() => load()} disabled={loading} className="gap-1">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
      Refresh
    </Button>
  );

  return (
    <StandardModuleLayout
      workspace="team"
      icon={Banknote}
      title="Payroll"
      subtitle="Pay rates and payroll runs generated from logged time and salaries."
      headerRight={headerRight}
    >
      <div className="space-y-4">
        <SectionCard title="Pay rates" subtitle="Latest effective rate per staff position" icon={Wallet} noPadding>
          {loading && rates.length === 0 ? (
            <div className="p-4">
              <SkeletonList rows={3} cols={4} />
            </div>
          ) : rates.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No pay rates yet"
              description="Set staff pay rates via the KEY chat tools (payroll_set_rate) to start running payroll."
              variant="compact"
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Staff</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Amount</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Currency</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Period</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Effective from</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3 font-medium">{rate.staffName}</td>
                    <td className="px-4 py-3 text-right">{rate.amount.toLocaleString()}</td>
                    <td className="px-4 py-3">{rate.currency}</td>
                    <td className="px-4 py-3 capitalize">{rate.periodType}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(rate.effectiveFrom)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="Payroll runs" subtitle="Click a run to see its line items" icon={Banknote} noPadding>
          {loading && runs.length === 0 ? (
            <div className="p-4">
              <SkeletonList rows={4} cols={4} />
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No payroll runs yet"
              description="Generate a payroll run via the KEY chat tools (payroll_generate_run), then approve and pay it here."
              variant="compact"
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs w-8" />
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Period</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Items</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Total gross</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    expanded={expandedRunId === run.id}
                    detail={expandedRunId === run.id ? runDetail : null}
                    detailLoading={expandedRunId === run.id && detailLoading}
                    actionLoading={actionLoading === run.id}
                    onToggle={() => toggleRun(run.id)}
                    onApprove={() => handleApprove(run)}
                    onMarkPaid={() => handleMarkPaid(run)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
    </StandardModuleLayout>
  );
}

function RunRow({
  run,
  expanded,
  detail,
  detailLoading,
  actionLoading,
  onToggle,
  onApprove,
  onMarkPaid,
}: {
  run: PayrollRunListItem;
  expanded: boolean;
  detail: PayrollRun | null;
  detailLoading: boolean;
  actionLoading: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onMarkPaid: () => void;
}) {
  const canApprove = run.status === "DRAFT" || run.status === "PENDING";
  const canMarkPaid = run.status === "APPROVED";

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-border/40 last:border-0 cursor-pointer hover:bg-muted/20 transition-colors"
      >
        <td className="px-4 py-3 text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </td>
        <td className="px-4 py-3 font-medium">
          {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={run.status} size="sm" />
        </td>
        <td className="px-4 py-3 text-right">{run.itemCount}</td>
        <td className="px-4 py-3 text-right">{formatMoney(run.totalGross, run.currency)}</td>
        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-2">
            {canApprove && (
              <Button variant="outline" size="sm" onClick={onApprove} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                Approve
              </Button>
            )}
            {canMarkPaid && (
              <Button size="sm" onClick={onMarkPaid} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Banknote className="w-3 h-3 mr-1" />}
                Mark paid
              </Button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/40 last:border-0 bg-muted/10">
          <td colSpan={6} className="px-6 py-4">
            {detailLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading line items…
              </div>
            ) : detail ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>Created {formatDate(detail.createdAt)}</span>
                  {detail.approvedAt && <span>Approved {formatDate(detail.approvedAt)}</span>}
                  {detail.paidAt && <span>Paid {formatDate(detail.paidAt)}</span>}
                  {detail.notes && <span>Notes: {detail.notes}</span>}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="py-2 text-left font-medium text-muted-foreground text-xs">Staff</th>
                      <th className="py-2 text-right font-medium text-muted-foreground text-xs">Hours</th>
                      <th className="py-2 text-right font-medium text-muted-foreground text-xs">Gross pay</th>
                      <th className="py-2 text-left font-medium text-muted-foreground text-xs pl-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id} className="border-b border-border/30 last:border-0">
                        <td className="py-2 font-medium">{item.staffName}</td>
                        <td className="py-2 text-right">{item.hoursWorked === null ? "—" : item.hoursWorked.toFixed(2)}</td>
                        <td className="py-2 text-right">{formatMoney(item.grossPay, item.currency)}</td>
                        <td className="py-2 pl-4 text-muted-foreground">{item.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Run details unavailable.</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
