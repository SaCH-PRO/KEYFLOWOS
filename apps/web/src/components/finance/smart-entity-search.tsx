"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, ChevronDown, Check } from "lucide-react";

export interface EntityOption {
  id: string;
  label: string;
  sublabel?: string | null;
  meta?: string | null;
}

interface SmartEntitySearchProps {
  value: string | null;
  onChange: (value: string | null, option?: EntityOption) => void;
  options: EntityOption[];
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  onSearch?: (query: string) => void;
  debounceMs?: number;
  createLabel?: string;
  onCreate?: () => void;
}

export function SmartEntitySearch({
  value,
  onChange,
  options,
  placeholder = "Search…",
  loading = false,
  disabled = false,
  emptyMessage = "No results found",
  onSearch,
  debounceMs = 200,
  createLabel,
  onCreate,
}: SmartEntitySearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      onSearch?.(query);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs, onSearch]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter((o) => {
    const q = debouncedQuery.toLowerCase();
    return (
      o.label.toLowerCase().includes(q) ||
      (o.sublabel?.toLowerCase().includes(q) ?? false) ||
      (o.meta?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`
          flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm
          focus-within:outline-none focus-within:ring-2 focus-within:ring-primary/20
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
          <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="max-h-60 overflow-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                {loading ? "Loading…" : emptyMessage}
              </div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onChange(option.id, option);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={`
                    flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent
                    ${option.id === value ? "bg-accent/50" : ""}
                  `}
                >
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{option.label}</span>
                    {(option.sublabel || option.meta) && (
                      <span className="text-xs text-muted-foreground">
                        {option.sublabel}
                        {option.sublabel && option.meta ? " · " : ""}
                        {option.meta}
                      </span>
                    )}
                  </div>
                  {option.id === value && <Check className="w-4 h-4 text-primary" />}
                </button>
              ))
            )}

            {onCreate && createLabel && (
              <button
                type="button"
                onClick={() => {
                  onCreate();
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-accent font-medium border-t border-border/40"
              >
                {createLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
