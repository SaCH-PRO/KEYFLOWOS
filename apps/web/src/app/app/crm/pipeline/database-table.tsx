"use client";

import { memo, useCallback } from "react";
import {
  Search,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  X,
} from "lucide-react";
import type { LocalContact } from "@/lib/contacts-db";
import type { SortField, SortDir } from "./hooks/use-database-state";

type ColumnDef = {
  key: SortField | "tags" | "jobTitle";
  label: string;
  width: string;
};

const VISIBLE_COLUMNS: ColumnDef[] = [
  { key: "firstName", label: "First Name", width: "w-[120px]" },
  { key: "lastName", label: "Last Name", width: "w-[120px]" },
  { key: "email", label: "Email", width: "w-[200px]" },
  { key: "phone", label: "Phone", width: "w-[130px]" },
  { key: "status", label: "Status", width: "w-[90px]" },
  { key: "companyName", label: "Company", width: "w-[160px]" },
  { key: "jobTitle", label: "Job Title", width: "w-[140px]" },
  { key: "city", label: "City", width: "w-[110px]" },
  { key: "country", label: "Country", width: "w-[110px]" },
  { key: "source", label: "Source", width: "w-[100px]" },
  { key: "tags", label: "Tags", width: "w-[150px]" },
  { key: "createdAt", label: "Created", width: "w-[100px]" },
];

const STATUS_COLORS: Record<string, string> = {
  LEAD: "bg-amber-500/20 text-amber-400",
  PROSPECT: "bg-blue-500/20 text-blue-400",
  CLIENT: "bg-green-500/20 text-green-400",
  LOST: "bg-red-500/20 text-red-400",
};

function getCellValue(contact: LocalContact, key: string): string {
  if (key === "tags") return Array.isArray(contact.tags) ? contact.tags.join(", ") : "";
  if (key === "createdAt" && contact.createdAt) {
    return new Date(contact.createdAt).toLocaleDateString("en-TT", {
      year: "numeric", month: "short", day: "numeric",
    });
  }
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
}

function TagsCell({ value }: { value: string }) {
  if (!value) return null;
  const tags = value.split(", ").filter(Boolean);
  const visible = tags.slice(0, 3);
  const overflow = tags.length - 3;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tag) => (
        <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-muted/50 text-muted-foreground">
          {tag}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-[10px] text-muted-foreground">+{overflow}</span>
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
}: DatabaseTableProps) {
  const handleCheckboxRef = useCallback((el: HTMLInputElement | null) => {
    if (el) el.indeterminate = somePageSelected && !allPageSelected;
  }, [somePageSelected, allPageSelected]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border/40">
      <table className="w-full text-sm" role="grid" aria-label="Contacts database table">
        <thead>
          <tr className="bg-muted/30 border-b border-border/40">
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
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-[40px]">#</th>
            {VISIBLE_COLUMNS.map((col) => {
              const sortable = isSortable(col.key);
              const isActive = sortField === col.key;
              const ariaSortValue = isActive ? (sortDir === "asc" ? "ascending" : "descending") : undefined;

              return (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground ${col.width} ${sortable ? "cursor-pointer hover:text-foreground select-none" : ""}`}
                  onClick={sortable ? () => onSort(col.key as SortField) : undefined}
                  aria-sort={ariaSortValue}
                  role={sortable ? "columnheader" : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortable && isActive && (
                      sortDir === "asc"
                        ? <ChevronUp className="w-3 h-3" />
                        : <ChevronDown className="w-3 h-3" />
                    )}
                    {sortable && !isActive && (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {contacts.length === 0 ? (
            <tr>
              <td colSpan={VISIBLE_COLUMNS.length + 2} className="px-4 py-8 text-center text-muted-foreground text-sm">
                {search ? "No contacts match your search" : "No contacts found"}
              </td>
            </tr>
          ) : (
            contacts.map((contact, idx) => {
              const isSelected = selectedIds.has(contact.id);
              return (
                <tr
                  key={contact.id}
                  className={`border-b border-border/20 hover:bg-muted/20 transition-colors cursor-pointer ${isSelected ? "bg-[hsl(var(--kf-accent1))]/5" : ""}`}
                  onClick={() => onSelectContact?.(contact.id)}
                  role="row"
                  aria-selected={isSelected}
                >
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(contact.id)}
                      className="w-3.5 h-3.5 rounded border-border accent-[hsl(var(--kf-accent1))] cursor-pointer"
                      aria-label={`Select ${contact.firstName ?? ""} ${contact.lastName ?? ""}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {(page - 1) * pageSize + idx + 1}
                  </td>
                  {VISIBLE_COLUMNS.map((col) => {
                    const val = getCellValue(contact, col.key);

                    if (col.key === "status") {
                      return (
                        <td key={col.key} className={`px-3 py-2 ${col.width}`}>
                          <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${STATUS_COLORS[val] || "bg-muted text-muted-foreground"}`}>
                            {val}
                          </span>
                        </td>
                      );
                    }

                    if (col.key === "tags") {
                      return (
                        <td key={col.key} className={`px-3 py-2 ${col.width}`}>
                          <TagsCell value={val} />
                        </td>
                      );
                    }

                    return (
                      <td key={col.key} className={`px-3 py-2 text-sm truncate max-w-[200px] ${col.width}`}>
                        {val || <span className="text-muted-foreground/40">—</span>}
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
