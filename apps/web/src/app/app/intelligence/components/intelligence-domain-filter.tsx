"use client";

import type { IntelligenceDomain } from "@/lib/api/intelligence";

const DOMAINS: { id: IntelligenceDomain | "ALL"; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "EXECUTIVE", label: "Executive" },
  { id: "GENOME", label: "Genome" },
  { id: "RISK", label: "Risk" },
  { id: "ASSETS", label: "Assets" },
  { id: "TEMPORAL_FLOW", label: "Temporal" },
  { id: "OPERATIONS", label: "Operations" },
];

interface IntelligenceDomainFilterProps {
  active: IntelligenceDomain | "ALL";
  onChange: (domain: IntelligenceDomain | "ALL") => void;
}

export function IntelligenceDomainFilter({ active, onChange }: IntelligenceDomainFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DOMAINS.map((domain) => (
        <button
          key={domain.id}
          onClick={() => onChange(domain.id)}
          className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all ${
            active === domain.id
              ? "bg-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1-foreground))]"
              : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
        >
          {domain.label}
        </button>
      ))}
    </div>
  );
}
