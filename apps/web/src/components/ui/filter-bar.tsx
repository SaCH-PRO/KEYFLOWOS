"use client";

import { useState, useCallback } from "react";
import { Filter, X, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

interface FilterOption {
  value: string;
  label: string;
}

interface FilterGroup {
  key: string;
  label: string;
  options: FilterOption[];
}

interface FilterBarProps {
  groups: FilterGroup[];
  values: Record<string, string[]>;
  onChange: (key: string, values: string[]) => void;
  onClearAll?: () => void;
}

export function FilterBar({ groups, values, onChange, onClearAll }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const totalActive = Object.values(values).reduce((sum, v) => sum + v.length, 0);

  const handleToggle = useCallback((groupKey: string, optionValue: string) => {
    const current = values[groupKey] || [];
    const next = current.includes(optionValue)
      ? current.filter((v) => v !== optionValue)
      : [...current, optionValue];
    onChange(groupKey, next);
  }, [values, onChange]);

  const handleClearAll = useCallback(() => {
    onClearAll?.();
    setOpenGroup(null);
  }, [onClearAll]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{
            background: expanded || totalActive > 0
              ? "hsl(var(--kf-accent1) / 0.1)"
              : "hsl(var(--kf-muted))",
            color: expanded || totalActive > 0
              ? "hsl(var(--kf-accent1))"
              : "hsl(var(--kf-muted-foreground))",
          }}
          aria-expanded={expanded}
          aria-label={`Filters${totalActive > 0 ? ` (${totalActive} active)` : ""}`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {totalActive > 0 && (
            <span
              className="ml-0.5 w-4 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center"
              style={{
                background: "hsl(var(--kf-accent1))",
                color: "hsl(var(--kf-primary-foreground))",
              }}
            >
              {totalActive}
            </span>
          )}
        </button>

        {totalActive > 0 && (
          <button
            onClick={handleClearAll}
            className="text-[11px] font-medium flex items-center gap-0.5 transition-colors"
            style={{ color: "hsl(var(--kf-muted-foreground))" }}
          >
            <X className="w-3 h-3" />
            Clear all
          </button>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1.5 pt-2">
              {groups.map((group) => {
                const activeCount = (values[group.key] || []).length;
                const isOpen = openGroup === group.key;

                return (
                  <div key={group.key} className="relative">
                    <button
                      onClick={() => setOpenGroup(isOpen ? null : group.key)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors"
                      style={{
                        borderColor: activeCount > 0
                          ? "hsl(var(--kf-accent1) / 0.3)"
                          : "hsl(var(--kf-border))",
                        background: activeCount > 0
                          ? "hsl(var(--kf-accent1) / 0.05)"
                          : "transparent",
                        color: activeCount > 0
                          ? "hsl(var(--kf-accent1))"
                          : "hsl(var(--kf-foreground))",
                      }}
                    >
                      {group.label}
                      {activeCount > 0 && (
                        <span className="text-[9px] font-bold">{activeCount}</span>
                      )}
                      <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>

                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.12 }}
                          className="absolute top-full left-0 mt-1 z-30 min-w-[160px] rounded-lg border p-1 shadow-lg"
                          style={{
                            background: "hsl(var(--kf-popover))",
                            borderColor: "hsl(var(--kf-border))",
                          }}
                        >
                          {group.options.map((option) => {
                            const isSelected = (values[group.key] || []).includes(option.value);
                            return (
                              <button
                                key={option.value}
                                onClick={() => handleToggle(group.key, option.value)}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors text-left"
                                style={{
                                  background: isSelected ? "hsl(var(--kf-accent1) / 0.08)" : "transparent",
                                  color: isSelected ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-foreground))",
                                }}
                              >
                                <span
                                  className="w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0"
                                  style={{
                                    borderColor: isSelected ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-border))",
                                    background: isSelected ? "hsl(var(--kf-accent1))" : "transparent",
                                  }}
                                >
                                  {isSelected && (
                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                      <path d="M2 5L4 7L8 3" stroke="hsl(var(--kf-primary-foreground))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  )}
                                </span>
                                {option.label}
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type { FilterGroup, FilterOption };
