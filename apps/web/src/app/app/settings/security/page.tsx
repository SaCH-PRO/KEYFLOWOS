"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface SecurityCheck {
  id: string;
  category: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  passed: boolean;
  recommendation?: string;
}

interface AuditResult {
  score: number;
  passed: number;
  total: number;
  checks: SecurityCheck[];
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

  const runAudit = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await apiGet<AuditResult>(`/security/businesses/${businessId}/audit`);
      if (res.error) throw new Error(res.error);
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

  const scoreColor =
    (result?.score ?? 100) >= 90
      ? "text-emerald-400"
      : (result?.score ?? 100) >= 70
      ? "text-amber-400"
      : "text-rose-400";

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
        <button
          type="button"
          onClick={() => void runAudit()}
          disabled={loading}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-border/60 bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Run audit
        </button>
      </div>

      {result && (
        <div className="rounded-2xl border border-border/50 bg-card/40 p-6 flex items-center gap-6">
          <div className={`text-5xl font-bold ${scoreColor}`}>{result.score}</div>
          <div className="space-y-1">
            <div className="text-sm font-medium">Security Score</div>
            <div className="text-xs text-muted-foreground">
              {result.passed} of {result.total} checks passed
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
          result?.checks.map((check) => (
            <div
              key={check.id}
              className={`rounded-xl border p-4 flex items-start gap-3 ${
                check.passed
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : check.severity === "critical"
                  ? "border-rose-500/20 bg-rose-500/5"
                  : "border-amber-500/20 bg-amber-500/5"
              }`}
            >
              {check.passed ? (
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
                </div>
                <p className="text-xs text-muted-foreground mt-1">{check.description}</p>
                {check.recommendation && (
                  <p className="text-xs text-amber-400 mt-1.5">
                    <span className="font-medium">Recommendation:</span> {check.recommendation}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
