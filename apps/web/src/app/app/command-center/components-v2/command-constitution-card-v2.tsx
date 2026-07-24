"use client";

import { useRouter } from "next/navigation";
import { ScrollText, ArrowRight, AlertTriangle } from "lucide-react";
import { Surface } from "@/components/ui-v2/surface";
import type { CommandCenterConstitution } from "@/lib/api/business-command-center";

interface CommandConstitutionCardV2Props {
  constitution: CommandCenterConstitution;
}

export function CommandConstitutionCardV2({ constitution }: CommandConstitutionCardV2Props) {
  const router = useRouter();

  return (
    <Surface className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet/10">
          <ScrollText className="h-3.5 w-3.5 text-violet" />
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-foreground">Constitution</h3>
          <p className="text-[10px] text-muted-foreground">
            {constitution.latestVersion ? `Version ${constitution.latestVersion}` : "Not generated"}
          </p>
        </div>
      </div>
      {constitution.stale ? (
        <div className="flex items-start gap-2 text-xs text-rose bg-rose/10 rounded-xl p-2.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          {constitution.reason || "Constitution is stale"}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Constitution is current.</div>
      )}
      <button
        onClick={() => router.push(constitution.href)}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
      >
        Open Constitution <ArrowRight className="w-3 h-3" />
      </button>
    </Surface>
  );
}
