import { cn } from "../lib/utils";

type BadgeTone = "default" | "success" | "warning" | "danger" | "info";

const toneStyles: Record<BadgeTone, string> = {
  default: "border-[hsl(var(--kf-primary))] text-[hsl(var(--kf-primary))] bg-[hsl(var(--kf-primary)/0.08)]",
  success: "border-[var(--kf-mint)] text-[var(--kf-mint)] bg-[color-mix(in srgb, var(--kf-mint) 10%, transparent)]",
  warning: "border-[var(--kf-amber)] text-[var(--kf-amber)] bg-[color-mix(in srgb, var(--kf-amber) 12%, transparent)]",
  danger: "border-[var(--kf-red)] text-[var(--kf-red)] bg-[color-mix(in srgb, var(--kf-red) 12%, transparent)]",
  info: "border-[hsl(var(--kf-accent))] text-[hsl(var(--kf-accent))] bg-[hsl(var(--kf-accent)/0.08)]",
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
        "shadow-[0_8px_20px_rgba(15,23,42,0.08)]",
        toneStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
