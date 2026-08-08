"use client";

import { Dna, AlertCircle, RefreshCw } from "lucide-react";
import { useGenome } from "@/contexts/genome-context";
import { GenomeOrb } from "@/components/genome/genome-orb";

export function KeyGenomePreview() {
  const { genome, loading, error, refresh } = useGenome();

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Dna className="h-3.5 w-3.5 animate-pulse" />
          <span>Loading genome...</span>
        </div>
        <div className="h-28 rounded-2xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-rose">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Failed to load genome</span>
        </div>
        <button
          onClick={() => refresh()}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  return <GenomeOrb genome={genome} compact className="animate-reveal" />;
}
