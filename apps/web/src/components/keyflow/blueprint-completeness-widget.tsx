"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import { apiGet } from "@/lib/api";

interface Props {
  businessId: string | null;
}

interface BlueprintLite {
  completeness: number;
}

interface SetupStep {
  id: string;
  label: string;
  done: boolean;
}

// KEY-1 Cockpit widget — surfaces blueprint completeness on the
// /app/keyflow-command landing page so operators see progress before
// the full Cockpit redesign ships in KEY-7.
export function BlueprintCompletenessWidget({ businessId }: Props) {
  const [completeness, setCompleteness] = useState<number | null>(null);
  const [openCount, setOpenCount] = useState<number>(0);
  const [topStep, setTopStep] = useState<SetupStep | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      const [bpRes, stepsRes] = await Promise.all([
        apiGet<{ blueprint: BlueprintLite }>(`/blueprint/businesses/${businessId}`),
        apiGet<{ steps: SetupStep[] }>(`/blueprint/businesses/${businessId}/setup-steps`),
      ]);
      if (cancelled) return;
      if (bpRes.data?.blueprint) setCompleteness(bpRes.data.blueprint.completeness);
      if (stepsRes.data?.steps) {
        const open = stepsRes.data.steps.filter((s) => !s.done);
        setOpenCount(open.length);
        setTopStep(open[0] ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  if (completeness === null) return null;

  return (
    <Link
      href="/app/genome"
      className="block rounded-2xl border border-border bg-card p-4 hover:border-orange-500/40 transition-colors group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-orange-500/10 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-orange-500" />
          </div>
          <h3 className="text-sm font-semibold">Business Blueprint</h3>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
      <div className="space-y-2">
        <div className="flex items-end justify-between">
          <div className="text-2xl font-bold">{completeness}%</div>
          <div className="text-[11px] text-muted-foreground">
            {openCount === 0 ? "All sections complete" : `${openCount} section${openCount === 1 ? "" : "s"} open`}
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all"
            style={{ width: `${completeness}%` }}
          />
        </div>
        {topStep && (
          <p className="text-[11px] text-muted-foreground pt-1">
            Next: <span className="text-foreground">{topStep.label}</span>
          </p>
        )}
      </div>
    </Link>
  );
}
