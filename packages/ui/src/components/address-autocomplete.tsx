"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/utils";

export interface AddressPrediction {
  placeId: string;
  description: string;
  mainText?: string;
  secondaryText?: string;
}

export interface AddressPlaceDetails {
  placeId: string;
  formattedAddress: string;
  name?: string;
  lat?: number;
  lng?: number;
  components?: Record<string, string>;
  phone?: string;
  website?: string;
  raw?: unknown;
}

export interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (place: AddressPlaceDetails) => void | Promise<void>;
  /** User-supplied async search function. Should debounce-friendly. */
  search: (input: string) => Promise<AddressPrediction[]>;
  /** Optional: fetch place details after selection. */
  fetchPlaceDetails?: (placeId: string) => Promise<AddressPlaceDetails | null>;
  placeholder?: string;
  label?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  /** Minimum chars before search runs. */
  minLength?: number;
  /** Debounce ms. */
  debounceMs?: number;
  id?: string;
  /** Show a small note when no API key / disabled. */
  disabledReason?: string;
}

export interface AddressAutocompleteHandle {
  focus: () => void;
  clear: () => void;
}

export const AddressAutocomplete = forwardRef<
  AddressAutocompleteHandle,
  AddressAutocompleteProps
>(function AddressAutocomplete(
  {
    value,
    onChange,
    onSelect,
    search,
    fetchPlaceDetails,
    placeholder = "Start typing an address…",
    label,
    hint,
    multiline = false,
    rows = 3,
    disabled = false,
    className,
    inputClassName,
    minLength = 3,
    debounceMs = 220,
    id,
    disabledReason,
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [predictions, setPredictions] = useState<AddressPrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const skipNextSearchRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      clear: () => {
        onChange("");
        setPredictions([]);
        setOpen(false);
        setActiveIndex(-1);
      },
    }),
    [onChange],
  );

  const runSearch = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (trimmed.length < minLength) {
        setPredictions([]);
        setLoading(false);
        return;
      }
      const reqId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const results = await search(trimmed);
        if (reqId !== requestIdRef.current) return;
        setPredictions(results.slice(0, 8));
        setOpen(true);
        setActiveIndex(-1);
      } catch (err) {
        if (reqId !== requestIdRef.current) return;
        const msg = err instanceof Error ? err.message : "Lookup failed";
        setError(msg);
        setPredictions([]);
      } finally {
        if (reqId === requestIdRef.current) setLoading(false);
      }
    },
    [search, minLength],
  );

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(value);
    }, debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, debounceMs, runSearch]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const choose = useCallback(
    async (p: AddressPrediction) => {
      skipNextSearchRef.current = true;
      onChange(p.description);
      setOpen(false);
      setActiveIndex(-1);
      if (onSelect) {
        let details: AddressPlaceDetails | null = null;
        if (fetchPlaceDetails) {
          try {
            details = await fetchPlaceDetails(p.placeId);
          } catch {
            details = null;
          }
        }
        await onSelect(
          details ?? {
            placeId: p.placeId,
            formattedAddress: p.description,
          },
        );
      }
    },
    [onChange, onSelect, fetchPlaceDetails],
  );

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (!open || predictions.length === 0) {
      if (e.key === "ArrowDown") {
        runSearch(value);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      setActiveIndex((i) => (i + 1) % predictions.length);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActiveIndex((i) => (i <= 0 ? predictions.length - 1 : i - 1));
      e.preventDefault();
    } else if (e.key === "Enter") {
      const target = activeIndex >= 0 ? predictions[activeIndex] : predictions[0];
      if (target) {
        choose(target);
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const inputBase = useMemo(
    () =>
      cn(
        "w-full rounded-lg bg-[var(--kf-glass)] border border-[var(--kf-border)] px-3 py-2 text-sm text-[var(--kf-text)]",
        "focus:outline-none focus:ring-2 focus:ring-[var(--kf-electric)] focus:border-transparent transition-all duration-150",
        disabled ? "opacity-60 cursor-not-allowed" : "",
        inputClassName,
      ),
    [disabled, inputClassName],
  );

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full text-sm text-[var(--kf-text)]", className)}
    >
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs text-[var(--kf-text-muted)] mb-1"
        >
          {label}
        </label>
      )}
      {multiline ? (
        <textarea
          id={inputId}
          ref={(el) => {
            inputRef.current = el;
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => predictions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={cn(inputBase, "resize-none")}
          autoComplete="off"
          spellCheck={false}
        />
      ) : (
        <input
          id={inputId}
          ref={(el) => {
            inputRef.current = el;
          }}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => predictions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className={inputBase}
          autoComplete="off"
          spellCheck={false}
        />
      )}

      {loading && (
        <div className="pointer-events-none absolute right-2 top-2 text-[10px] text-[var(--kf-text-muted)]">
          Searching…
        </div>
      )}

      {open && predictions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-[var(--kf-border)] bg-[var(--kf-surface,theme(colors.zinc.900))] shadow-xl backdrop-blur"
          style={{ background: "hsl(var(--card, 222 14% 8%))" }}
        >
          {predictions.map((p, i) => {
            const active = i === activeIndex;
            return (
              <li
                key={p.placeId}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm flex flex-col gap-0.5 border-b border-[var(--kf-border)] last:border-b-0",
                  active ? "bg-[var(--kf-glass)]" : "",
                )}
              >
                <span className="truncate">{p.mainText ?? p.description}</span>
                {p.secondaryText && (
                  <span className="text-[11px] text-[var(--kf-text-muted)] truncate">
                    {p.secondaryText}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="mt-1 text-[11px] text-red-400">{error}</p>
      )}
      {!error && hint && (
        <p className="mt-1 text-[11px] text-[var(--kf-text-muted)]">{hint}</p>
      )}
      {disabled && disabledReason && (
        <p className="mt-1 text-[11px] text-amber-400/80">{disabledReason}</p>
      )}
    </div>
  );
});
