// @keyflow:dormant — gate component used to wrap dormant module routes.
"use client";

import Link from "next/link";
import { Construction, ArrowLeft } from "lucide-react";
import { isFeatureEnabled, type DormantFeatureFlagKey } from "@/lib/feature-flags";

interface DormantFeatureGateProps {
  flag: DormantFeatureFlagKey;
  /** Display name shown in the placeholder ("Community", "Documents", …). */
  label: string;
  /** Real module content; only rendered when the flag is enabled. */
  children: React.ReactNode;
}

/**
 * Render `children` when the dormant feature flag is on; otherwise render a
 * friendly "coming soon" placeholder instead of loading the real module
 * (which would also trigger any data fetching it does on mount).
 *
 * Routes stay reachable so deep links don't 404 unexpectedly during dev.
 * In production all dormant flags default to OFF, so visitors land on the
 * placeholder.
 */
export function DormantFeatureGate({ flag, label, children }: DormantFeatureGateProps) {
  if (isFeatureEnabled(flag)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-5 rounded-2xl border border-border/60 bg-card/60 backdrop-blur p-8">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-orange-500/20 to-teal-500/20 border border-border/40 flex items-center justify-center">
          <Construction className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{label} is coming soon</h1>
          <p className="text-sm text-muted-foreground">
            We&rsquo;re tightening focus on the core operator surfaces. {label} is
            paused while we polish what&rsquo;s next.
          </p>
        </div>
        <Link
          href="/app/keyflow-command"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted/70 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to KEYFLOW
        </Link>
      </div>
    </div>
  );
}
