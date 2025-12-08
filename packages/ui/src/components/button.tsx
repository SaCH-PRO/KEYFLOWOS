import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../lib/utils";

type Variant = "default" | "secondary" | "outline" | "subtle";
type Size = "xs" | "sm" | "md";

const variantStyles: Record<Variant, string> = {
  default: "bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:ring-indigo-600",
  secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200 focus-visible:ring-slate-300",
  outline:
    "border border-slate-300 text-slate-900 hover:bg-slate-100 focus-visible:ring-slate-300",
  subtle: "bg-slate-50 border border-slate-200 text-slate-900 hover:bg-slate-100",
};

const sizeStyles: Record<Size, string> = {
  xs: "h-7 px-3 text-xs rounded-lg",
  sm: "h-8 px-3 text-sm rounded-lg",
  md: "h-10 px-4 text-sm rounded-lg",
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
          "inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
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
