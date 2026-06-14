"use client";

import { forwardRef } from "react";

interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value?: number | "";
  onChange?: (value: number | null) => void;
  currency?: string;
  min?: number;
  max?: number;
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, currency = "TTD", min, max, className = "", ...props }, ref) => {
    const numericValue = value === "" || value == null ? "" : Number(value);

    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          {currency}
        </span>
        <input
          ref={ref}
          type="number"
          min={min}
          max={max}
          step={0.01}
          value={numericValue}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange?.(null);
              return;
            }
            const parsed = parseFloat(raw);
            if (Number.isNaN(parsed)) return;
            if (min != null && parsed < min) return;
            if (max != null && parsed > max) return;
            onChange?.(parsed);
          }}
          className={`
            w-full rounded-md border border-input bg-background pl-12 pr-3 py-2 text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20
            disabled:opacity-50 disabled:cursor-not-allowed
            ${className}
          `}
          {...props}
        />
      </div>
    );
  }
);
CurrencyInput.displayName = "CurrencyInput";
