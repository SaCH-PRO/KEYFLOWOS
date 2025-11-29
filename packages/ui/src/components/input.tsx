import { forwardRef, InputHTMLAttributes, useId } from "react";
import { cn } from "../lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <label className="flex w-full flex-col gap-1 text-sm text-[var(--kf-text)]">
        {label && <span className="text-xs text-[var(--kf-text-muted)]">{label}</span>}
        <div className="relative">
          <input
            id={inputId}
            ref={ref}
            className={cn(
              "peer w-full rounded-lg bg-[var(--kf-glass)] border border-[var(--kf-border)] px-3 py-2 text-sm text-[var(--kf-text)]",
              "focus:outline-none focus:ring-2 focus:ring-[var(--kf-electric)] focus:border-transparent transition-all duration-150 ease-flow",
              className,
            )}
            {...props}
          />
          <span className="pointer-events-none absolute inset-0 rounded-lg shadow-[var(--kf-glow)] opacity-0 transition-opacity duration-200 ease-flow peer-focus:opacity-60" />
        </div>
        {hint && <span className="text-xs text-[var(--kf-text-muted)]">{hint}</span>}
      </label>
    );
  },
);

Input.displayName = "Input";
