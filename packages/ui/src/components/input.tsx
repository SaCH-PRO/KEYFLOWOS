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
      <label className="flex w-full flex-col gap-1 text-sm text-[hsl(var(--kf-foreground))]">
        {label && <span className="text-xs text-[hsl(var(--kf-muted-foreground))]">{label}</span>}
        <div className="relative">
          <input
            id={inputId}
            ref={ref}
            className={cn(
              "peer w-full rounded-xl bg-[hsl(var(--kf-card))] border border-[hsl(var(--kf-border))] px-3.5 py-2.5 text-sm text-[hsl(var(--kf-foreground))] placeholder:text-[hsl(var(--kf-muted-foreground))]",
              "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-ring))] focus:border-transparent transition-all duration-150 ease-flow",
              className,
            )}
            {...props}
          />
        </div>
        {hint && <span className="text-xs text-[hsl(var(--kf-muted-foreground))]">{hint}</span>}
      </label>
    );
  },
);

Input.displayName = "Input";
