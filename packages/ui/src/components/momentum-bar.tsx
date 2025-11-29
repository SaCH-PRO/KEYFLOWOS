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
        "relative overflow-hidden rounded-xl border border-[var(--kf-border)] bg-[rgba(31,34,37,0.9)] p-3 shadow-glass",
        className,
      )}
    >
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.08em] text-[var(--kf-text-muted)]">
        <span>{label}</span>
        <span className="text-[var(--kf-electric)]">{Math.round(clamped * 100)}%</span>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-[rgba(213,215,218,0.08)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--kf-electric)] via-[var(--kf-pulse)] to-[var(--kf-mint)] transition-[width] duration-300 ease-flow shadow-[0_0_18px_rgba(78,168,255,0.45)]"
          style={{ width: `${Math.round(clamped * 100)}%` }}
        />
      </div>
      {streaks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {streaks.map((s) => (
            <span
              key={s}
              className="rounded-full border border-[var(--kf-electric)] bg-[rgba(78,168,255,0.08)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--kf-electric)] shadow-[0_0_10px_rgba(78,168,255,0.25)]"
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
