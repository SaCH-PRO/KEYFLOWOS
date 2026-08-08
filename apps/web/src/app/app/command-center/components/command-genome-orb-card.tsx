"use client";

import { Dna, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useGenome } from "@/contexts/genome-context";
import { GenomeOrb } from "@/components/genome/genome-orb";

export function CommandGenomeOrbCard() {
  const { genome, loading, error, refresh } = useGenome();

  return (
    <div className="relative surface flex flex-col gap-3 p-4 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background: "radial-gradient(circle at 0% 0%, hsl(var(--kf-primary) / 0.12), transparent 50%)",
        }}
      />
      <div className="relative flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <Dna className="h-3.5 w-3.5 text-primary" />
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-foreground">Business Genome</h3>
          <p className="text-[10px] text-muted-foreground">Evidence-backed readiness</p>
        </div>
      </div>

      {error ? (
        <button
          onClick={() => refresh()}
          className="relative text-xs text-rose hover:text-rose/80 transition-colors"
        >
          Failed to load genome. Retry.
        </button>
      ) : (
        <GenomeOrb genome={genome} compact className={loading ? "opacity-70" : undefined} />
      )}

      <Link
        href="/app/genome"
        className="relative inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
      >
        Open Genome <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
