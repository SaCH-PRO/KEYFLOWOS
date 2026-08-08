import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id ?? generatedId;
    return (
      <div className={cn("space-y-1.5", className)}>
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-xs font-semibold text-foreground"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            "w-full min-h-[80px] rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50",
            error
              ? "border-rose focus-visible:ring-rose"
              : "border-border hover:border-border/80 focus-visible:border-primary",
          )}
          {...props}
        />
        {error ? (
          <p className="text-xs text-rose">{error}</p>
        ) : hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
