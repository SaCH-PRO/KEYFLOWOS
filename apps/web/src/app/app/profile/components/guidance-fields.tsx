"use client";

import { useState, useCallback } from "react";
import { X, HelpCircle, Plus } from "lucide-react";
import { Input } from "@keyflow/ui";

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  tooltip?: string;
  icon?: React.ReactNode;
}

export function SelectField({ label, value, onChange, options, placeholder, tooltip, icon }: SelectFieldProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <label className="block text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-1.5 font-medium">
        {icon}
        {label}
        {tooltip && (
          <button
            type="button"
            className="relative ml-1"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onClick={() => setShowTip(!showTip)}
          >
            <HelpCircle className="h-3 w-3 text-muted-foreground/60" />
            {showTip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 rounded-lg text-[11px] leading-relaxed bg-popover border border-border shadow-lg z-50 text-foreground font-normal">
                {tooltip}
              </div>
            )}
          </button>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 min-h-[44px]"
      >
        <option value="">{placeholder || "Select..."}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  tooltip?: string;
  icon?: React.ReactNode;
  maxLength?: number;
  type?: string;
}

export function TextField({ label, value, onChange, placeholder, tooltip, icon, maxLength, type }: TextFieldProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <label className="block text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-1.5 font-medium">
        {icon}
        {label}
        {tooltip && (
          <button
            type="button"
            className="relative ml-1"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onClick={() => setShowTip(!showTip)}
          >
            <HelpCircle className="h-3 w-3 text-muted-foreground/60" />
            {showTip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 rounded-lg text-[11px] leading-relaxed bg-popover border border-border shadow-lg z-50 text-foreground font-normal">
                {tooltip}
              </div>
            )}
          </button>
        )}
      </div>
      <Input
        type={type || "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="min-h-[44px]"
      />
      {maxLength && (
        <p className="text-[10px] mt-1 text-right">{value.length}/{maxLength}</p>
      )}
    </label>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  tooltip?: string;
  icon?: React.ReactNode;
  rows?: number;
  maxLength?: number;
}

export function TextAreaField({ label, value, onChange, placeholder, tooltip, icon, rows, maxLength }: TextAreaFieldProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <label className="block text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-1.5 font-medium">
        {icon}
        {label}
        {tooltip && (
          <button
            type="button"
            className="relative ml-1"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onClick={() => setShowTip(!showTip)}
          >
            <HelpCircle className="h-3 w-3 text-muted-foreground/60" />
            {showTip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 rounded-lg text-[11px] leading-relaxed bg-popover border border-border shadow-lg z-50 text-foreground font-normal">
                {tooltip}
              </div>
            )}
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows || 3}
        maxLength={maxLength}
        className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 resize-none min-h-[44px]"
      />
      {maxLength && (
        <p className="text-[10px] mt-1 text-right">{value.length}/{maxLength}</p>
      )}
    </label>
  );
}

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (val: number | null) => void;
  placeholder?: string;
  tooltip?: string;
  icon?: React.ReactNode;
  prefix?: string;
  min?: number;
  max?: number;
}

export function NumberField({ label, value, onChange, placeholder, tooltip, icon, prefix, min, max }: NumberFieldProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <label className="block text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-1.5 font-medium">
        {icon}
        {label}
        {tooltip && (
          <button
            type="button"
            className="relative ml-1"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onClick={() => setShowTip(!showTip)}
          >
            <HelpCircle className="h-3 w-3 text-muted-foreground/60" />
            {showTip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 rounded-lg text-[11px] leading-relaxed bg-popover border border-border shadow-lg z-50 text-foreground font-normal">
                {tooltip}
              </div>
            )}
          </button>
        )}
      </div>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
            {prefix}
          </span>
        )}
        <Input
          type="number"
          value={value !== null ? String(value) : ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : Number(v));
          }}
          placeholder={placeholder}
          min={min}
          max={max}
          className={`min-h-[44px] ${prefix ? "pl-12" : ""}`}
        />
      </div>
    </label>
  );
}

interface SliderFieldProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  labels?: string[];
  tooltip?: string;
  icon?: React.ReactNode;
}

