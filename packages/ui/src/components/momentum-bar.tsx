import { cn } from "../lib/utils";

export interface MomentumBarProps {
  value: number;
  label?: string;
  streaks?: string[];
  className?: string;
}

export function MomentumBar({ value, label = "Flow Momentum", streaks = [], className }: MomentumBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between text-xs uppercase tracking-widest font-medium">
        <span className="text-[hsl(var(--kf-muted-foreground))]">{label}</span>
        <span style={{ color: "hsl(var(--kf-accent1))" }}>{Math.round(clamped * 100)}%</span>
      </div>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-[hsl(var(--kf-muted))]">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ 
            width: `${Math.round(clamped * 100)}%`,
            background: "hsl(var(--kf-accent1))",
            boxShadow: "0 0 12px hsl(var(--kf-accent1) / 0.4)"
          }}
        />
      </div>
      {streaks.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {streaks.map((s) => (
            <span
              key={s}
              className="rounded-xl border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
              style={{
                borderColor: "hsl(var(--kf-accent2) / 0.4)",
                background: "hsl(var(--kf-accent2) / 0.15)",
                color: "hsl(var(--kf-accent2))"
              }}
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
