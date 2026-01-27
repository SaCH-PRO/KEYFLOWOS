import { cn } from "../lib/utils";

export interface ToastProps {
  message: string;
  tone?: "info" | "success" | "warning" | "danger";
}

const toneStyles: Record<NonNullable<ToastProps["tone"]>, string> = {
  info: "border-[hsl(var(--kf-primary)/0.35)] bg-[hsl(var(--kf-primary)/0.08)] text-[hsl(var(--kf-foreground))]",
  success: "border-[var(--kf-mint)] bg-[color-mix(in srgb, var(--kf-mint) 12%, transparent)] text-[hsl(var(--kf-foreground))]",
  warning: "border-[var(--kf-amber)] bg-[color-mix(in srgb, var(--kf-amber) 12%, transparent)] text-[hsl(var(--kf-foreground))]",
  danger: "border-[var(--kf-red)] bg-[color-mix(in srgb, var(--kf-red) 12%, transparent)] text-[hsl(var(--kf-foreground))]",
};

export function Toast({ message, tone = "info" }: ToastProps) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-sm shadow-[0_12px_28px_rgba(15,23,42,0.12)]",
        toneStyles[tone],
      )}
    >
      {message}
    </div>
  );
}
