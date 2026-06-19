"use client";

import { useRouter } from "next/navigation";
import { ScrollText, ArrowRight, AlertTriangle } from "lucide-react";
import type { CommandCenterConstitution } from "@/lib/api/business-command-center";

interface CommandConstitutionCardProps {
  constitution: CommandCenterConstitution;
}

export function CommandConstitutionCard({ constitution }: CommandConstitutionCardProps) {
  const router = useRouter();

  return (
    <div className="rounded-2xl border border-border/30 bg-card/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
          <ScrollText className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Constitution</h3>
          <p className="text-[10px] text-muted-foreground">
            {constitution.latestVersion ? `Version ${constitution.latestVersion}` : "Not generated"}
          </p>
        </div>
      </div>
      {constitution.stale ? (
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded-lg p-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          {constitution.reason || "Constitution is stale"}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Constitution is current.</div>
      )}
      <button
        onClick={() => router.push(constitution.href)}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:text-[hsl(var(--kf-accent1))]/80 transition-colors"
      >
        Open Constitution <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}
