"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredBusinessId } from "@/lib/workspace";

export function useBusinessId() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only storage hydration
    setBusinessId(getStoredBusinessId());
  }, []);
  return businessId;
}

export function CardFrame({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-sm",
        className
      )}
    >
      {title && (
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
          <Sparkles className="h-4 w-4 text-[hsl(var(--kf-accent1))]" />
          <h4 className="text-sm font-semibold">{title}</h4>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function PrimaryButton({
  onClick,
  disabled,
  loading,
  children,
  className,
  type = "button",
}: {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium",
        "bg-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1-foreground))] hover:brightness-110",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function SecondaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function FieldLabel({ children, helper }: { children: React.ReactNode; helper?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{children}</label>
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
    />
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | "";
  onChange: (value: number | "") => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? "" : Number(v));
      }}
      placeholder={placeholder}
      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="min-h-[80px] w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
    />
  );
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder = "Choose one",
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string } | string>;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => {
        const optionValue = typeof opt === "string" ? opt : opt.value;
        const optionLabel = typeof opt === "string" ? opt : opt.label;
        return (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        );
      })}
    </select>
  );
}

// Generic over the option value so callers keep their own narrow type: a
// string-valued toggle gets Dispatch<SetStateAction<string>> and a boolean one
// gets Dispatch<SetStateAction<boolean>>. A `string | boolean` union here would
// be assignable from neither.
export function ToggleButton<T extends string | boolean>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-xl border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1)/0.1)] text-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
