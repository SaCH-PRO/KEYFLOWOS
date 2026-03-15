"use client";

import { useState, useMemo, useCallback } from "react";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Columns3, ChevronLeft, ChevronRight } from "lucide-react";

type SortDirection = "asc" | "desc" | null;

interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  hidden?: boolean;
  width?: string;
  render?: (row: T) => React.ReactNode;
  getValue?: (row: T) => string | number;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyField: keyof T;
  searchable?: boolean;
  searchPlaceholder?: string;
  selectable?: boolean;
  selectedKeys?: Set<string | number>;
  onSelectionChange?: (keys: Set<string | number>) => void;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  emptyMessage?: string;
  emptyState?: React.ReactNode;
  headerExtra?: React.ReactNode;
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  keyField,
  searchable = true,
  searchPlaceholder = "Search...",
  selectable = false,
  selectedKeys,
  onSelectionChange,
  onRowClick,
  pageSize = 25,
  emptyMessage = "No data found",
  emptyState,
  headerExtra,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.hidden).map((c) => c.key)),
  );
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [page, setPage] = useState(0);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenCols.has(c.key)),
    [columns, hiddenCols],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return data;
    return data.filter((row) => {
      const rowText = visibleColumns
        .map((col) => {
          const val = col.getValue ? col.getValue(row) : row[col.key];
          return String(val ?? "").toLowerCase();
        })
        .join(" ");
      return tokens.every((token) => rowText.includes(token));
    });
  }, [data, search, visibleColumns]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    return [...filtered].sort((a, b) => {
      const aVal = col?.getValue ? col.getValue(a) : a[sortKey];
      const bVal = col?.getValue ? col.getValue(b) : b[sortKey];
      const cmp = String(aVal ?? "").localeCompare(String(bVal ?? ""), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = useCallback((key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((prev) => {
        if (prev === "asc") return "desc";
        if (prev === "desc") { setSortKey(null); return null; }
        return "asc";
      });
    }
  }, [sortKey]);

  const toggleCol = useCallback((key: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleRow = useCallback(
    (key: string | number) => {
      if (!onSelectionChange || !selectedKeys) return;
      const next = new Set(selectedKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onSelectionChange(next);
    },
    [selectedKeys, onSelectionChange],
  );

  const toggleAll = useCallback(() => {
    if (!onSelectionChange) return;
    const allKeys = pageData.map((r) => r[keyField] as string | number);
    const allSelected = allKeys.every((k) => selectedKeys?.has(k));
    onSelectionChange(allSelected ? new Set() : new Set(allKeys));
  }, [pageData, keyField, selectedKeys, onSelectionChange]);

  return (
    <div className="kf-card kf-radius-lg overflow-hidden">
      {(searchable || headerExtra || columns.some((c) => c.hidden)) && (
        <div
          className="flex items-center gap-2 px-3 py-2 border-b"
          style={{ borderColor: "hsl(var(--kf-border))" }}
        >
          {searchable && (
            <div className="relative flex-1 max-w-xs">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: "hsl(var(--kf-muted-foreground))" }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-3 py-1.5 kf-radius-sm kf-text-caption"
                style={{
                  background: "hsl(var(--kf-muted))",
                  color: "hsl(var(--kf-foreground))",
                  border: "none",
                  outline: "none",
                }}
              />
            </div>
          )}
          {headerExtra}
          <div className="relative ml-auto">
            <button
              onClick={() => setColMenuOpen(!colMenuOpen)}
              className="w-7 h-7 kf-radius-sm flex items-center justify-center transition-colors"
              style={{ color: "hsl(var(--kf-muted-foreground))" }}
              aria-label="Toggle columns"
              aria-expanded={colMenuOpen}
            >
              <Columns3 className="w-3.5 h-3.5" />
            </button>
            {colMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-30 min-w-[160px] kf-radius-lg border p-1 shadow-lg"
                style={{
                  background: "hsl(var(--kf-popover))",
                  borderColor: "hsl(var(--kf-border))",
                }}
              >
                {columns.map((col) => (
                  <button
                    key={col.key}
                    onClick={() => toggleCol(col.key)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 kf-radius-sm kf-text-caption text-left transition-colors"
                    style={{ color: "hsl(var(--kf-foreground))" }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0"
                      style={{
                        borderColor: !hiddenCols.has(col.key) ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-border))",
                        background: !hiddenCols.has(col.key) ? "hsl(var(--kf-accent1))" : "transparent",
                      }}
                    >
                      {!hiddenCols.has(col.key) && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke="hsl(var(--kf-primary-foreground))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {col.header}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr
              className="border-b"
              style={{ borderColor: "hsl(var(--kf-border))" }}
            >
              {selectable && (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={pageData.length > 0 && pageData.every((r) => selectedKeys?.has(r[keyField] as string | number))}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 kf-text-micro font-semibold uppercase tracking-wider whitespace-nowrap"
                  style={{
                    color: "hsl(var(--kf-muted-foreground))",
                    width: col.width,
                  }}
                >
                  {col.sortable !== false ? (
                    <button
                      onClick={() => handleSort(col.key)}
                      className="inline-flex items-center gap-1 transition-colors"
                      style={{ color: sortKey === col.key ? "hsl(var(--kf-foreground))" : undefined }}
                    >
                      {col.header}
                      {sortKey === col.key && sortDir === "asc" ? (
                        <ArrowUp className="w-3 h-3" />
                      ) : sortKey === col.key && sortDir === "desc" ? (
                        <ArrowDown className="w-3 h-3" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (selectable ? 1 : 0)}
                  className={emptyState ? "p-0" : "px-3 py-8 text-center kf-text-body"}
                  style={emptyState ? undefined : { color: "hsl(var(--kf-muted-foreground))" }}
                >
                  {emptyState || emptyMessage}
                </td>
              </tr>
            ) : (
              pageData.map((row) => {
                const rowKey = row[keyField] as string | number;
                const isSelected = selectedKeys?.has(rowKey);
                return (
                  <tr
                    key={rowKey}
                    onClick={() => onRowClick?.(row)}
                    className={`border-b transition-colors ${onRowClick ? "cursor-pointer" : ""}`}
                    style={{
                      borderColor: "hsl(var(--kf-border) / 0.5)",
                      background: isSelected ? "hsl(var(--kf-accent1) / 0.05)" : undefined,
                    }}
                  >
                    {selectable && (
                      <td className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected ?? false}
                          onChange={() => toggleRow(rowKey)}
                          className="rounded"
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        className="px-3 py-2 kf-text-body"
                        style={{ color: "hsl(var(--kf-foreground))" }}
                      >
                        {col.render ? col.render(row) : String(row[col.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div
          className="flex items-center justify-between px-3 py-2 border-t"
          style={{ borderColor: "hsl(var(--kf-border))" }}
        >
          <span
            className="kf-text-micro"
            style={{ color: "hsl(var(--kf-muted-foreground))" }}
          >
            {sorted.length} result{sorted.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="w-7 h-7 kf-radius-sm flex items-center justify-center disabled:opacity-30"
              style={{ color: "hsl(var(--kf-muted-foreground))" }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span
              className="kf-text-micro px-2 tabular-nums"
              style={{ color: "hsl(var(--kf-muted-foreground))" }}
            >
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="w-7 h-7 kf-radius-sm flex items-center justify-center disabled:opacity-30"
              style={{ color: "hsl(var(--kf-muted-foreground))" }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export type { Column, DataTableProps, SortDirection };
