import { cn } from "../lib/utils";

export interface AchievementProps {
  title: string;
  description?: string;
  tone?: "success" | "info" | "danger";
  className?: string;
}

const toneGlows = {
  success: "shadow-[0_0_20px_rgba(76,255,206,0.3)] border-[rgba(76,255,206,0.6)]",
  info: "shadow-[0_0_20px_rgba(78,168,255,0.25)] border-[rgba(78,168,255,0.6)]",
  danger: "shadow-[0_0_20px_rgba(255,78,78,0.25)] border-[rgba(255,78,78,0.6)]",
};

export function AchievementCapsule({ title, description, tone = "info", className }: AchievementProps) {
  return (
    <div
      className={cn(
        "relative isolate flex flex-col gap-1 rounded-full border px-4 py-3",
        "bg-[rgba(31,34,37,0.85)] text-[var(--kf-text)] backdrop-blur-md",
        "transition-all duration-200 ease-flow hover:-translate-y-0.5 hover:scale-[1.01]",
        toneGlows[tone],
        className,
      )}
    >
      <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[rgba(78,168,255,0.12)] via-transparent to-[rgba(163,116,255,0.12)] opacity-80" />
      <div className="relative z-10 text-sm font-semibold">{title}</div>
      {description && (
        <div className="relative z-10 text-xs text-[var(--kf-text-muted)]">{description}</div>
      )}
    </div>
  );
}
