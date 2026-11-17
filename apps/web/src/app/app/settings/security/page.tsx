"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, Info, RefreshCw, CircleDashed, Lock } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { isModuleScopeRefusal } from "@/lib/module-scope-refusal";

/**
 * What a check concluded (apps/server security-audit.service.ts). 'not_tracked': nothing records the
 * state the check is about (MFA, last sign-in), so the audit makes no claim: neither a pass nor a
 * failure (V1-63 SWP-SEC-AUDIT-TRUTH, sweep BUG-065).
 */
type CheckStatus = "passed" | "failed" | "not_tracked";

interface SecurityCheck {
  id: string;
  category: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  status?: CheckStatus;
  passed: boolean;
  recommendation?: string;
}

interface AuditResult {
  /** Percent of the measured checks that passed; null when nothing was measured. */
  score: number | null;
  /** Measured checks that passed. */
  passed: number;
  /** Measured checks; a not-tracked check is not counted. */
  total: number;
  /** Checks listed but not measured. */
  notTracked?: number;
  checks: SecurityCheck[];
}

function statusOf(check: SecurityCheck): CheckStatus {
  return check.status ?? (check.passed ? "passed" : "failed");
}

function cardClass(status: CheckStatus, severity: SecurityCheck["severity"]): string {
  if (status === "not_tracked") return "border-border/50 bg-muted/20";
  if (status === "passed") return "border-emerald-500/20 bg-emerald-500/5";
  return severity === "critical" ? "border-rose-500/20 bg-rose-500/5" : "border-amber-500/20 bg-amber-500/5";
}

const SEVERITY_ICON = {
  critical: <AlertTriangle className="w-4 h-4 text-rose-400" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  info: <Info className="w-4 h-4 text-sky-400" />,
};

const CATEGORY_LABEL: Record<string, string> = {
  auth: "Authentication",
  data: "Data Protection",
  config: "Configuration",
  network: "Network",
};

export default function SecurityAuditPage() {
  const businessId = getStoredBusinessId();
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  // The server refused this member (GET .../audit needs settings read): say so, never an empty audit.
  const [refused, setRefused] = useState(false);

  const runAudit = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await apiGet<AuditResult>(`/security/businesses/${businessId}/audit`);
      // Only ModuleScopeGuard's refusal of settings says this member lacks the audit's access. Any
      // other 403 (BusinessGuard's transient "Unable to verify business access" or "Service
      // unavailable", another module's refusal) says nothing about it: it keeps the toast and Run
      // audit, so the owner can retry (review SAT-COR-1, as CRR-P195JS-2).
      if (isModuleScopeRefusal(res, "settings")) {
        setResult(null);
        setRefused(true);
        return;
      }
      if (res.error) throw new Error(res.error);
      setRefused(false);
      setResult(res.data ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Audit failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runAudit();
  }, [businessId]);

  const score = result?.score ?? null;
  const notTracked = result ? result.notTracked ?? result.checks.filter((c) => statusOf(c) === "not_tracked").length : 0;
  const scoreColor =
    score === null ? "text-muted-foreground" : score >= 90 ? "text-emerald-400" : score >= 70 ? "text-amber-400" : "text-rose-400";

  return (
    <div className="space-y-6 max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center text-white shadow">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Security Audit</h2>
            <p className="text-xs text-muted-foreground">
              Automated security and compliance checks for your workspace.
            </p>
          </div>
        </div>
        {!refused && (
          <button
            type="button"
            onClick={() => void runAudit()}
            disabled={loading}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-border/60 bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Run audit
          </button>
        )}
      </div>

      {refused && (
        <div role="alert" className="rounded-2xl border border-border/50 bg-card/40 p-6 flex items-start gap-3">
          <Lock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="text-sm font-medium">No access, ask the owner</div>
            <p className="text-xs text-muted-foreground">
              The security audit reads this business&apos;s settings. Ask the business owner for access.
            </p>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-border/50 bg-card/40 p-6 flex items-center gap-6">
          <div className={`text-5xl font-bold ${scoreColor}`}>{score ?? "-"}</div>
          <div className="space-y-1">
            <div className="text-sm font-medium">Security Score</div>
            <div className="text-xs text-muted-foreground">
              {result.passed} of {result.total} checks passed
              {notTracked > 0 && <> · {notTracked} not tracked</>}
            </div>
            <div className="flex gap-1.5 mt-2">
              {Array.from({ length: result.total }).map((_, i) => (
                <div
                  key={i}
                  className={`h-2 w-6 rounded-full ${
                    i < result.passed ? "bg-emerald-500/60" : "bg-rose-500/40"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {loading && !result ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          result?.checks.map((check) => {
            const status = statusOf(check);
            return (
            <div
              key={check.id}
              data-check-status={status}
              className={`rounded-xl border p-4 flex items-start gap-3 ${cardClass(status, check.severity)}`}
            >
              {status === "not_tracked" ? (
                <CircleDashed className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              ) : status === "passed" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                SEVERITY_ICON[check.severity]
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{check.title}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-muted/50">
                    {CATEGORY_LABEL[check.category] ?? check.category}
                  </span>
                  {status === "not_tracked" && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded border border-border/60">
                      Not tracked
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{check.description}</p>
                {status !== "not_tracked" && check.recommendation && (
                  <p className="text-xs text-amber-400 mt-1.5">
                    <span className="font-medium">Recommendation:</span> {check.recommendation}
                  </p>
                )}
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
