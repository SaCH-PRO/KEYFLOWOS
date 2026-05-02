"use client";

import React, { memo, useCallback, useRef, Fragment } from "react";
import {
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  UserX,
  SearchX,
  Heart,
} from "lucide-react";
import type { LocalContact } from "@/lib/contacts-db";
import type { SortField, SortDir, ColumnDef } from "./hooks/use-database-state";

const STATUS_COLORS: Record<string, string> = {
  LEAD: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  PROSPECT: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  CLIENT: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  LOST: "bg-red-500/15 text-red-400 border-red-500/20",
};

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const STATUS_HOVER_BORDER: Record<string, string> = {
  LEAD: "hover:border-l-amber-400",
  PROSPECT: "hover:border-l-blue-400",
  CLIENT: "hover:border-l-emerald-400",
  LOST: "hover:border-l-red-400",
};

function getCustomFieldValue(contact: LocalContact, key: string): string {
  const custom = contact.custom;
  if (!custom || typeof custom !== "object") return "";

  const val = (custom as Record<string, unknown>)[key];
  return val ? String(val) : "";
}

function getCustomFieldsSummary(contact: LocalContact): string {
  const custom = contact.custom;
  if (!custom || typeof custom !== "object") return "";
  const reserved = new Set(["linkedinUrl", "instagramUrl", "twitterUrl", "referredBy", "nextScheduledInteraction"]);

  const entries = Object.entries(custom as Record<string, unknown>).filter(([k]) => !reserved.has(k));
  if (entries.length === 0) return "";
  return entries.slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(", ") + (entries.length > 3 ? ` +${entries.length - 3}` : "");
}

function getCellValue(contact: LocalContact, key: string): string {
  if (key === "tags") return Array.isArray(contact.tags) ? contact.tags.join(", ") : "";
  if (key === "createdAt" && contact.createdAt) {
    return new Date(contact.createdAt).toLocaleDateString("en-TT", {
      year: "numeric", month: "short", day: "numeric",
    });
  }
  if (key === "lastActive") {
    const dateStr = contact.updatedAt || contact.createdAt;
    return dateStr ? formatRelativeTime(dateStr) : "";
  }
  if (key === "referredBy") return getCustomFieldValue(contact, "referredBy");
  if (key === "linkedinUrl") return getCustomFieldValue(contact, "linkedinUrl");
  if (key === "instagramUrl") return getCustomFieldValue(contact, "instagramUrl");
  if (key === "twitterUrl") return getCustomFieldValue(contact, "twitterUrl");
  if (key === "customFields") return getCustomFieldsSummary(contact);
  switch (key) {
    case "firstName": return contact.firstName ?? "";
    case "lastName": return contact.lastName ?? "";
    case "email": return contact.email ?? "";
    case "phone": return contact.phone ?? "";
    case "status": return contact.status ?? "";
    case "companyName": return contact.companyName ?? "";
    case "jobTitle": return contact.jobTitle ?? "";
    case "city": return contact.city ?? "";
    case "country": return contact.country ?? "";
    case "source": return contact.source ?? "";
    default: return "";
  }
}

function HighlightedText({ text, search }: { text: string; search: string }) {
  if (!search || !text) return <>{text}</>;
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const ranges: [number, number][] = [];

  for (const term of terms) {
    let start = 0;
    while (start < lowerText.length) {
      const idx = lowerText.indexOf(term, start);
      if (idx === -1) break;
      ranges.push([idx, idx + term.length]);
      start = idx + 1;
    }
  }

  if (ranges.length === 0) return <>{text}</>;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) {
      last[1] = Math.max(last[1], ranges[i][1]);
    } else {
      merged.push(ranges[i]);
    }
  }

  const parts: React.JSX.Element[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const [s, e] = merged[i];
    if (cursor < s) {
      parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, s)}</Fragment>);
    }
    parts.push(
      <mark key={`h${i}`} className="bg-[hsl(var(--kf-accent1))]/20 text-inherit rounded-sm px-0.5">
        {text.slice(s, e)}
      </mark>
    );
    cursor = e;
  }
  if (cursor < text.length) {
    parts.push(<Fragment key="end">{text.slice(cursor)}</Fragment>);
  }

  return <>{parts}</>;
}

