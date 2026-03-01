import type { Contact } from "@/lib/client";

export type Period = "7d" | "30d" | "90d" | "custom";

export const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "custom": "Custom",
};

export const PERIOD_MS: Record<Exclude<Period, "custom">, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

export function formatTTD(value: number): string {
  return `TTD ${value.toLocaleString("en-TT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } },
  item: { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } } },
};

export const RECHARTS_TOOLTIP_STYLE = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border)/0.5)',
    borderRadius: '0.75rem',
    color: 'hsl(var(--foreground))',
    fontSize: '11px',
    padding: '6px 10px',
  },
  cursor: { fill: 'hsl(var(--border)/0.1)' },
};

export function buildWeeklyBuckets(contacts: Contact[], weeks: number): number[] {
  const now = Date.now();
  const buckets: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = now - (i + 1) * 7 * 86_400_000;
    const end = now - i * 7 * 86_400_000;
    buckets.push(contacts.filter((c) => {
      const d = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      return d >= start && d < end;
    }).length);
  }
  return buckets;
}
