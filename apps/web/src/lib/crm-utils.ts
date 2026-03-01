export function formatTTD(value: number): string {
  return `TTD ${value.toLocaleString("en-TT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export const SCORE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  hot: { bg: "bg-red-500/15 border border-red-500/25", text: "text-red-400", label: "Hot" },
  warm: { bg: "bg-orange-500/15 border border-orange-500/25", text: "text-orange-400", label: "Warm" },
  cool: { bg: "bg-teal-500/15 border border-teal-500/25", text: "text-teal-400", label: "Cool" },
  cold: { bg: "bg-blue-500/15 border border-blue-500/25", text: "text-blue-400", label: "Cold" },
};

export function getScoreStyle(score: number) {
  if (score >= 75) return SCORE_STYLES.hot;
  if (score >= 50) return SCORE_STYLES.warm;
  if (score >= 25) return SCORE_STYLES.cool;
  return SCORE_STYLES.cold;
}

export const STATUS_COLORS: Record<string, string> = {
  LEAD: "hsl(var(--kf-accent1))",
  PROSPECT: "hsl(var(--kf-accent2))",
  CLIENT: "hsl(142 76% 36%)",
  LOST: "hsl(var(--kf-muted-foreground))",
};

export const STATUS_BADGE_CLASSES: Record<string, string> = {
  LEAD: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  PROSPECT: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  CLIENT: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  LOST: "bg-red-500/10 text-red-400/80 border-red-500/20",
};

export const STATUS_BORDER_CLASSES: Record<string, string> = {
  LEAD: "border-l-amber-500/60",
  PROSPECT: "border-l-blue-500/60",
  CLIENT: "border-l-emerald-500/60",
  LOST: "border-l-red-500/60",
};

export const STATUS_CONFIG: Record<
  string,
  { label: string; gradient: string; text: string; bg: string; border: string }
> = {
  LEAD: {
    label: "Lead",
    gradient: "from-amber-500/20 to-amber-600/10",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  PROSPECT: {
    label: "Prospect",
    gradient: "from-blue-500/20 to-blue-600/10",
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  CLIENT: {
    label: "Client",
    gradient: "from-emerald-500/20 to-emerald-600/10",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  LOST: {
    label: "Lost",
    gradient: "from-red-500/20 to-red-600/10",
    text: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
  },
};
