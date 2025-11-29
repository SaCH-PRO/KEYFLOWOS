import { cn } from "../lib/utils";

type BadgeTone = "default" | "success" | "warning" | "danger" | "info";

const toneStyles: Record<BadgeTone, string> = {
  default: "border-[var(--kf-electric)] text-[var(--kf-electric)] bg-[rgba(78,168,255,0.08)]",
  success: "border-[var(--kf-mint)] text-[var(--kf-mint)] bg-[rgba(76,255,206,0.08)]",
  warning: "border-[var(--kf-amber)] text-[var(--kf-amber)] bg-[rgba(255,195,77,0.12)]",
  danger: "border-[var(--kf-red)] text-[var(--kf-red)] bg-[rgba(255,78,78,0.1)]",
  info: "border-[var(--kf-pulse)] text-[var(--kf-pulse)] bg-[rgba(163,116,255,0.08)]",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ tone = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium",
        "shadow-[0_0_10px_rgba(78,168,255,0.18)]",
        toneStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
