import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../lib/utils";

type Variant = "default" | "secondary" | "outline" | "subtle" | "destructive" | "ghost";
type Size = "xs" | "sm" | "md" | "lg";

const variantStyles: Record<Variant, string> = {
  default:
    "bg-[hsl(var(--kf-accent1,24_95%_53%))] text-white hover:brightness-110 focus-visible:ring-[hsl(var(--kf-accent1,24_95%_53%))]",
  secondary:
    "bg-[hsl(var(--kf-muted,240_4%_12%))] text-[hsl(var(--kf-foreground,0_0%_95%))] border border-[hsl(var(--kf-border,240_4%_14%))] hover:bg-[hsl(var(--kf-muted-foreground,240_4%_46%)/0.12)] focus-visible:ring-[hsl(var(--kf-border,240_4%_14%))]",
  outline:
    "border border-[hsl(var(--kf-border,240_4%_14%))] text-[hsl(var(--kf-foreground,0_0%_95%))] hover:bg-[hsl(var(--kf-muted,240_4%_12%))] focus-visible:ring-[hsl(var(--kf-border,240_4%_14%))]",
  subtle:
    "bg-[hsl(var(--kf-muted,240_4%_12%)/0.5)] text-[hsl(var(--kf-foreground,0_0%_95%))] hover:bg-[hsl(var(--kf-muted,240_4%_12%))] focus-visible:ring-[hsl(var(--kf-border,240_4%_14%))]",
  destructive:
    "bg-[hsl(var(--kf-destructive,0_62%_50%))] text-white hover:brightness-110 focus-visible:ring-[hsl(var(--kf-destructive,0_62%_50%))]",
  ghost:
    "text-[hsl(var(--kf-muted-foreground,240_4%_46%))] hover:text-[hsl(var(--kf-foreground,0_0%_95%))] hover:bg-[hsl(var(--kf-muted,240_4%_12%))] focus-visible:ring-[hsl(var(--kf-border,240_4%_14%))]",
};

const sizeStyles: Record<Size, string> = {
  xs: "h-7 px-2.5 text-xs gap-1 rounded-md",
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-9 px-4 text-sm gap-2 rounded-lg",
  lg: "h-10 px-5 text-sm gap-2 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
          sizeStyles[size],
          variantStyles[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
