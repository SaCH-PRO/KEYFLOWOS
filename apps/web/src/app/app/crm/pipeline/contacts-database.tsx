"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Download,
  ChevronDown,
  Database,
  FileSpreadsheet,
  FileText,
  File,
  X,
  Filter,
  HardDrive,
  List,
  Loader2,
  Columns3,
  Check,
} from "lucide-react";
import type { LocalContact } from "@/lib/contacts-db";
import type { ExportFormat } from "@/lib/contacts-export";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDatabaseState, ALL_COLUMNS } from "./hooks/use-database-state";
import type { ColumnKey } from "./hooks/use-database-state";
import { DatabaseTable } from "./database-table";
import { DatabaseBulkBar } from "./database-bulk-bar";
import { ContactLists } from "./contact-lists";

interface ContactsDatabaseProps {
  businessId: string;
  contacts: LocalContact[];
  onRefresh: () => void;
  activeListId: string | null;
  onSelectList: (listId: string | null, contactIds?: string[]) => void;
  onListsLoaded?: (count: number) => void;
  onSelectContact?: (contactId: string) => void;
}

const STATUS_FILTER_OPTIONS = ["ALL", "LEAD", "PROSPECT", "CLIENT", "LOST"];

const EXPORT_OPTIONS: { format: ExportFormat; label: string; desc: string; icon: typeof FileSpreadsheet }[] = [
  { format: "csv", label: "CSV", desc: "Comma-separated values", icon: FileText },
  { format: "xlsx", label: "Excel", desc: "Microsoft Excel workbook", icon: FileSpreadsheet },
  { format: "vcf", label: "vCard", desc: "Contact card format", icon: File },
  { format: "pdf", label: "PDF", desc: "Printable document", icon: FileText },
];

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50];