export function SliderField({ label, value, onChange, min = 1, max = 5, labels, tooltip, icon }: SliderFieldProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div className="text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-2 font-medium">
        {icon}
        {label}
        {tooltip && (
          <button
            type="button"
            className="relative ml-1"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onClick={() => setShowTip(!showTip)}
          >
            <HelpCircle className="h-3 w-3 text-muted-foreground/60" />
            {showTip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 rounded-lg text-[11px] leading-relaxed bg-popover border border-border shadow-lg z-50 text-foreground font-normal">
                {tooltip}
              </div>
            )}
          </button>
        )}
        <span className="ml-auto text-sm font-semibold text-foreground">{value}/{max}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer accent-[hsl(var(--kf-accent1))]"
        style={{ background: `linear-gradient(to right, hsl(var(--kf-accent1)) ${((value - min) / (max - min)) * 100}%, hsl(var(--muted) / 0.3) ${((value - min) / (max - min)) * 100}%)` }}
      />
      {labels && (
        <div className="flex justify-between mt-1">
          {labels.map((l, i) => (
            <span key={i} className={`text-[10px] ${i + min === value ? "text-foreground font-medium" : "text-muted-foreground/60"}`}>
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface TagInputProps {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  tooltip?: string;
  icon?: React.ReactNode;
}

export function TagInput({ label, tags, onChange, placeholder, tooltip, icon }: TagInputProps) {
  const [input, setInput] = useState("");
  const [showTip, setShowTip] = useState(false);

  const addTag = useCallback(() => {
    const tag = input.trim();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  }, [input, tags, onChange]);

  return (
    <div className="text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-1.5 font-medium">
        {icon}
        {label}
        {tooltip && (
          <button
            type="button"
            className="relative ml-1"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onClick={() => setShowTip(!showTip)}
          >
            <HelpCircle className="h-3 w-3 text-muted-foreground/60" />
            {showTip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 rounded-lg text-[11px] leading-relaxed bg-popover border border-border shadow-lg z-50 text-foreground font-normal">
                {tooltip}
              </div>
            )}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={placeholder || "Type and press Enter"}
          className="flex-1 min-h-[44px]"
        />
        <button
          type="button"
          onClick={addTag}
          disabled={!input.trim()}
          className="px-3 min-h-[44px] rounded-xl border border-border text-sm font-medium disabled:opacity-30 hover:bg-muted/20 transition-all flex items-center gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="hover:text-red-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface MultiSelectProps {
  label: string;
  selected: string[];
  onChange: (selected: string[]) => void;
  options: string[];
  tooltip?: string;
  icon?: React.ReactNode;
}

export function MultiSelect({ label, selected, onChange, options, tooltip, icon }: MultiSelectProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div className="text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-2 font-medium">
        {icon}
        {label}
        {tooltip && (
          <button
            type="button"
            className="relative ml-1"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onClick={() => setShowTip(!showTip)}
          >
            <HelpCircle className="h-3 w-3 text-muted-foreground/60" />
            {showTip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 rounded-lg text-[11px] leading-relaxed bg-popover border border-border shadow-lg z-50 text-foreground font-normal">
                {tooltip}
              </div>
            )}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isSelected = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(
                  isSelected
                    ? selected.filter((s) => s !== opt)
                    : [...selected, opt]
                );
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all min-h-[36px] ${
                isSelected
                  ? "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/40"
                  : "bg-muted/10 text-muted-foreground border border-border/40 hover:border-border/80"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ToggleFieldProps {
  label: string;
  value: boolean;
  onChange: (val: boolean) => void;
  tooltip?: string;
  icon?: React.ReactNode;
}

export function ToggleField({ label, value, onChange, tooltip, icon }: ToggleFieldProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
        {icon}
        {label}
        {tooltip && (
          <button
            type="button"
            className="relative ml-1"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onClick={() => setShowTip(!showTip)}
          >
            <HelpCircle className="h-3 w-3 text-muted-foreground/60" />
            {showTip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 rounded-lg text-[11px] leading-relaxed bg-popover border border-border shadow-lg z-50 text-foreground font-normal">
                {tooltip}
              </div>
            )}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-all min-h-[44px] min-w-[44px] flex items-center ${
          value
            ? "bg-[hsl(var(--kf-accent1))]"
            : "bg-muted/40"
        }`}
      >
        <div
          className={`absolute w-5 h-5 rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-[22px]" : "translate-x-[2px]"
          }`}
        />
      </button>
    </div>
  );
}