interface DatabaseTableProps {
  contacts: LocalContact[];
  page: number;
  pageSize: number;
  sortField: SortField;
  sortDir: SortDir;
  selectedIds: Set<string>;
  allPageSelected: boolean;
  somePageSelected: boolean;
  onSort: (field: SortField) => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onSelectContact?: (contactId: string) => void;
  isSortable: (key: string) => boolean;
  search: string;
  columns: ColumnDef[];
  favoriteIds?: Set<string>;
  onToggleFavorite?: (id: string) => void;
}

function TagsCell({ value, search }: { value: string; search: string }) {
  if (!value) return null;
  const tags = value.split(", ").filter(Boolean);
  const visible = tags.slice(0, 3);
  const overflow = tags.length - 3;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tag) => (
        <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded-md bg-muted/50 text-muted-foreground border border-border/30">
          <HighlightedText text={tag} search={search} />
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-[10px] text-muted-foreground/60" title={tags.slice(3).join(", ")}>
          +{overflow}
        </span>
      )}
    </div>
  );
}

function DatabaseTableInner({
  contacts,
  page,
  pageSize,
  sortField,
  sortDir,
  selectedIds,
  allPageSelected,
  somePageSelected,
  onSort,
  onToggleSelect,
  onToggleSelectAll,
  onSelectContact,
  isSortable,
  search,
  columns,
  favoriteIds,
  onToggleFavorite,
}: DatabaseTableProps) {
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const handleCheckboxRef = useCallback((el: HTMLInputElement | null) => {
    if (el) el.indeterminate = somePageSelected && !allPageSelected;
  }, [somePageSelected, allPageSelected]);

  const handleRowKeyDown = useCallback((e: React.KeyboardEvent<HTMLTableRowElement>, contactId: string, idx: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectContact?.(contactId);
    } else if (e.key === "x" || e.key === "X") {
      e.preventDefault();
      onToggleSelect(contactId);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const rows = tbodyRef.current?.querySelectorAll<HTMLElement>("tr[tabindex]");
      if (rows && idx + 1 < rows.length) rows[idx + 1].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const rows = tbodyRef.current?.querySelectorAll<HTMLElement>("tr[tabindex]");
      if (rows && idx - 1 >= 0) rows[idx - 1].focus();
    }
  }, [onSelectContact]);

  return (
    <div className="overflow-x-auto rounded-xl border border-border/40">
      <table className="w-full text-sm" role="grid" aria-label="Contacts database table">
        <thead>
          <tr className="bg-white/[0.02] border-b border-border/40">
            <th className="px-2 py-2.5 w-[40px]">
              <input
                type="checkbox"
                checked={allPageSelected}
                ref={handleCheckboxRef}
                onChange={onToggleSelectAll}
                className="w-3.5 h-3.5 rounded border-border accent-[hsl(var(--kf-accent1))] cursor-pointer"
                aria-label="Select all contacts on this page"
              />
            </th>
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider w-[40px]">#</th>
            {onToggleFavorite && (
              <th className="px-1 py-2.5 w-[32px]">
                <Heart className="w-3 h-3 text-muted-foreground/40" />
              </th>
            )}
            {columns.map((col) => {
              const sortable = isSortable(col.key);
              const isActive = sortField === col.key;
              const ariaSortValue = isActive ? (sortDir === "asc" ? "ascending" : "descending") : undefined;

              return (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider ${col.width} ${sortable ? "cursor-pointer hover:text-muted-foreground select-none transition-colors" : ""}`}
                  onClick={sortable ? () => onSort(col.key as SortField) : undefined}
                  aria-sort={ariaSortValue}
                  role="columnheader"
                  tabIndex={sortable ? 0 : undefined}
                  onKeyDown={sortable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort(col.key as SortField); } } : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortable && isActive && (
                      sortDir === "asc"
                        ? <ChevronUp className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                        : <ChevronDown className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                    )}
                    {sortable && !isActive && (
                      <ArrowUpDown className="w-3 h-3 opacity-20" />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {contacts.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (onToggleFavorite ? 3 : 2)} className="px-4 py-16 text-center">
                <div className="flex flex-col items-center gap-2">
                  {search ? (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center mb-1">
                        <SearchX className="w-5 h-5 text-muted-foreground/40" />
                      </div>
                      <p className="text-xs font-medium text-muted-foreground/70">No contacts match &ldquo;{search}&rdquo;</p>
                      <p className="text-xs text-muted-foreground/50">Try adjusting your search or filters</p>
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center mb-1">
                        <UserX className="w-5 h-5 text-muted-foreground/40" />
                      </div>
                      <p className="text-xs font-medium text-muted-foreground/70">No contacts found</p>
                      <p className="text-xs text-muted-foreground/50">Sync or add contacts to get started</p>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ) : (
            contacts.map((contact, idx) => {
              const isSelected = selectedIds.has(contact.id);
              return (
                <tr
                  key={contact.id}
                  className={`border-b border-border/20 border-l-2 border-l-transparent ${STATUS_HOVER_BORDER[contact.status ?? ""] ?? ""} hover:bg-white/[0.02] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--kf-accent1))]/40 focus-visible:ring-inset ${isSelected ? "bg-[hsl(var(--kf-accent1))]/[0.04]" : ""}`}
                  onClick={() => onSelectContact?.(contact.id)}
                  onKeyDown={(e) => handleRowKeyDown(e, contact.id, idx)}
                  role="row"
                  aria-selected={isSelected}
                  tabIndex={0}
                >
                  <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(contact.id)}
                      className="w-3.5 h-3.5 rounded border-border accent-[hsl(var(--kf-accent1))] cursor-pointer"
                      aria-label={`Select ${contact.firstName ?? ""} ${contact.lastName ?? ""}`}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-[10px] text-muted-foreground/60 font-mono">
                    {(page - 1) * pageSize + idx + 1}
                  </td>
                  {onToggleFavorite && (
                    <td className="px-1 py-2.5 w-[32px]" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onToggleFavorite(contact.id)}
                        className={`p-0.5 rounded transition-colors ${favoriteIds?.has(contact.id) ? "text-rose-400" : "text-muted-foreground/30 hover:text-rose-300"}`}
                        title={favoriteIds?.has(contact.id) ? "Remove from favorites" : "Add to favorites"}
                        aria-label={favoriteIds?.has(contact.id) ? "Remove from favorites" : "Add to favorites"}
                      >
                        <Heart className={`w-3.5 h-3.5 ${favoriteIds?.has(contact.id) ? "fill-current" : ""}`} />
                      </button>
                    </td>
                  )}
                  {columns.map((col) => {
                    const val = getCellValue(contact, col.key);

                    if (col.key === "status") {
                      return (
                        <td key={col.key} className={`px-3 py-2.5 ${col.width}`}>
                          {val ? (
                            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border ${STATUS_COLORS[val] || "bg-muted text-muted-foreground border-border/30"}`}>
                              {val}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      );
                    }

                    if (col.key === "tags") {
                      return (
                        <td key={col.key} className={`px-3 py-2.5 ${col.width}`}>
                          <TagsCell value={val} search={search} />
                        </td>
                      );
                    }

                    return (
                      <td key={col.key} className={`px-3 py-2.5 text-[13px] truncate max-w-[200px] ${col.width}`}>
                        {val ? <HighlightedText text={val} search={search} /> : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export const DatabaseTable = memo(DatabaseTableInner);
