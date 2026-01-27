import { cn } from "../lib/utils";

export interface MomentumBarProps {
  value: number; // 0..1
  label?: string;
  streaks?: string[];
  className?: string;
}

export function MomentumBar({ value, label = "Flow Momentum", streaks = [], className }: MomentumBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] p-4 shadow-[var(--kf-shadow)]",
        className,
      )}
    >
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.16em] text-[hsl(var(--kf-muted-foreground))]">
        <span>{label}</span>
        <span className="text-[hsl(var(--kf-primary))]">{Math.round(clamped * 100)}%</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--kf-muted))]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-primary))] via-[hsl(var(--kf-accent))] to-[var(--kf-mint)] transition-[width] duration-300 ease-flow shadow-[0_6px_16px_hsl(var(--kf-primary)/0.25)]"
          style={{ width: `${Math.round(clamped * 100)}%` }}
        />
      </div>
      {streaks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {streaks.map((s) => (
            <span
              key={s}
              className="rounded-full border border-[hsl(var(--kf-primary))] bg-[hsl(var(--kf-primary)/0.08)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--kf-primary))]"
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