export function ContactsDatabase({
  businessId,
  contacts,
  onRefresh,
  activeListId,
  onSelectList,
  onListsLoaded,
  onSelectContact,
}: ContactsDatabaseProps) {
  const db = useDatabaseState({ businessId, contacts, onRefresh });

  const exportDialogRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  const handleClearSearch = useCallback(() => db.setSearchInput(""), [db.setSearchInput]);

  useEffect(() => {
    if (!db.showExport) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        db.closeExport();
        exportTriggerRef.current?.focus();
        return;
      }
      if (e.key === "Tab" && exportDialogRef.current) {
        const focusable = exportDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [db.showExport, db.closeExport]);

  useEffect(() => {
    if (db.showExport && exportDialogRef.current) {
      const firstBtn = exportDialogRef.current.querySelector<HTMLButtonElement>("button");
      firstBtn?.focus();
    }
  }, [db.showExport]);

  useEffect(() => {
    if (!db.showColumnPicker) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") db.closeColumnPicker();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [db.showColumnPicker, db.closeColumnPicker]);

  return (
    <div className="space-y-4">
      <div className="kf-card p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent2))]/10">
              <Database className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Contact Database</h3>
              <p className="text-xs text-muted-foreground">
                {db.filteredContacts.length} of {db.activeContacts.length} contacts
                {db.usingCache && (
                  <span className="ml-2 text-amber-400/80">(offline cache)</span>
                )}
                {db.lastSync && (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <HardDrive className="w-3 h-3" />
                    Synced {new Date(db.lastSync).toLocaleTimeString("en-TT", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={db.handleSync}
              disabled={db.syncing}
              className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
              aria-label="Sync contacts from cloud"
            >
              {db.syncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <HardDrive className="w-3.5 h-3.5" />
              )}
              {db.syncing ? "Syncing…" : "Sync"}
            </button>
            <div className="relative" ref={columnPickerRef}>
              <button
                onClick={db.toggleColumnPicker}
                className={`kf-btn-secondary inline-flex items-center gap-1.5 text-xs ${db.showColumnPicker ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
                aria-label="Toggle column visibility"
                aria-haspopup="true"
                aria-expanded={db.showColumnPicker}
              >
                <Columns3 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Columns</span>
              </button>
              {db.showColumnPicker && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={db.closeColumnPicker}
                    aria-hidden="true"
                  />
                  <div
                    className="fixed left-2 right-2 top-20 sm:absolute sm:left-auto sm:top-full sm:right-0 sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-xl py-2 sm:w-52 max-h-[60vh] overflow-y-auto"
                    role="group"
                    aria-label="Toggle columns"
                  >
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Show / Hide Columns
                  </div>
                  {ALL_COLUMNS.map((col) => {
                    const isVisible = db.visibleColumns.has(col.key);
                    return (
                      <button
                        key={col.key}
                        onClick={() => db.toggleColumn(col.key as ColumnKey)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-muted/50 transition-colors text-left"
                        role="checkbox"
                        aria-checked={isVisible}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isVisible ? "bg-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]" : "border-border"}`}>
                          {isVisible && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className={isVisible ? "text-foreground" : "text-muted-foreground"}>
                          {col.label}
                        </span>
                      </button>
                    );
                  })}
                  </div>
                </>
              )}
            </div>
            <div className="relative">
              <button
                ref={exportTriggerRef}
                onClick={db.toggleExport}
                className="kf-btn-primary inline-flex items-center gap-1.5 text-xs"
                aria-haspopup="dialog"
                aria-expanded={db.showExport}
              >
                <Download className="w-3.5 h-3.5" />
                Export
                <ChevronDown className={`w-3 h-3 transition-transform ${db.showExport ? "rotate-180" : ""}`} />
              </button>
              {db.showExport && (
                <>
                  <div
                    className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
                    onClick={db.closeExport}
                    aria-hidden="true"
                  />
                  <div
                    ref={exportDialogRef}
                    className="fixed left-2 right-2 top-20 sm:left-1/2 sm:right-auto sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 kf-card border border-border shadow-2xl rounded-xl py-2 sm:w-64 max-h-[80vh] overflow-y-auto"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Export contacts"
                  >
                    <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30 mb-1">
                      Export {db.filteredContacts.length} contacts
                    </div>
                    {EXPORT_OPTIONS.map(({ format, label, desc, icon: Icon }) => (
                      <button
                        key={format}
                        onClick={() => db.handleExport(format)}
                        disabled={db.exporting}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--kf-accent1))]"
                      >
                        {db.exporting ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[hsl(var(--kf-accent1))]" />
                        ) : (
                          <Icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                        )}
                        <div>
                          <span className="font-medium">{label}</span>
                          <p className="text-[11px] text-muted-foreground">{desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search all fields..."
              value={db.searchInput}
              onChange={(e) => db.setSearchInput(e.target.value)}
              className="kf-input w-full pl-10 text-sm"
              aria-label="Search contacts database"
            />
            {db.searchInput && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted/50"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
          <button
            onClick={db.toggleFilters}
            className={`kf-btn-secondary inline-flex items-center gap-1.5 text-sm ${db.showFilters ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
            aria-pressed={db.showFilters}
            aria-label="Toggle status filters"
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
            {db.statusFilter !== "ALL" && (
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent1))]" />
            )}
          </button>
        </div>

        <AnimatePresence>
          {db.showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-2 mb-3"
              role="group"
              aria-label="Filter by status"
            >
              {STATUS_FILTER_OPTIONS.map((s) => {
                const count = db.statusCounts[s] ?? 0;
                return (
                  <button
                    key={s}
                    onClick={() => db.setStatusFilter(s)}
                    className={`px-3 py-1 text-xs rounded-lg transition-all inline-flex items-center gap-1.5 ${
                      db.statusFilter === s ? "kf-btn-primary" : "kf-btn-secondary"
                    }`}
                    aria-pressed={db.statusFilter === s}
                  >
                    {s}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      db.statusFilter === s ? "bg-white/20" : "bg-muted/50"
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <DatabaseTable
          contacts={db.paginatedContacts}
          page={db.page}
          pageSize={db.pageSize}
          sortField={db.sortField}
          sortDir={db.sortDir}
          selectedIds={db.selectedIds}
          allPageSelected={db.allPageSelected}
          somePageSelected={db.somePageSelected}
          onSort={db.handleSort}
          onToggleSelect={db.toggleSelect}
          onToggleSelectAll={db.toggleSelectAll}
          onSelectContact={onSelectContact}
          isSortable={db.isSortable}
          search={db.searchInput}
          columns={db.visibleColumnDefs}
        />

        <div className="flex items-center justify-between mt-3 px-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <label htmlFor="db-page-size" className="sr-only">Rows per page</label>
            <span>Rows:</span>
            <select
              id="db-page-size"
              value={db.pageSize}
              onChange={(e) => db.handlePageSizeChange(Number(e.target.value))}
              className="bg-white/5 border border-border/40 rounded px-2 py-1 text-xs"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="hidden sm:inline">
              Showing {Math.min((db.page - 1) * db.pageSize + 1, db.filteredContacts.length)}-{Math.min(db.page * db.pageSize, db.filteredContacts.length)} of {db.filteredContacts.length}
            </span>
          </div>
          <nav className="flex items-center gap-2 text-xs" aria-label="Table pagination">
            <button
              disabled={db.page <= 1}
              onClick={db.handlePrevPage}
              className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
            >
              Previous
            </button>
            <span className="text-muted-foreground" aria-live="polite">{db.page}/{db.totalPages}</span>
            <button
              disabled={db.page >= db.totalPages}
              onClick={db.handleNextPage}
              className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              Next
            </button>
          </nav>
        </div>
      </div>

      <DatabaseBulkBar
        selectedCount={db.effectiveSelectedCount}
        bulkActing={db.bulkActing}
        activeBulkAction={db.activeBulkAction}
        onSetBulkAction={db.setActiveBulkAction}
        bulkTagInput={db.bulkTagInput}
        onBulkTagInputChange={db.setBulkTagInput}
        onBulkStatusChange={db.handleBulkStatusChange}
        onBulkAddTags={db.handleBulkAddTags}
        onBulkAddToList={db.handleBulkAddToList}
        onBulkDelete={db.handleBulkDelete}
        onClearSelection={db.clearSelection}
        availableLists={db.availableLists}
        allPagesSelected={db.allPagesSelected}
        totalFiltered={db.filteredContacts.length}
        onSelectAllPages={db.handleSelectAllPages}
      />

      <div className="kf-card">
        <button
          onClick={db.toggleLists}
          className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors rounded-xl"
          aria-expanded={db.showLists}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10">
              <List className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-semibold">Contact Lists</h3>
              <p className="text-xs text-muted-foreground">Organize contacts into manual or smart lists</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${db.showLists ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence>
          {db.showLists && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 border-t border-border/30">
                <ContactLists
                  businessId={businessId}
                  activeListId={activeListId}
                  onSelectList={onSelectList}
                  onListsLoaded={onListsLoaded}
                  onListsChanged={db.handleListsChanged}
                  refreshToken={db.listsRefreshToken}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={db.confirmState.open}
        title="Delete Contacts"
        message={`Delete ${db.confirmState.count} contacts? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { db.confirmState.onConfirm(); db.handleConfirmClose(); }}
        onCancel={db.handleConfirmClose}
      />
    </div>
  );
}
