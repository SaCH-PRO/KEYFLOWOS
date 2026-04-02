"use client";

import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { BillingSortKey } from "./commerce-types";

interface SortableHeaderProps {
  label: string;
  sortKey: BillingSortKey;
  ascKey: BillingSortKey;
  descKey: BillingSortKey;
  currentSort: BillingSortKey;
  onSort: (key: BillingSortKey) => void;
  className?: string;
}

export function SortableHeader({
  label,
  ascKey,
  descKey,
  currentSort,
  onSort,
  className = "",
}: SortableHeaderProps) {
  const isActiveAsc = currentSort === ascKey;
  const isActiveDesc = currentSort === descKey;
  const isActive = isActiveAsc || isActiveDesc;

  function handleClick() {
    if (isActiveDesc) {
      onSort(ascKey);
    } else {
      onSort(descKey);
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1 min-h-[44px] min-w-[44px] px-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
        isActive
          ? "text-foreground"
          : "text-muted-foreground/50 hover:text-muted-foreground/70"
      } ${className}`}
    >
      {label}
      {isActiveAsc ? (
        <ArrowUp className="w-2.5 h-2.5" />
      ) : isActiveDesc ? (
        <ArrowDown className="w-2.5 h-2.5" />
      ) : (
        <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
      )}
    </button>
  );
}
