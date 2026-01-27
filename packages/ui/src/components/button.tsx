import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../lib/utils";

type Variant = "default" | "secondary" | "outline" | "subtle";
type Size = "xs" | "sm" | "md";

const variantStyles: Record<Variant, string> = {
  default:
    "bg-gradient-to-br from-[hsl(var(--kf-primary))] to-[hsl(var(--kf-accent))] text-[hsl(var(--kf-primary-foreground))] hover:brightness-110 focus-visible:ring-[hsl(var(--kf-ring))] shadow-[0_14px_30px_hsl(var(--kf-primary)/0.25)]",
  secondary:
    "bg-[hsl(var(--kf-secondary))] text-[hsl(var(--kf-secondary-foreground))] border border-[hsl(var(--kf-border))] hover:bg-[hsl(var(--kf-muted))] focus-visible:ring-[hsl(var(--kf-ring))]",
  outline:
    "border border-[hsl(var(--kf-border))] text-[hsl(var(--kf-foreground))] hover:bg-[hsl(var(--kf-muted))] focus-visible:ring-[hsl(var(--kf-ring))]",
  subtle:
    "bg-[hsl(var(--kf-card))] text-[hsl(var(--kf-foreground))] hover:bg-[hsl(var(--kf-muted))] focus-visible:ring-[hsl(var(--kf-ring))]",
};

const sizeStyles: Record<Size, string> = {
  xs: "h-8 px-3 text-xs rounded-2xl",
  sm: "h-9 px-4 text-sm rounded-2xl",
  md: "h-11 px-5 text-sm rounded-2xl",
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
          "inline-flex items-center justify-center whitespace-nowrap font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--kf-background))] disabled:pointer-events-none disabled:opacity-50",
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
