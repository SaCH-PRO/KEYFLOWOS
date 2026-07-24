import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "glow" | "soft" | "ghost" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", isLoading, leftIcon, rightIcon, children, disabled, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-semibold text-sm transition-all focus-ring disabled:opacity-50 disabled:pointer-events-none",
          variant === "primary" && "btn-v2-primary",
          variant === "glow" && "btn-v2-glow",
          variant === "soft" && "btn-v2-soft",
          variant === "ghost" &&
            "text-foreground hover:bg-muted rounded-xl px-3 py-2 min-h-[44px]",
          variant === "icon" &&
            "h-10 w-10 rounded-xl text-foreground hover:bg-muted focus-ring",
          className,
        )}
        {...props}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {!isLoading && leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  },
);
Button.displayName = "Button";
