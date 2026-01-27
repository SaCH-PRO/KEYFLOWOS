import { cn } from "../lib/utils";

export interface AchievementProps {
  title: string;
  description?: string;
  tone?: "success" | "info" | "danger";
  className?: string;
}

const toneGlows = {
  success: "shadow-[0_12px_24px_rgba(36,208,141,0.25)] border-[var(--kf-mint)]",
  info: "shadow-[0_12px_24px_hsl(var(--kf-primary)/0.25)] border-[hsl(var(--kf-primary))]",
  danger: "shadow-[0_12px_24px_rgba(244,91,105,0.25)] border-[var(--kf-red)]",
};

export function AchievementCapsule({ title, description, tone = "info", className }: AchievementProps) {
  return (
    <div
      className={cn(
        "relative isolate flex flex-col gap-1 rounded-full border px-4 py-3",
        "bg-[hsl(var(--kf-card))] text-[hsl(var(--kf-foreground))]",
        "transition-all duration-200 ease-flow hover:-translate-y-0.5 hover:scale-[1.01]",
        toneGlows[tone],
        className,
      )}
    >
      <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[hsl(var(--kf-primary)/0.12)] via-transparent to-[hsl(var(--kf-accent)/0.12)] opacity-80" />
      <div className="relative z-10 text-sm font-semibold">{title}</div>
      {description && (
        <div className="relative z-10 text-xs text-[hsl(var(--kf-muted-foreground))]">{description}</div>
      )}
    </div>
  );
}
