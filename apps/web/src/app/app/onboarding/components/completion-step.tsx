"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, FileText, Users, AlertCircle } from "lucide-react";
import { markOnboardingComplete, type DemoSeedResult } from "@/lib/api/onboarding-concierge";
import { getStoredBusinessId } from "@/lib/workspace";

export function CompletionStep() {
  const router = useRouter();
  const businessId = getStoredBusinessId();
  const [demoData, setDemoData] = useState<DemoSeedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingPillars, setMissingPillars] = useState<string[] | null>(null);
  const [alreadyComplete, setAlreadyComplete] = useState(false);

  const complete = useCallback(async () => {
    if (!businessId) {
      setError("No business selected. Please restart onboarding.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err, rawError } = await markOnboardingComplete(businessId);
    if (err) {
      setError(typeof err === "string" ? err : "Could not finish onboarding. Please try again.");
      const rawMissingPillars =
        (rawError?.details && (rawError.details as Record<string, unknown>).missingPillars) ||
        rawError?.missingPillars;
      if (rawError?.code === "GENOME_GATE_BLOCKED" && Array.isArray(rawMissingPillars)) {
        setMissingPillars(rawMissingPillars as string[]);
      }
      setLoading(false);
      return;
    }
    setMissingPillars(null);
    if (data?.alreadyComplete) {
      setAlreadyComplete(true);
    } else if (data?.demoData) {
      setDemoData(data.demoData);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration: runs the completion request on mount
    complete();
  }, [complete]);

  return (
    <div className="space-y-6 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10">
        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">You&apos;re all set!</h2>
        <p className="text-sm text-muted-foreground">
          Your Business Genome is ready and your Command Center is waiting.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 max-w-md mx-auto">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-left">
              <p className="text-sm font-medium text-destructive">Something went wrong</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
              {missingPillars && missingPillars.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-destructive">Missing DNA pillars:</p>
                  <ul className="mt-1.5 space-y-1">
                    {missingPillars.map((pillar) => (
                      <li key={pillar} className="text-xs text-muted-foreground capitalize">
                        • {pillar.replace(/-/g, " ")}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground mt-2">
                    Go back and complete these sections before finishing onboarding.
                  </p>
                </div>
              )}
              <button
                onClick={complete}
                className="mt-3 text-xs font-medium underline text-destructive hover:text-destructive/80"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Adding a sample invoice and contact…</span>
        </div>
      ) : alreadyComplete ? (
        <div className="rounded-xl border border-border/40 bg-card/40 p-4 max-w-md mx-auto">
          <p className="text-sm text-muted-foreground">
            Your workspace is already set up. Head to your Command Center to keep going.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/40 bg-card/40 p-4 max-w-md mx-auto">
          <p className="text-xs text-muted-foreground mb-3">
            We added a sample record so your dashboard isn&apos;t empty:
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-background border border-border/40">
              <Users className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              <div className="text-left">
                <p className="text-xs font-medium">Sample Client</p>
                <p className="text-[10px] text-muted-foreground">Contact</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-background border border-border/40">
              <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              <div className="text-left">
                <p className="text-xs font-medium">{demoData?.invoiceNumber ?? "DEMO-001"}</p>
                <p className="text-[10px] text-muted-foreground">$500 TTD invoice</p>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">
            These are clearly labeled as demo data — delete them anytime.
          </p>
        </div>
      )}

      <div className="flex justify-center">
        <button
          onClick={() => router.push("/app/command-center?onboarding=complete")}
          disabled={loading || !!error}
          className="px-6 py-3 rounded-xl font-semibold text-sm bg-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1-foreground))] hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        >
          Go to Command Center
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
