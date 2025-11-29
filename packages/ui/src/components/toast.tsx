import { cn } from "../lib/utils";

export interface ToastProps {
  message: string;
  tone?: "info" | "success" | "warning" | "danger";
}

const toneStyles: Record<NonNullable<ToastProps["tone"]>, string> = {
  info: "border-[rgba(78,168,255,0.35)] bg-[rgba(78,168,255,0.08)] text-[var(--kf-text)]",
  success: "border-[rgba(76,255,206,0.4)] bg-[rgba(76,255,206,0.08)] text-[var(--kf-text)]",
  warning: "border-[rgba(255,195,77,0.4)] bg-[rgba(255,195,77,0.1)] text-[var(--kf-text)]",
  danger: "border-[rgba(255,78,78,0.4)] bg-[rgba(255,78,78,0.1)] text-[var(--kf-text)]",
};

export function Toast({ message, tone = "info" }: ToastProps) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-sm shadow-[0_10px_30px_rgba(0,0,0,0.35)]",
        toneStyles[tone],
      )}
    >
      {message}
    </div>
  );
}
