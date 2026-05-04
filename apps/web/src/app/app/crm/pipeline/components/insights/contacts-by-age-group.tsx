"use client";

import { useMemo } from "react";
import type { Contact } from "@/lib/client";
import { CONTACT_AGE_GROUPS, getContactAgeGroupLabel } from "@/lib/crm-constants";

interface Props {
  contacts: Contact[];
}

export function ContactsByAgeGroup({ contacts }: Props) {
  const data = useMemo(() => {
    const counts: Record<string, number> = { UNKNOWN: 0 };
    CONTACT_AGE_GROUPS.forEach((g) => (counts[g] = 0));
    contacts.forEach((c) => {
      const ag = (c as { ageGroup?: string | null }).ageGroup ?? "UNKNOWN";
      counts[ag] = (counts[ag] || 0) + 1;
    });
    const max = Math.max(1, ...Object.values(counts));
    return [...CONTACT_AGE_GROUPS, "UNKNOWN"].map((g) => ({
      key: g,
      label: g === "UNKNOWN" ? "Unknown" : getContactAgeGroupLabel(g),
      count: counts[g] || 0,
      pct: ((counts[g] || 0) / max) * 100,
    }));
  }, [contacts]);

  const total = data.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return (
      <div className="text-[11px] text-muted-foreground/60 py-4 text-center">
        Age group data appears as contacts are added with age info
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.key} className="flex items-center gap-2 text-[11px]">
          <div className="w-20 shrink-0 text-muted-foreground truncate">{d.label}</div>
          <div className="flex-1 h-2 bg-muted/20 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${d.pct}%`,
                background: "hsl(var(--kf-accent2))",
                opacity: d.count > 0 ? 0.85 : 0,
              }}
            />
          </div>
          <div className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{d.count}</div>
        </div>
      ))}
    </div>
  );
}
