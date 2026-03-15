"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

interface KfButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ElementType;
  iconRight?: React.ElementType;
}

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: "hsl(var(--kf-accent1))",
    color: "hsl(var(--kf-primary-foreground))",
    border: "none",
  },
  secondary: {
    background: "hsl(var(--kf-muted))",
    color: "hsl(var(--kf-foreground))",
    border: "1px solid hsl(var(--kf-border))",
  },
  ghost: {
    background: "transparent",
    color: "hsl(var(--kf-foreground))",
    border: "none",
  },
  destructive: {
    background: "hsl(var(--kf-error))",
    color: "hsl(var(--kf-error-foreground))",
    border: "none",
  },
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "kf-text-micro px-2.5 py-1 gap-1 kf-radius-sm",
  md: "kf-text-body px-3.5 py-1.5 gap-1.5 kf-radius-md",
  lg: "kf-text-emphasis px-5 py-2.5 gap-2 kf-radius-md",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "w-3 h-3",
  md: "w-3.5 h-3.5",
  lg: "w-4 h-4",
};

export const KfButton = forwardRef<HTMLButtonElement, KfButtonProps>(
  function KfButton(
    {
      variant = "primary",
      size = "md",
      loading = false,
      icon: Icon,
      iconRight: IconRight,
      children,
      disabled,
      className = "",
      style,
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`inline-flex items-center justify-center font-medium transition-all duration-150 whitespace-nowrap select-none
          ${SIZE_CLASSES[size]}
          ${isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          ${className}`}
        style={{
          ...VARIANT_STYLES[variant],
          ...style,
        }}
        {...props}
      >
        {loading ? (
          <Loader2 className={`${ICON_SIZE[size]} animate-spin`} />
        ) : Icon ? (
          <Icon className={ICON_SIZE[size]} />
        ) : null}
        {children}
        {IconRight && !loading && <IconRight className={ICON_SIZE[size]} />}
      </button>
    );
  },
);

export type { ButtonVariant, ButtonSize };
